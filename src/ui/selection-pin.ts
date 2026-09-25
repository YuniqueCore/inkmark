/** 选区标注小点：选区稳定后出现在最近选区角上的圆点，hover 自然展开为撰写卡片。
 *
 * 位置跟随鼠标轨迹：鼠标停在选择矩形的哪个角附近，小点就贴哪个角——
 * 左→右划停右端 → 右下；右→左划停左端 → 左下；右下→左上划 → 左上。
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
  /** mouseup 时鼠标视口坐标（轨迹预测用） */
  mouse: { x: number; y: number }
}

type Corner = 'tl' | 'tr' | 'bl' | 'br'

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
  private corner: Corner = 'br'
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
    // card 内 hover 保持展开；整片离开后延迟收回（未提交时）
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
    this.corner = pickCorner(info.rect, info.mouse)
    this.placePin()
    this.pin.classList.remove('hidden')
    this.pin.classList.add('grid')
    // 收起已展开的卡片（换选区时）
    this.collapse()
  }

  private placePin(): void {
    if (!this.info) return
    // 贴角 → floating-ui placement：tl→top-start / tr→top-end / bl→bottom-start / br→bottom-end
    const placement = CORNER_PLACEMENT[this.corner]
    const reference = rectReference(this.info.rect)
    void computePosition(reference, this.pin, {
      placement,
      strategy: 'fixed',
      middleware: [offset({mainAxis: 12, crossAxis: 22}), shift({padding: 8, limiter: limitShift()})],
    }).then(({x, y}) => {
      this.pin.style.left = `${x}px`
      this.pin.style.top = `${y}px`
    })
  }

  /** hover 小点 → 原位展开撰写卡片，展开方向由贴角决定 */
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
        <textarea id="pin-composer-input" class="input-base min-h-20 resize-y" placeholder="批注内容：指出问题、给出改法……"></textarea>
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
    this.placeCard()
    this.card.classList.remove('hidden')
    const input = this.card.querySelector('#pin-composer-input') as HTMLTextAreaElement
    input.focus()
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
    this.pin.classList.remove('grid')
    this.collapse()
    window.getSelection()?.removeAllRanges()
    this.callbacks.onDismiss()
  }

  /** 侧栏编辑等场景复用：直接以指定选区信息展开卡片 */
  openComposerFor(info: SelectionInfo, kind: AnnotationKind, comment: string): void {
    this.info = info
    this.corner = pickCorner(info.rect, info.mouse)
    this.placePin()
    this.pin.classList.remove('hidden')
    this.pin.classList.add('grid')
    this.expand(true)
    const input = this.card.querySelector('#pin-composer-input') as HTMLTextAreaElement | null
    if (input) input.value = comment
    this.kind = kind
    this.refreshChips()
  }

  private placeCard(): void {
    if (!this.info) return
    // 卡片以 pin 为锚，向屏幕中心方向展开；size 中间件限制最大高度防溢出
    const placement = CORNER_CARD_PLACEMENT[this.corner]
    void computePosition(this.pin, this.card, {
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

/** 轨迹预测：鼠标点夹取到选择矩形上，看它落在哪个角附近 */
function pickCorner(rect: DOMRect, mouse: { x: number; y: number }): Corner {
  const cx = clamp(mouse.x, rect.left, rect.right)
  const cy = clamp(mouse.y, rect.top, rect.bottom)
  const nearLeft = cx - rect.left <= rect.right - cx
  const nearTop = cy - rect.top <= rect.bottom - cy
  return nearLeft ? (nearTop ? 'tl' : 'bl') : nearTop ? 'tr' : 'br'
}

const CORNER_PLACEMENT: Record<Corner, 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end'> = {
  tl: 'top-start',
  tr: 'top-end',
  bl: 'bottom-start',
  br: 'bottom-end',
}

/** 卡片从 pin 向屏幕中心展开的 placement 与 transform-origin */
const CORNER_CARD_PLACEMENT: Record<Corner, 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end'> = {
  tl: 'bottom-start',
  tr: 'bottom-end',
  bl: 'top-start',
  br: 'top-end',
}

const CARD_ORIGIN: Record<string, string> = {
  'top-start': 'bottom left',
  'top-end': 'bottom right',
  'bottom-start': 'top left',
  'bottom-end': 'top right',
}

/** 选择矩形 → floating-ui 虚拟引用 */
function rectReference(rect: DOMRect): {getBoundingClientRect: () => DOMRect} {
  return {getBoundingClientRect: () => rect}
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
