/** 划词交互：选区 → 浮动工具条 → 批注撰写弹层。 */

import { escapeHtml, KIND_LABEL } from './editor'
import type { AnnotationKind } from '../core/types'

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
    this.toolbar.className = 'float-panel float-toolbar hidden'
    this.toolbar.innerHTML = `
      <button class="btn" data-op="annotate">批注</button>
      <button class="btn" data-op="copy">复制</button>
    `
    this.composer = document.createElement('div')
    this.composer.className = 'float-panel composer hidden'
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
      <p class="quote">“${escapeHtml(info.quoted.length > 80 ? info.quoted.slice(0, 80) + '……' : info.quoted)}”</p>
      <div class="kinds">${KINDS.map(
        (k) => `<button class="kind-chip" data-kind="${k}">${KIND_LABEL[k]}</button>`,
      ).join('')}</div>
      <textarea id="composer-input" placeholder="批注内容：指出问题、给出改法……"></textarea>
      <div class="row">
        <span class="hint">⌘/Ctrl + Enter 提交 · Esc 取消</span>
        <span>
          <button class="btn" data-op="cancel">取消</button>
          <button class="btn primary" data-op="submit">${editingId ? '保存' : '添加批注'}</button>
        </span>
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
