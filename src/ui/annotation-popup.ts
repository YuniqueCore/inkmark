/** 已有批注的锚定卡片：点击正文高亮（或侧栏编辑）弹出，贴着高亮位置带箭头，支持原位编辑。 */

import { escapeHtml, KIND_LABEL } from './editor'
import { icon } from './icons'
import { snippet } from '../core/text'
import type { Annotation, AnnotationKind } from '../core/types'

export interface PopupCallbacks {
  onUpdate: (id: string, kind: AnnotationKind, comment: string) => void
  onDelete: (id: string) => void
  onToggleStatus: (id: string) => void
  onCopySnippet: (text: string) => void
}

const KINDS: AnnotationKind[] = ['issue', 'suggestion', 'question', 'highlight', 'praise']

export class AnnotationPopup {
  private el: HTMLElement
  private activeId: string | null = null
  /** 当前正在原位编辑的批注 */
  private editingId: string | null = null
  private anchorRect: DOMRect | null = null
  /** popup 展示的批注集合（可能多条堆叠） */
  private items: Annotation[] = []
  private sourceText = ''

  constructor(private callbacks: PopupCallbacks) {
    this.el = document.createElement('div')
    this.el.className = 'popover-panel fixed z-60 hidden w-[340px]'
    document.body.append(this.el)

    document.addEventListener('mousedown', (e) => {
      const t = e.target as HTMLElement
      if (this.el.contains(t) || t.closest('.seg-hl')) return
      this.close()
    })
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.el.classList.contains('hidden')) {
        // 编辑态先退出编辑，再关卡片
        if (this.editingId) this.render()
        else this.close()
      }
    })
    window.addEventListener('resize', () => this.close())
  }

  /** 点击高亮入口：展示该位置的全部批注（编辑指定条时置顶） */
  openFor(id: string, text: string, annotations: Annotation[], edit = false): void {
    const anchor = annotations.find((a) => a.id === id)
    if (!anchor) {
      this.close()
      return
    }
    this.sourceText = text
    this.items = annotations
      .filter((a) => overlaps(a, anchor))
      .sort((x, y) => (x.id === id ? -1 : y.id === id ? 1 : x.start - y.start))
    this.activeId = id
    this.editingId = edit ? id : null
    this.el.classList.remove('hidden')
    this.render()
    this.place()
    if (edit) {
      const input = this.el.querySelector('.popup-edit-input') as HTMLTextAreaElement | null
      input?.focus()
      input?.select()
    }
  }

  close(): void {
    this.activeId = null
    this.editingId = null
    this.items = []
    this.el.classList.add('hidden')
    this.el.innerHTML = ''
  }

  /** 数据变更后由 main 调用：目标批注已不存在则关闭，否则重绘保持位置 */
  sync(text: string, annotations: Annotation[]): void {
    if (this.el.classList.contains('hidden')) return
    if (!this.activeId || !annotations.some((a) => a.id === this.activeId)) {
      this.close()
      return
    }
    const anchor = annotations.find((a) => a.id === this.activeId)!
    this.items = annotations.filter((a) => overlaps(a, anchor))
    this.sourceText = text
    this.render()
    this.place()
  }

  private render(): void {
    const cards = this.items
      .map((a) => this.renderItem(a))
      .join('<div class="my-2 border-t"></div>')
    this.el.innerHTML = `<div class="p-3">${cards}</div><div class="popup-arrow"></div>`
    this.bindItemEvents()
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
            <span class="badge border-transparent" style="color:var(--kind-${a.kind});background:var(--kind-${a.kind}-bg)">${KIND_LABEL[a.kind]}</span>
            ${meta}
          </div>
          <p class="mb-2 line-clamp-2 border-l-2 border-primary/30 pl-2 text-[12.5px] text-muted-foreground">“${escapeHtml(quote)}”</p>
          <div class="mb-2 flex flex-wrap gap-1">${KINDS.map(
            (k) => `<button class="chip-toggle kind-chip ${a.kind === k ? 'on' : ''}" data-kind="${k}" data-role="edit-kind">${icon(k)} ${KIND_LABEL[k]}</button>`,
          ).join('')}</div>
          <textarea class="input-base popup-edit-input min-h-16 resize-y text-sm" placeholder="批注内容：问题给改法；认可写原因……">${escapeHtml(a.comment)}</textarea>
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
          ${a.status === 'resolved' ? '<span class="badge bg-secondary text-secondary-foreground">已解决</span>' : ''}
          <span class="ml-auto text-[11px] text-muted-foreground">${this.items.length > 1 ? `共 ${this.items.length} 条` : ''}</span>
        </div>
        <blockquote class="mb-1.5 border-l-2 border-border pl-2 text-[12.5px] text-muted-foreground">“${escapeHtml(quote)}”</blockquote>
        <div class="whitespace-pre-wrap text-sm leading-relaxed">${escapeHtml(a.comment)}</div>
        <div class="mt-2 flex gap-0.5">
          <button class="btn btn-ghost btn-sm h-7 px-2 text-xs" data-op="edit">编辑</button>
          <button class="btn btn-ghost btn-sm h-7 px-2 text-xs" data-op="toggle">${a.status === 'open' ? '解决' : '重开'}</button>
          <button class="btn btn-ghost btn-sm h-7 px-2 text-xs" data-op="copy">复制</button>
          <button class="btn btn-ghost btn-sm btn-destructive h-7 px-2 text-xs" data-op="delete">删除</button>
        </div>
      </div>`
  }

  private bindItemEvents(): void {
    // kind chips（编辑态）
    this.el.querySelectorAll('[data-role="edit-kind"]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const item = chip.closest('.popup-item') as HTMLElement
        this.editKind = (chip as HTMLElement).dataset.kind as AnnotationKind
        item.querySelectorAll('.kind-chip').forEach((c) =>
          c.classList.toggle('on', (c as HTMLElement).dataset.kind === this.editKind),
        )
      })
    })
    // 编辑态键盘
    const input = this.el.querySelector('.popup-edit-input') as HTMLTextAreaElement | null
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) this.saveEdit()
        e.stopPropagation()
      })
    }
    this.el.querySelectorAll('[data-op]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const op = (e.target as HTMLElement).dataset.op
        const id = (e.target as HTMLElement).closest('.popup-item')?.getAttribute('data-ann-id')
        if (!id) return
        if (op === 'edit') {
          this.editingId = id
          this.render()
          this.place()
          const input = this.el.querySelector('.popup-edit-input') as HTMLTextAreaElement | null
          input?.focus()
        }
        if (op === 'cancel-edit') {
          this.editingId = null
          this.render()
          this.place()
        }
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

  private editKind: AnnotationKind = 'issue'

  private saveEdit(): void {
    if (!this.editingId) return
    const input = this.el.querySelector('.popup-edit-input') as HTMLTextAreaElement | null
    if (!input) return
    const comment = input.value.trim()
    if (comment === '') {
      input.focus()
      return
    }
    // 先退出编辑态再触发更新：onUpdate 会同步重绘，若 editingId 仍在，
    // 重绘会把编辑态原样画回去
    const id = this.editingId
    const kind = this.editKind
    this.editingId = null
    this.callbacks.onUpdate(id, kind, comment)
  }

  private place(): void {
    if (!this.anchorRect) return
    const r = this.anchorRect
    this.el.classList.remove('hidden')
    const w = this.el.offsetWidth || 340
    const h = this.el.offsetHeight || 200
    const arrow = 8
    let left = clamp(r.left + r.width / 2 - w / 2, 8, window.innerWidth - w - 8)
    let top = r.bottom + arrow
    let arrowSide: 'top' | 'bottom' = 'top'
    if (top + h > window.innerHeight - 8 && r.top - arrow - h > 8) {
      top = r.top - arrow - h
      arrowSide = 'bottom'
    }
    top = clamp(top, 8, window.innerHeight - h - 8)
    // 箭头水平位置对准高亮中心（clamp 到卡片内）
    const anchorCx = clamp(r.left + r.width / 2, left + 16, left + w - 16)
    this.el.style.left = `${left}px`
    this.el.style.top = `${top}px`
    const arrowEl = this.el.querySelector('.popup-arrow') as HTMLElement | null
    if (arrowEl) {
      arrowEl.className =
        'popup-arrow absolute size-2.5 rotate-45 border bg-popover ' +
        (arrowSide === 'top'
          ? '-top-1 border-l border-t'
          : '-bottom-1 border-r border-b')
      arrowEl.style.left = `${anchorCx - left - 5}px`
    }
  }

  /** main 在点击高亮时设置锚矩形（视口坐标） */
  setAnchorRect(rect: DOMRect): void {
    this.anchorRect = rect
  }
}

function overlaps(a: Annotation, b: Annotation): boolean {
  return a.start < b.end && b.start < a.end
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
