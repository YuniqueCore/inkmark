/** 划词交互：选区 → 浮动工具条 → 批注撰写弹层。 */

import { escapeHtml, KIND_LABEL } from './editor'
import type { AnnotationKind } from '../core/types'

const KIND_ICON: Record<AnnotationKind, string> = {
  issue: '⚠️',
  suggestion: '💬',
  question: '❓',
  highlight: '✅',
  slop: '⚠️',
}

export interface SelectionInfo {
  start: number
  end: number
  rect: DOMRect
  quoted: string
}

export interface SelectionCallbacks {
  /** 把 DOM 选区换算成规范文本偏移；选区不在编辑区内返回 null */
  resolveSelection: () => SelectionInfo | null
  onCreate: (info: SelectionInfo, kind: AnnotationKind, comment: string) => void
  onCopySelection: (quoted: string) => void
}

const KINDS: AnnotationKind[] = ['issue', 'suggestion', 'question', 'highlight']

export class SelectionController {
  private toolbar: HTMLElement
  private composer: HTMLElement
  private current: SelectionInfo | null = null
  private currentKind: AnnotationKind = 'issue'
  /** 正在编辑的批注 id；null = 新建 */
  private editingId: string | null = null

  constructor(private callbacks: SelectionCallbacks) {
    this.toolbar = document.createElement('div')
    this.toolbar.className = 'popover-panel hidden'
    this.toolbar.innerHTML = `
      <div class="flex items-center gap-0.5 p-1">
        <button class="btn btn-ghost btn-sm" data-op="annotate">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4v16h16"/><path d="M8 16V8l8 8h4"/></svg>
          批注 <span class="kbd ml-1">⌘↵</span>
        </button>
        <button class="btn btn-ghost btn-sm" data-op="copy">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
          复制
        </button>
      </div>`
    this.composer = document.createElement('div')
    this.composer.className = 'popover-panel hidden'
    document.body.append(this.toolbar, this.composer)

    this.toolbar.addEventListener('click', (e) => {
      const op = (e.target as HTMLElement).dataset.op
      if (op === 'annotate') this.openComposer()
      if (op === 'copy') {
        if (this.current) this.callbacks.onCopySelection(this.current.quoted)
        this.closeAll()
      }
    })
    this.composer.addEventListener('click', (e) => {
      const chip = (e.target as HTMLElement).closest('.kind-chip') as HTMLElement | null
      if (chip) {
        this.currentKind = chip.dataset.kind as AnnotationKind
        this.refreshChips()
      }
    })
    this.composer.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) this.submit()
      if (e.key === 'Escape') {
        e.stopPropagation()
        this.closeAll()
      }
    })
    document.addEventListener('mousedown', (e) => {
      const t = e.target as HTMLElement
      if (!this.toolbar.contains(t) && !this.composer.contains(t)) this.closeToolbar()
    })
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeAll()
    })
  }

  /** mouseup / keyup 入口 */
  handleSelection(): void {
    const info = this.callbacks.resolveSelection()
    if (!info || info.end - info.start === 0) {
      this.closeToolbar()
      return
    }
    this.current = info
    this.placePanel(this.toolbar, info.rect)
    this.toolbar.classList.remove('hidden')
  }

  /** 打开撰写弹层（editingId 非空 = 编辑已有批注） */
  openComposerFor(info: SelectionInfo, kind: AnnotationKind = 'issue', comment = '', editingId: string | null = null): void {
    this.current = info
    this.currentKind = kind
    this.editingId = editingId
    this.composer.innerHTML = `
      <div class="w-[360px] p-3">
        <p class="mb-2.5 line-clamp-2 border-l-2 border-primary/30 pl-2 text-[13px] text-muted-foreground">
          “${escapeHtml(info.quoted.length > 90 ? info.quoted.slice(0, 90) + '……' : info.quoted)}”
        </p>
        <div class="mb-2.5 flex flex-wrap gap-1">${KINDS.map(
          (k) => `<button class="chip-toggle kind-chip" data-kind="${k}">${KIND_ICON[k]} ${KIND_LABEL[k]}</button>`,
        ).join('')}</div>
        <textarea id="composer-input" class="input-base min-h-20 resize-y" placeholder="批注内容：指出问题、给出改法……"></textarea>
        <div class="mt-2.5 flex items-center justify-between">
          <span class="flex items-center gap-1 text-xs text-muted-foreground">
            <span class="kbd">⌘</span><span class="kbd">↵</span> 提交 · <span class="kbd">Esc</span> 取消
          </span>
          <span class="flex gap-1.5">
            <button class="btn btn-ghost btn-sm" data-op="cancel">取消</button>
            <button class="btn btn-default btn-sm" data-op="submit">${editingId ? '保存修改' : '添加批注'}</button>
          </span>
        </div>
      </div>`
    const input = this.composer.querySelector('#composer-input') as HTMLTextAreaElement
    input.value = comment
    this.refreshChips()
    this.placePanel(this.composer, info.rect, true)
    this.composer.classList.remove('hidden')
    this.composer.querySelectorAll('[data-op]').forEach((btn) =>
      btn.addEventListener('click', (e) => {
        const op = (e.target as HTMLElement).dataset.op
        if (op === 'submit') this.submit()
        if (op === 'cancel') this.closeAll()
      }),
    )
    input.focus()
  }

  private openComposer(): void {
    if (!this.current) return
    this.openComposerFor(this.current)
  }

  private refreshChips(): void {
    this.composer.querySelectorAll('.kind-chip').forEach((chip) => {
      chip.classList.toggle('on', (chip as HTMLElement).dataset.kind === this.currentKind)
    })
  }

  private submit(): void {
    const input = this.composer.querySelector('#composer-input') as HTMLTextAreaElement | null
    if (!input || !this.current) return
    const comment = input.value.trim()
    if (comment === '') {
      input.focus()
      return
    }
    if (this.editingId) {
      this.callbacks.onCreate(this.current, this.currentKind, comment)
    } else {
      this.callbacks.onCreate(this.current, this.currentKind, comment)
    }
    this.closeAll()
  }

  /** 编辑入口由侧栏调用：不依赖 live selection */
  get editing(): string | null {
    return this.editingId
  }

  closeToolbar(): void {
    this.toolbar.classList.add('hidden')
  }

  closeAll(): void {
    this.toolbar.classList.add('hidden')
    this.composer.classList.add('hidden')
    this.current = null
    this.editingId = null
    window.getSelection()?.removeAllRanges()
  }

  private placePanel(panel: HTMLElement, rect: DOMRect, below = false): void {
    panel.style.visibility = 'hidden'
    panel.classList.remove('hidden')
    const pw = panel.offsetWidth
    const ph = panel.offsetHeight
    let left = rect.left + window.scrollX + rect.width / 2 - pw / 2
    left = Math.max(8, Math.min(left, window.scrollX + document.documentElement.clientWidth - pw - 8))
    const top = below
      ? rect.bottom + window.scrollY + 8
      : rect.top + window.scrollY - ph - 8
    panel.style.left = `${left}px`
    panel.style.top = `${Math.max(8, top)}px`
    panel.style.visibility = 'visible'
  }
}
