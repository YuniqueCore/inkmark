/** 选区标注小点：选区稳定后出现在鼠标停点附近的圆点，hover 自然展开为撰写卡片。
 *
 * 位置语义（placement 由「鼠标停在选区哪一端」推导）：
 * - 左→右划：鼠标停右端 → 小点出现在停点右下（right-start）
 * - 右→左划：鼠标停左端 → 左下（left-start）
 * - 下→上划：鼠标停上端 → 左上/右上（left-end / right-end）
 * - 上→下划：鼠标停下端 → 右下/左下
 * 小点锚定鼠标停点本身（虚拟点引用 + offset），永远不会因大段选区而飘远；
 * 视口边缘由 shift 兜底。
 */

import { computePosition, offset, shift, size, limitShift } from '@floating-ui/dom'
import { escapeHtml } from '../core/text'
import {SelectionDrafts, hasComposition} from '../workbench/composition'
import { MANUAL_KINDS } from '../core/types'
import type { AnnotationKind } from '../core/types'
import { ComposerForm, type ComposerState } from './composer'

export interface SelectionInfo {
  start: number
  end: number
  /** 选区所在侧的完整文本快照，用于识别原文变化。 */
  sourceText: string
  /** 选区首行视口矩形 */
  rect: DOMRect
  quoted: string
  /** mouseup 时鼠标视口坐标 */
  mouse: { x: number; y: number }
  /** 拖拽方向：true = 从前往后选（上→下/左→右），false = 从后往前 */
  forward: boolean
  /** 所属文档：草稿按文档+范围记账，避免不同文档同偏移串草稿 */
  docId: string
  /** 锚定侧：缺省 = 原文；'b' = 对照视图的改稿新增行 */
  side?: 'b'
  /** 渲染预览中的选区以 Markdown 源文坐标保存。 */
  preview?: true
}

type PinSide = 'left' | 'right'

export interface PinCallbacks {
  /** 只有宿主确认创建成功后才清除草稿。 */
  onCreate: (info: SelectionInfo, kind: AnnotationKind, comment: string, replacement?: string) => boolean
  onCopySelection: (quoted: string) => void
  onDismiss: () => void
}

export class SelectionPin {
  private pin: HTMLElement
  private card: HTMLElement
  private info: SelectionInfo | null = null
  /** 小点在鼠标停点的哪一侧，以及纵向延伸方向 */
  private pinSide: PinSide = 'right'
  private pinVertical: 'up' | 'down' = 'down'
  private closeTimer: ReturnType<typeof setTimeout> | undefined
  private mode: 'closed' | 'hover' | 'editing' | 'composing' = 'closed'
  private placementRevision = 0
  /** 不同文本版本的相同偏移不能复用草稿。 */
  private drafts = new SelectionDrafts()
  /** 展开期间挂载的共用撰写表单（类型 chips + 快捷语 + 批注语 + 替换词） */
  private composer: ComposerForm | null = null

  constructor(private callbacks: PinCallbacks) {
    this.pin = document.createElement('button')
    this.pin.id = 'selection-pin'
    this.pin.className =
      'fixed z-50 hidden size-7 cursor-pointer place-items-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-primary/15 transition-transform hover:scale-110'
    this.pin.title = '添加批注'
    this.pin.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" class="size-3.5"><path d="M12 5v14M5 12h14"/></svg>`

    this.card = document.createElement('div')
    this.card.className = 'popover-panel fixed z-50 hidden overflow-y-auto w-[min(400px,calc(100vw-16px))]'

    document.body.append(this.pin, this.card)

    this.pin.addEventListener('mouseenter', () => this.expand())
    this.pin.addEventListener('pointerdown', event => {
      if (this.mode !== 'closed') { event.preventDefault(); this.engage() }
    })
    this.pin.addEventListener('click', () => this.expand(true))
    this.card.addEventListener('mouseenter', () => this.cancelCollapse())
    this.card.addEventListener('mouseleave', () => this.scheduleCollapse())
    this.card.addEventListener('pointerdown', () => this.engage())
    this.card.addEventListener('compositionstart', () => {
      this.engage()
      if (this.mode !== 'closed') this.mode = 'composing'
    })
    this.card.addEventListener('compositionend', () => {
      if (this.mode === 'composing') this.mode = 'editing'
    })

    // 撰写表单（ComposerForm）自理输入与 chips；卡片只留键盘快捷键与操作按钮
    this.card.addEventListener('keydown', (e) => {
      this.engage()
      if (e.isComposing) return // 输入法组合中的 Enter/Escape 属于候选操作，不是提交或关闭
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) this.submit()
      if (e.key === 'Escape') {
        e.stopPropagation()
        this.discardDraft() // Esc 是显式取消：丢弃草稿
        this.dismiss()
      }
    })
    this.card.addEventListener('click', (e) => {
      const op = (e.target as HTMLElement).dataset.op
      if (op === 'submit') this.submit()
      if (op === 'copy') {
        if (this.info) this.callbacks.onCopySelection(this.info.quoted)
      }
    })

    document.addEventListener('mousedown', (e) => {
      const t = e.target as HTMLElement
      if (this.pin.contains(t) || this.card.contains(t)) return
      // 有草稿时点外部不销毁撰写状态：误触不该吞掉写了一半的批注，
      // 重选同一段落即可取回；空卡片维持「点外部关闭」的习惯。
      if (this.mode === 'composing' || this.hasDraftContent()) return
      this.dismiss()
    })
    document.addEventListener('keydown', (e) => {
      if (e.isComposing) return
      // 只有焦点在小点上时才把 Esc 视为取消；其他控件的 Esc 不应清除草稿。
      // 卡片内部的 Esc 已在上面的局部监听器处理。
      if (e.key === 'Escape' && e.target instanceof Node && this.pin.contains(e.target)) {
        this.discardDraft()
        this.dismiss()
      }
    })
    window.addEventListener('resize', () => this.reanchor())
    window.visualViewport?.addEventListener('resize', () => this.reanchor())
    window.visualViewport?.addEventListener('scroll', () => this.reanchor())
    document.addEventListener('scroll', (e) => {
      // 卡片内部的滚动（快捷语横滑、textarea 滚动）不是视口变化：
      // 此时选区已因 input.focus() 交出，重锚定会把展开态误判为失效而关卡
      if (e.target instanceof Node && this.card.contains(e.target)) return
      this.reanchor()
    }, true)
  }

  /** mouseup 入口：选区稳定后亮出小点 */
  showFor(info: SelectionInfo): void {
    if (info.end - info.start === 0 || info.quoted.trim() === '') {
      this.dismiss()
      return
    }
    const previous = this.info
    const same = previous && previous.docId === info.docId && previous.sourceText === info.sourceText &&
      previous.start === info.start && previous.end === info.end && previous.side === info.side && previous.preview === info.preview
    this.info = info
    if (same) {
      this.placePin()
      this.pin.classList.remove('hidden')
      if (this.mode !== 'closed') this.placeCard()
      return
    }
    ;({side: this.pinSide, vertical: this.pinVertical} = pickPinPlacement(info.rect, info.forward))
    this.collapse()
    // 先定位再显示，避免小点闪现在上一次的位置
    this.pin.classList.add('hidden')
    this.placePin()
    this.pin.classList.remove('hidden')
  }

  /** 小点锚定鼠标停点（虚拟点引用），placement 决定它在停点的哪个象限 */
  private placePin(): void {
    if (!this.info) return
    // 横向：跟随鼠标停点（沿 side 方向外移 16px），并夹取在选区横向范围
    // 附近——否则最后一行很短时，小点会飞到最长行右缘外（「跑得好远」的根因）；
    // 纵向：整体放在选区块外缘 18px，永不压住正文（含选区上/下一行）。
    const r = this.info.rect
    const m = this.info.mouse
    const cx = (this.pinSide === 'left' ? -16 : 16) + clamp(m.x, r.left, r.right)
    const cy = this.pinVertical === 'up' ? r.top - 18 : r.bottom + 18
    const viewport = window.visualViewport
    const left = viewport?.offsetLeft ?? 0
    const top = viewport?.offsetTop ?? 0
    const size = window.matchMedia('(pointer: coarse)').matches ? 40 : 28
    this.pin.style.left = `${clamp(cx - size / 2, left + 8, left + (viewport?.width ?? window.innerWidth) - size - 8)}px`
    this.pin.style.top = `${clamp(cy - size / 2, top + 8, top + (viewport?.height ?? window.innerHeight) - size - 8)}px`
  }

  /** hover 小点 → 从小点原位展开撰写卡片，展开方向朝屏幕中心 */
  private expand(force = false): void {
    if (!this.info) return
    this.cancelCollapse()
    if (this.mode !== 'closed') {
      if (force) {
        this.engage()
        if (!this.composer?.isFocused()) this.composer?.focusComment()
      }
      return
    }
    this.mode = force ? 'editing' : 'hover'
    const draft = this.drafts.read(this.info)
    // 历史草稿可能存着已下架的类型（issue/slop）：回退到默认，避免 chips 无选中态
    const dk = draft?.kind ?? 'suggestion'
    const quoted = this.info.quoted
    this.card.innerHTML = `
      <div class="p-3">
        <p class="mb-2.5 line-clamp-2 border-l-2 border-primary/30 pl-2 text-[13px] text-muted-foreground">
          “${escapeHtml(quoted.length > 90 ? quoted.slice(0, 90) + '……' : quoted)}”
        </p>
        ${this.info.preview ? '<p class="mb-2 text-xs text-muted-foreground">按 Markdown 原文定位；跨格式选区会包含语法标记。</p>' : ''}
        <div data-composer></div>
        <div class="mt-2.5 flex items-center justify-between">
          <span class="flex items-center gap-1 text-xs text-muted-foreground">
            <span class="kbd">⌘</span><span class="kbd">↵</span> 提交
          </span>
          <span class="flex gap-1.5">
            <button class="btn btn-ghost btn-sm" data-op="copy" title="复制选中文本">复制原文</button>
            <button class="btn btn-default btn-sm" data-op="submit">添加批注</button>
          </span>
        </div>
      </div>`
    this.composer = new ComposerForm(
      this.card.querySelector('[data-composer]') as HTMLElement,
      {onChange: (s) => this.onComposerChange(s)},
      {
        kind: MANUAL_KINDS.includes(dk) ? dk : 'suggestion',
        comment: draft?.comment ?? '',
        replacement: draft?.replacement ?? '',
      },
    )
    this.composer.render()
    this.refreshSubmit()
    // 以 visibility:hidden 参与定位测量：display:none 会被 floating-ui 量成 0×0，
    // shift 无法感知真实宽度，靠视口右缘时卡片按零宽度定位、整块撑出屏幕外。
    // pop-in 动画的初始关键帧（scale 0.98）也会让测量矩形偏差几像素，一并停掉；
    // 坐标落定后恢复，动画从正确位置起播。
    this.card.classList.remove('hidden')
    this.card.style.visibility = 'hidden'
    this.card.style.animation = 'none'
    this.placeCard()
  }

  private collapse(): void {
    this.cancelCollapse()
    this.placementRevision++
    this.mode = 'closed'
    this.composer = null
    this.card.classList.add('hidden')
    this.card.innerHTML = ''
  }

  private scheduleCollapse(): void {
    // 已有草稿（含输入法组合中的文本）时不自动收起：hover 离开只应关掉「误触展开」
    // 的空卡片，不能在输入途中吞掉撰写内容（卡片消失的根因）。写了一半的卡片只通过
    // 提交 / 取消 / Esc / 点击卡片外部关闭。
    if (this.mode !== 'hover' || this.hasDraftContent()) return
    this.cancelCollapse()
    this.closeTimer = setTimeout(() => {
      if (this.mode === 'hover' && !this.hasDraftContent()) this.collapse()
    }, 320)
  }

  private cancelCollapse(): void {
    clearTimeout(this.closeTimer)
  }

  private engage(): void {
    if (this.mode === 'hover') this.mode = 'editing'
    this.cancelCollapse()
  }

  /** 草稿账本里当前范围是否留有撰写内容（批注语或替换词） */
  private hasDraftContent(): boolean {
    const draft = this.info && this.drafts.read(this.info)
    return Boolean(draft && hasComposition(draft))
  }

  /** 查询当前页面内未提交的划词草稿，可限制文档和文本侧。 */
  hasDrafts(docIds?: ReadonlySet<string>, side?: 'a' | 'b'): boolean {
    return this.drafts.has(docIds, side)
  }

  /** 在用户明确同意放弃后，清除受影响文档及文本侧的草稿。 */
  discardDrafts(docIds: ReadonlySet<string>, side?: 'a' | 'b'): void {
    this.drafts.discard(docIds, side)
    if (this.info && docIds.has(this.info.docId) && (!side || (this.info.side ?? 'a') === side)) this.dismiss()
  }

  /** 撰写变化：记账草稿 + 提交按钮态（表单自身已保证只做定向更新） */
  private onComposerChange(s: ComposerState): void {
    this.engage()
    if (this.info) this.drafts.write(this.info, s)
    this.refreshSubmit()
  }

  private refreshSubmit(): void {
    const submit = this.card.querySelector('[data-op="submit"]') as HTMLButtonElement | null
    if (submit && this.composer) submit.disabled = !this.composer.canSubmit()
  }

  private submit(): void {
    if (!this.composer || !this.info) return
    // 认可类允许只划不写：标记本身就是反馈；其余类型仍需描述
    if (!this.composer.canSubmit()) {
      this.composer.focusComment()
      return
    }
    const s = this.composer.state()
    if (!this.callbacks.onCreate(this.info, s.kind, s.comment.trim(), s.replacement.trim() || undefined)) return
    this.discardDraft()
    this.dismiss()
  }

  private discardDraft(): void {
    if (!this.info) return
    this.drafts.remove(this.info)
  }

  /** 滚动 / 缩放后重新锚定：选区还活着就跟随其视口矩形（卡片一并重定位）；
   * 选区没了但有草稿，收起小点、卡片作为写作面板原地保留；两者皆无才关闭。
   * 重定位只改 left/top，不动焦点与内容，输入中的面板同样安全。 */
  private reanchor(): void {
    if (!this.info) return
    const sel = window.getSelection()
    const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null
    const startNode = range?.startContainer
    const anchorEl = startNode
      ? ((startNode.nodeType === Node.TEXT_NODE ? startNode.parentElement : (startNode as Element))?.closest('.editor-blk, .markdown-body') ?? null)
      : null
    if (range && !sel!.isCollapsed && anchorEl) {
      this.info = {...this.info, rect: range.getBoundingClientRect()}
      this.placePin()
      if (this.mode !== 'closed') this.placeCard()
      return
    }
    // 「正被使用」的卡片不因选区丢失而关闭：有草稿，或输入框仍持有焦点
    //（展开即 focus，用户可能还没输入就开始滚快捷语/挪视口）
    const opening = this.mode !== 'closed' && this.card.style.visibility === 'hidden'
    const engaged = opening || this.mode === 'composing' || this.hasDraftContent() || (this.composer?.isFocused() ?? false)
    if (engaged) {
      this.placementRevision++
      this.pin.classList.add('hidden')
      const viewport = window.visualViewport
      const top = viewport?.offsetTop ?? 0
      const left = viewport?.offsetLeft ?? 0
      const height = viewport?.height ?? window.innerHeight
      const width = viewport?.width ?? window.innerWidth
      this.card.style.maxHeight = `${Math.max(0, height - 16)}px`
      const rect = this.card.getBoundingClientRect()
      this.card.style.left = `${clamp(rect.left, left + 8, Math.max(left + 8, left + width - rect.width - 8))}px`
      this.card.style.top = `${clamp(rect.top, top + 8, Math.max(top + 8, top + height - rect.height - 8))}px`
      this.revealCard()
      return
    }
    this.dismiss()
  }

  /** 收起一切（选区清除、点外部、Esc） */
  dismiss(): void {
    this.info = null
    this.pin.classList.add('hidden')
    this.collapse()
    window.getSelection()?.removeAllRanges()
    this.callbacks.onDismiss()
  }

  /** 卡片以小点为锚，朝屏幕中心展开 */
  private placeCard(): void {
    const composer = this.composer
    if (!composer || this.mode === 'closed') return
    const revision = ++this.placementRevision
    const current = () => revision === this.placementRevision && composer === this.composer && this.mode !== 'closed'
    const pr = this.pin.getBoundingClientRect()
    const cx = pr.left + pr.width / 2
    const cy = pr.top + pr.height / 2
    const side = cx < window.innerWidth / 2 ? 'right' : 'left'
    const align = cy < window.innerHeight / 2 ? 'start' : 'end'
    const placement = `${side}-${align}` as 'right-start' | 'right-end' | 'left-start' | 'left-end'
    void computePosition(this.pin, this.card, {
      placement,
      strategy: 'fixed',
      middleware: [
        offset(10),
        // crossAxis 必开：left/right placement 下 shift 默认只校正纵轴，
        // 近全宽的卡片会整块悬出左右视口缘（手机上必现）
        shift({padding: 8, crossAxis: true, limiter: limitShift()}),
        size({apply: ({availableHeight}) => {
          if (current()) this.card.style.maxHeight = `${Math.max(0, availableHeight)}px`
        }}),
      ],
    }).then(({x, y}) => {
      if (!current()) return
      this.card.style.left = `${x}px`
      this.card.style.top = `${y}px`
      this.card.style.transformOrigin = CARD_ORIGIN[placement] ?? 'top left'
      this.revealCard()
    })
  }

  private revealCard(): void {
    if (this.mode === 'closed' || !this.composer || this.card.style.visibility !== 'hidden') return
    this.card.style.visibility = ''
    this.card.style.animation = ''
    this.composer.focusComment()
  }
}

const CARD_ORIGIN: Record<string, string> = {
  'right-start': 'top left',
  'right-end': 'bottom left',
  'left-start': 'top right',
  'left-end': 'bottom right',
}

/**
 * 方向 → 小点侧别与纵向延伸。
 * 横向：正向选（左→右）小点在选区右缘外，反向选在左缘外。
 * 纵向：反向选且跨行（下→上）→ 小点在选区上方；其余（含单行，无纵向
 * 拖拽分量）→ 选区下方，不遮正文。方向信号取自 selection 的 anchor——
 * 按下点在上即正向，与鼠标松开时的像素位置无关，天然无歧义。
 */
function pickPinPlacement(rect: DOMRect, forward: boolean): {side: PinSide; vertical: 'up' | 'down'} {
  const multiLine = rect.height >= 36
  return {
    side: forward ? 'right' : 'left',
    vertical: !forward && multiLine ? 'up' : 'down',
  }
}


function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
