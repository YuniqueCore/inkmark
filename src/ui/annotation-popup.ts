/** 已有批注的锚定卡片：点击正文高亮（或侧栏编辑）弹出，贴着高亮位置带箭头，支持原位编辑。 */

import { arrow, autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom'
import { escapeHtml, snippet } from '../core/text'
import { KIND_LABEL } from '../core/types'
import type { Annotation, AnnotationKind } from '../core/types'
import { ComposerForm, type ComposerState } from './composer'

export interface PopupCallbacks {
  onUpdate: (id: string, kind: AnnotationKind, comment: string, replacement?: string) => void
  onDelete: (id: string) => void
  onToggleStatus: (id: string) => void
  onCopySnippet: (text: string) => void
}

/** 失锚徽标：引文已不在原文中的批注（编辑原文后钳在改动处） */
const LOST_BADGE =
  '<span class="badge border-amber-500/40 text-amber-600 dark:text-amber-400" title="原引文已不在原文中，批注钉在改动处">失锚</span>'

export class AnnotationPopup {
  private el: HTMLElement
  private activeId: string | null = null
  /** 当前正在原位编辑的批注 */
  private editingId: string | null = null
  /** 编辑态撰写状态：挂载的 ComposerForm 持有 DOM，这里记账以跨 re-render 保留输入 */
  private editState: ComposerState | null = null
  private editComposer: ComposerForm | null = null
  private anchorRect: DOMRect | null = null
  private arrowEl: HTMLElement
  private stopAutoUpdate: (() => void) | null = null
  /** popup 展示的批注集合（可能多条堆叠） */
  private items: Annotation[] = []
  private sourceText = ''

  constructor(private callbacks: PopupCallbacks) {
    this.el = document.createElement('div')
    this.el.className = 'popover-panel fixed z-60 hidden w-[min(420px,calc(100vw-16px))]'
    this.arrowEl = document.createElement('div')
    this.arrowEl.className = 'popup-arrow absolute size-2.5 rotate-45 bg-popover'
    document.body.append(this.el)

    // 编辑态键盘：⌘Enter 保存（批注语 / 替换词上均可用）；Esc 退出编辑由
    // document 级监听统一处理（组合中的 Esc 属于取消候选，已在彼处排除）
    this.el.addEventListener('keydown', (e) => {
      if (!this.editingId) return
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.stopPropagation()
        this.saveEdit()
      }
    })

    document.addEventListener('mousedown', (e) => {
      const t = e.target as HTMLElement
      if (this.el.contains(t) || t.closest('.seg-hl')) return
      if (this.editingId) {
        // 编辑中有未保存改动：误点外部不销毁编辑（保存/取消/Esc 才是出口）；
        // 未改动则照常关闭
        const a = this.items.find((x) => x.id === this.editingId)
        if (a && this.hasUnsavedChanges(a)) return
      }
      this.close()
    })
    document.addEventListener('keydown', (e) => {
      if (e.isComposing) return // 输入法组合中的 Escape 是取消候选，不是关闭卡片
      if (e.key === 'Escape' && !this.el.classList.contains('hidden')) {
        // 编辑态先退出编辑，再关卡片
        if (this.editingId) this.exitEdit()
        else this.close()
      }
    })
    window.addEventListener('resize', () => {
      // 编辑中缩放窗口只重新定位，不销毁未保存的编辑
      if (this.editingId) this.place()
      else this.close()
    })
  }

  /** 编辑态与原批注的差异 = 未保存改动（类型 / 批注语 / 替换词任一变化） */
  private hasUnsavedChanges(a: Annotation): boolean {
    const s = this.editState
    if (!s) return false
    return s.kind !== a.kind || s.comment !== a.comment || s.replacement !== (a.replacement ?? '')
  }

  /** 进入编辑态：从批注自身初始化撰写状态（保存时不会悄悄改掉未动的字段） */
  private beginEdit(a: Annotation): void {
    this.editState = {kind: a.kind, comment: a.comment, replacement: a.replacement ?? ''}
  }

  /** 退出编辑态回到展示（不保存） */
  private exitEdit(): void {
    this.editingId = null
    this.editState = null
    this.render()
    this.place()
  }

  /** 点击高亮入口：展示该位置的全部批注（编辑指定条时置顶） */
  openFor(id: string, text: string, annotations: Annotation[], edit = false): void {
    const anchor = annotations.find((a) => a.id === id)
    if (!anchor) {
      this.close()
      return
    }
    // 对同一条批注重复点击高亮：编辑中有未保存改动则保持原编辑不被重置
    if (this.editingId && this.editingId === id && this.hasUnsavedChanges(anchor)) return
    this.sourceText = text
    this.items = annotations
      .filter((a) => a.target === anchor.target && overlaps(a, anchor))
      .sort((x, y) => (x.id === id ? -1 : y.id === id ? 1 : x.start - y.start))
    this.activeId = id
    this.editingId = edit ? id : null
    if (edit) this.beginEdit(anchor)
    this.el.classList.remove('hidden')
    this.render()
    this.place()
    if (edit) this.editComposer?.focusComment(true)
  }

  close(): void {
    this.activeId = null
    this.editingId = null
    this.editState = null
    this.editComposer = null
    this.items = []
    this.el.classList.add('hidden')
    this.el.innerHTML = ''
    this.stopAutoUpdate?.()
    this.stopAutoUpdate = null
  }

  /** 数据变更后由 main 调用：目标批注已不存在则关闭，否则重绘保持位置。
   * 批注分原文/改稿两侧，摘录文本按锚定侧选取。 */
  sync(text: string, annotations: Annotation[], revised?: string): void {
    if (this.el.classList.contains('hidden')) return
    if (!this.activeId || !annotations.some((a) => a.id === this.activeId)) {
      this.close()
      return
    }
    const anchor = annotations.find((a) => a.id === this.activeId)!
    this.items = annotations.filter((a) => a.target === anchor.target && overlaps(a, anchor))
    this.sourceText = anchor.target === 'revised' ? (revised ?? text) : text
    this.render()
    this.place()
  }

  private render(): void {
    const cards = this.items
      .map((a) => this.renderItem(a))
      .join('<div class="my-2 border-t"></div>')
    this.el.innerHTML = `<div class="p-3">${cards}</div>`
    this.el.append(this.arrowEl)
    this.mountComposer()
    this.bindItemEvents()
  }

  /** 编辑态挂载共用撰写表单；editState 跨 re-render 保留（主流程重渲染不丢输入） */
  private mountComposer(): void {
    const mount =
      this.editingId && this.editState
        ? (this.el.querySelector(`[data-ann-id="${this.editingId}"] [data-composer]`) as HTMLElement | null)
        : null
    if (!mount || !this.editState) {
      this.editComposer = null
      return
    }
    this.editComposer = new ComposerForm(
      mount,
      {onChange: (s) => this.onEditChange(s)},
      this.editState,
      {commentClass: 'min-h-16 resize-y text-sm popup-edit-input'},
    )
    this.editComposer.render()
  }

  /** 编辑中任意字段变化：记账 + 头部类型徽标实时跟随（定向更新，输入法安全） */
  private onEditChange(s: ComposerState): void {
    this.editState = s
    const badge = this.el.querySelector(`[data-ann-id="${this.editingId}"] .popup-kind-badge`)
    if (badge instanceof HTMLElement) {
      badge.textContent = KIND_LABEL[s.kind]
      badge.style.color = `var(--kind-${s.kind})`
      badge.style.background = `var(--kind-${s.kind}-bg)`
    }
  }

  private renderItem(a: Annotation): string {
    const quote = snippet(this.sourceText, a.start, a.end, 90)
    const meta = a.meta
      ? `<span class="badge border-transparent" style="color:var(--kind-slop);background:var(--kind-slop-bg)">${escapeHtml(a.meta.label)}</span>`
      : ''
    if (this.editingId === a.id) {
      return `
        <div data-ann-id="${a.id}" class="popup-item">
          <div class="mb-2 flex items-center gap-1.5">
            <span class="popup-kind-badge badge border-transparent" style="color:var(--kind-${a.kind});background:var(--kind-${a.kind}-bg)">${KIND_LABEL[a.kind]}</span>
            ${meta}
            ${a.anchorLost ? LOST_BADGE : ''}
          </div>
          <p class="mb-2 line-clamp-2 border-l-2 border-primary/30 pl-2 text-[12.5px] text-muted-foreground">“${escapeHtml(quote)}”</p>
          <div data-composer></div>
          <div class="mt-2 flex items-center justify-between">
            <span class="flex items-center gap-1 text-xs text-muted-foreground"><span class="kbd">⌘</span><span class="kbd">↵</span> 保存</span>
            <span class="flex gap-1.5">
              <button class="btn btn-ghost btn-sm" data-op="cancel-edit">取消</button>
              <button class="btn btn-default btn-sm" data-op="save">保存</button>
            </span>
          </div>
        </div>`
    }
    return `
      <div data-ann-id="${a.id}" class="popup-item">
        <div class="mb-1.5 flex items-center gap-1.5">
          <span class="badge border-transparent" style="color:var(--kind-${a.kind});background:var(--kind-${a.kind}-bg)">${KIND_LABEL[a.kind]}</span>
          ${meta}
          ${a.anchorLost ? LOST_BADGE : ''}
          ${a.status === 'resolved' ? '<span class="badge bg-secondary text-secondary-foreground">已解决</span>' : ''}
          <span class="ml-auto text-[11px] text-muted-foreground">${this.items.length > 1 ? `共 ${this.items.length} 条` : ''}</span>
        </div>
        <blockquote class="mb-1.5 border-l-2 border-border pl-2 text-[12.5px] text-muted-foreground">“${escapeHtml(quote)}”</blockquote>
        ${a.comment ? `<div class="whitespace-pre-wrap text-sm leading-relaxed">${escapeHtml(a.comment)}</div>` : ''}
        <div class="mt-2 flex gap-0.5">
          <button class="btn btn-ghost btn-sm h-7 px-2 text-xs" data-op="edit">编辑</button>
          <button class="btn btn-ghost btn-sm h-7 px-2 text-xs" data-op="toggle">${a.status === 'open' ? '解决' : '重开'}</button>
          <button class="btn btn-ghost btn-sm h-7 px-2 text-xs" data-op="copy">复制</button>
          <button class="btn btn-ghost btn-sm btn-destructive h-7 px-2 text-xs" data-op="delete">删除</button>
        </div>
      </div>`
  }

  private bindItemEvents(): void {
    this.el.querySelectorAll('[data-op]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const op = (e.target as HTMLElement).dataset.op
        const id = (e.target as HTMLElement).closest('.popup-item')?.getAttribute('data-ann-id')
        if (!id) return
        if (op === 'edit') {
          const a = this.items.find((x) => x.id === id)
          if (!a) return
          this.editingId = id
          this.beginEdit(a)
          this.render()
          this.place()
          this.editComposer?.focusComment()
        }
        if (op === 'cancel-edit') this.exitEdit()
        if (op === 'save') this.saveEdit()
        if (op === 'toggle') this.callbacks.onToggleStatus(id)
        if (op === 'delete') this.callbacks.onDelete(id)
        if (op === 'copy') {
          const a = this.items.find((x) => x.id === id)
          if (a) this.callbacks.onCopySnippet(this.sourceText.slice(a.start, a.end))
        }
      })
    })
  }

  private saveEdit(): void {
    if (!this.editingId || !this.editComposer) return
    // 认可类允许只划不写；其余类型仍需描述
    if (!this.editComposer.canSubmit()) {
      this.editComposer.focusComment()
      return
    }
    const s = this.editComposer.state()
    // 先退出编辑态再触发更新：onUpdate 会同步重绘，若 editingId 仍在，
    // 重绘会把编辑态原样画回去
    const id = this.editingId
    this.editingId = null
    this.editState = null
    this.callbacks.onUpdate(id, s.kind, s.comment.trim(), s.replacement.trim() || undefined)
  }

  private place(): void {
    if (!this.anchorRect) return
    this.el.classList.remove('hidden')
    // 重渲染会替换高亮节点：取实时元素的矩形，滚动/缩放后卡片才能跟着锚点走
    // （此前引用是打开时冻结的矩形，autoUpdate 虽随滚动重算、锚却不动）；
    // 实时元素暂不在（重渲染间隙/被筛选隐藏）就沿用打开时的矩形，避免跳到左上角。
    // contextElement 让 autoUpdate 能挂上高亮的滚动祖先监听（虚拟元素本身没有）。
    const liveEl = this.activeId
      ? document.querySelector(`.seg-hl[data-ann-ids~="${this.activeId}"]`)
      : null
    const reference = {
      getBoundingClientRect: () => {
        const live = this.activeId
          ? document.querySelector(`.seg-hl[data-ann-ids~="${this.activeId}"]`)
          : null
        return live ? live.getBoundingClientRect() : this.anchorRect!
      },
      ...(liveEl ? {contextElement: liveEl} : {}),
    }
    // 编辑时内容高度变化，autoUpdate 跟随重定位；组件关闭时停掉
    this.stopAutoUpdate?.()
    this.stopAutoUpdate = autoUpdate(reference, this.el, () => {
      if (this.el.classList.contains('hidden')) return
      void computePosition(reference, this.el, {
        placement: 'bottom',
        strategy: 'fixed',
        middleware: [
          offset(10),
          flip({fallbackPlacements: ['top']}),
          // crossAxis 必开：bottom/top placement 下 shift 默认只校正横轴，
          // 段落贴近视口底部时弹层下半会被窗口裁掉
          shift({padding: 8, crossAxis: true}),
          arrow({element: this.arrowEl, padding: 12}),
        ],
      }).then(({x, y, placement, middlewareData}) => {
        this.el.style.left = `${x}px`
        this.el.style.top = `${y}px`
        const side = placement.split('-')[0]
        const arrowData = middlewareData.arrow
        if (arrowData) {
          this.arrowEl.style.left = arrowData.x != null ? `${arrowData.x}px` : ''
          this.arrowEl.style.top = arrowData.y != null ? `${arrowData.y}px` : ''
        }
        // 箭头位置：卡片在锚点下方（placement bottom）时箭头贴卡片顶边指向上方，
        // 翻转到上方时贴底边。此前映射写反（卡片在下、箭头却跑到底部）。
        // 无边框：菱形与卡片同底色，盖住卡片边线，视觉融为一体。
        this.arrowEl.className =
          'popup-arrow absolute size-2.5 rotate-45 bg-popover ' +
          (side === 'bottom' ? '-top-[5px]' : '-bottom-[5px]')
      })
    })
  }

  /** main 在点击高亮时设置锚矩形（视口坐标） */
  setAnchorRect(rect: DOMRect): void {
    this.anchorRect = rect
  }
}

function overlaps(a: Annotation, b: Annotation): boolean {
  return a.start < b.end && b.start < a.end
}


