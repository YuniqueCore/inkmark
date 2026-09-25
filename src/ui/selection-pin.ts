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
import { escapeHtml, KIND_LABEL } from './editor'
import { icon } from './icons'
import type { AnnotationKind } from '../core/types'

export interface SelectionInfo {
  start: number
  end: number
  /** 选区首行视口矩形 */
  rect: DOMRect
  quoted: string
  /** mouseup 时鼠标视口坐标（方向判断与锚定点） */
  mouse: { x: number; y: number }
}

type PinSide = 'left' | 'right'

export interface PinCallbacks {
  onCreate: (info: SelectionInfo, kind: AnnotationKind, comment: string) => void
  onCopySelection: (quoted: string) => void
  onDismiss: () => void
}

const KINDS: AnnotationKind[] = ['issue', 'suggestion', 'question', 'highlight', 'praise']

export class SelectionPin {
  private pin: HTMLElement
  private card: HTMLElement
  private info: SelectionInfo | null = null
  /** 小点在鼠标停点的哪一侧，以及纵向延伸方向 */
  private pinSide: PinSide = 'right'
  private pinVertical: 'up' | 'down' = 'down'
  private kind: AnnotationKind = 'issue'
  private closeTimer: ReturnType<typeof setTimeout> | undefined
  /** card 已展开（hover 进入过） */
  private expanded = false

  constructor(private callbacks: PinCallbacks) {
    this.pin = document.createElement('button')
    this.pin.className =
      'fixed z-50 hidden size-7 cursor-pointer place-items-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-primary/15 transition-transform hover:scale-110'
    this.pin.title = '添加批注'
    this.pin.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" class="size-3.5"><path d="M12 5v14M5 12h14"/></svg>`

    this.card = document.createElement('div')
    this.card.className = 'popover-panel fixed z-50 hidden w-[400px]'

    document.body.append(this.pin, this.card)

    this.pin.addEventListener('mouseenter', () => this.expand())
    this.pin.addEventListener('click', () => this.expand(true))
    this.card.addEventListener('mouseenter', () => this.cancelCollapse())
    this.card.addEventListener('mouseleave', () => this.scheduleCollapse())

    this.card.addEventListener('click', (e) => {
      const chip = (e.target as HTMLElement).closest('.kind-chip') as HTMLElement | null
      if (chip) {
        this.kind = chip.dataset.kind as AnnotationKind
        this.refreshChips()
      }
    })
    this.card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) this.submit()
      if (e.key === 'Escape') {
        e.stopPropagation()
        this.dismiss()
      }
    })
    this.card.addEventListener('click', (e) => {
      const op = (e.target as HTMLElement).dataset.op
      if (op === 'submit') this.submit()
      if (op === 'cancel') this.dismiss()
      if (op === 'copy') {
        if (this.info) this.callbacks.onCopySelection(this.info.quoted)
      }
    })

    document.addEventListener('mousedown', (e) => {
      const t = e.target as HTMLElement
      if (this.pin.contains(t) || this.card.contains(t)) return
      this.dismiss()
    })
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.dismiss()
    })
    window.addEventListener('resize', () => this.dismiss())
  }

  /** mouseup 入口：选区稳定后亮出小点 */
  showFor(info: SelectionInfo): void {
    if (info.end - info.start === 0 || info.quoted.trim() === '') {
      this.dismiss()
      return
    }
    this.info = info
    ;({side: this.pinSide, vertical: this.pinVertical} = pickPinPlacement(info.rect, info.mouse))
    this.collapse()
    // 先定位再显示，避免小点闪现在上一次的位置
    this.pin.classList.add('hidden')
    void this.placePin().then(() => {
      if (this.info !== info) return
      this.pin.classList.remove('hidden')
    })
  }

  /** 小点锚定鼠标停点（虚拟点引用），placement 决定它在停点的哪个象限 */
  private placePin(): Promise<void> {
    if (!this.info) return Promise.resolve()
    // 零尺寸虚拟点在 floating-ui 里属于边界场景（cross 对齐与主轴偏移行为
    // 与文档语义不符），小点位置直接手算——行为完全确定：
    // 中心 = 鼠标停点沿 side 方向外移 24px、沿 vertical 方向移 12px，再 clamp 视口。
    const m = this.info.mouse
    const cx = (this.pinSide === 'left' ? -24 : 24) + m.x
    const cy = (this.pinVertical === 'up' ? -12 : 12) + m.y
    this.pin.style.left = `${clamp(cx - 14, 8, window.innerWidth - 36)}px`
    this.pin.style.top = `${clamp(cy - 14, 8, window.innerHeight - 36)}px`
    return Promise.resolve()
  }

  /** hover 小点 → 从小点原位展开撰写卡片，展开方向朝屏幕中心 */
  private expand(force = false): void {
    if (!this.info) return
    if (this.expanded && !force) return
    this.expanded = true
    this.cancelCollapse()
    this.kind = 'issue'
    const quoted = this.info.quoted
    this.card.innerHTML = `
      <div class="p-3">
        <p class="mb-2.5 line-clamp-2 border-l-2 border-primary/30 pl-2 text-[13px] text-muted-foreground">
          “${escapeHtml(quoted.length > 90 ? quoted.slice(0, 90) + '……' : quoted)}”
        </p>
        <div class="mb-2.5 flex flex-wrap gap-1">${KINDS.map(
          (k) => `<button class="chip-toggle kind-chip" data-kind="${k}">${icon(k)} ${KIND_LABEL[k]}</button>`,
        ).join('')}</div>
        <textarea id="pin-composer-input" class="input-base min-h-20 resize-y" placeholder="批注内容：问题给改法；认可写原因……"></textarea>
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
    this.refreshChips()
    this.card.classList.add('hidden')
    void this.placeCard().then(() => {
      this.card.classList.remove('hidden')
      const input = this.card.querySelector('#pin-composer-input') as HTMLTextAreaElement
      input.focus()
    })
  }

  private collapse(): void {
    this.expanded = false
    this.card.classList.add('hidden')
    this.card.innerHTML = ''
  }

  private scheduleCollapse(): void {
    this.cancelCollapse()
    this.closeTimer = setTimeout(() => this.collapse(), 320)
  }

  private cancelCollapse(): void {
    clearTimeout(this.closeTimer)
  }

  private refreshChips(): void {
    this.card.querySelectorAll('.kind-chip').forEach((chip) => {
      chip.classList.toggle('on', (chip as HTMLElement).dataset.kind === this.kind)
    })
  }

  private submit(): void {
    const input = this.card.querySelector('#pin-composer-input') as HTMLTextAreaElement | null
    if (!input || !this.info) return
    const comment = input.value.trim()
    if (comment === '') {
      input.focus()
      return
    }
    this.callbacks.onCreate(this.info, this.kind, comment)
    this.dismiss()
  }

  /** 收起一切（选区清除、点外部、Esc） */
  dismiss(): void {
    this.info = null
    this.expanded = false
    this.pin.classList.add('hidden')
    this.collapse()
    window.getSelection()?.removeAllRanges()
    this.callbacks.onDismiss()
  }

  /** 侧栏编辑等场景复用：以指定选区信息展开卡片 */
  openComposerFor(info: SelectionInfo, kind: AnnotationKind, comment: string): void {
    this.info = info
    ;({side: this.pinSide, vertical: this.pinVertical} = pickPinPlacement(info.rect, info.mouse))
    this.pin.classList.add('hidden')
    void this.placePin().then(() => {
      this.pin.classList.remove('hidden')
      this.expand(true)
      const input = this.card.querySelector('#pin-composer-input') as HTMLTextAreaElement | null
      if (input) input.value = comment
      this.kind = kind
      this.refreshChips()
    })
  }

  /** 卡片以小点为锚，朝屏幕中心展开 */
  private placeCard(): Promise<void> {
    const pr = this.pin.getBoundingClientRect()
    const cx = pr.left + pr.width / 2
    const cy = pr.top + pr.height / 2
    const side = cx < window.innerWidth / 2 ? 'right' : 'left'
    const align = cy < window.innerHeight / 2 ? 'start' : 'end'
    const placement = `${side}-${align}` as 'right-start' | 'right-end' | 'left-start' | 'left-end'
    return computePosition(this.pin, this.card, {
      placement,
      strategy: 'fixed',
      middleware: [
        offset(10),
        shift({padding: 8, limiter: limitShift()}),
        size({apply: ({availableHeight}) => {
          this.card.style.maxHeight = `${Math.max(220, availableHeight)}px`
        }}),
      ],
    }).then(({x, y}) => {
      this.card.style.left = `${x}px`
      this.card.style.top = `${y}px`
      this.card.style.transformOrigin = CARD_ORIGIN[placement] ?? 'top left'
    })
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
 * 横向：鼠标停在选区左端 → 小点在停点左侧；停右端 → 右侧。
 * 纵向：多行选择按鼠标在选区上/下半决定向上/向下延伸；单行选择没有纵向拖拽
 * 分量，固定向下延伸——小点落在文字行下方，不遮刚选中的内容。
 * （此前用 mouse.y < 选区中线判定，单行时鼠标恰在行中部，纵向是掷硬币——
 * 这就是「右→左划位置不对」的根因之一。）
 */
function pickPinPlacement(rect: DOMRect, mouse: {x: number; y: number}): {side: PinSide; vertical: 'up' | 'down'} {
  const atLeft = mouse.x < rect.left + rect.width / 2
  const multiLine = rect.height >= 48
  const up = multiLine && mouse.y < rect.top + rect.height / 2
  return {
    side: atLeft ? 'left' : 'right',
    vertical: up ? 'up' : 'down',
  }
}


function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
