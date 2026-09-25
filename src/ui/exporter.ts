/** 导出弹层：三种格式预览 + 复制 + 下载。 */

import { exportAs, type ExportFormat } from '../core/export'
import type { Annotation } from '../core/types'

export interface ExporterCallbacks {
  onCopy: (content: string) => void
  onClose: () => void
}

const TABS: Array<{ id: ExportFormat; label: string; hint: string }> = [
  { id: 'inline', label: '原文 + 批注', hint: '完整原文，批注以行内标记插在锚点后' },
  { id: 'snippets', label: '片段 + 批注', hint: '只列被批注的片段和对应批注' },
  { id: 'review', label: '评审引用块', hint: 'Markdown 引用格式，直接贴回给 AI agent' },
]

export class ExporterView {
  private modal: HTMLElement
  private overlay: HTMLElement
  private format: ExportFormat = 'inline'
  private includeResolved = false

  constructor(
    modal: HTMLElement,
    overlay: HTMLElement,
    private callbacks: ExporterCallbacks,
  ) {
    this.modal = modal
    this.overlay = overlay
  }

  open(text: string, annotations: Annotation[]): void {
    this.render(text, annotations)
    this.overlay.classList.remove('hidden')
    this.modal.classList.remove('hidden')
  }

  close(): void {
    this.overlay.classList.add('hidden')
    this.modal.classList.add('hidden')
    this.callbacks.onClose()
  }

  private render(text: string, annotations: Annotation[]): void {
    const content = exportAs(this.format, text, annotations, { includeResolved: this.includeResolved })
    const tab = TABS.find((t) => t.id === this.format)!
    this.modal.innerHTML = `
      <div class="tabs">
        ${TABS.map(
          (t) => `<button class="tab ${this.format === t.id ? 'on' : ''}" data-tab="${t.id}">${t.label}</button>`,
        ).join('')}
        <label class="label-check">
          <input type="checkbox" id="inc-resolved" ${this.includeResolved ? 'checked' : ''}/>
          包含已解决
        </label>
      </div>
      <p style="margin:0 0 10px;color:var(--ink-soft);font-size:13px">${tab.hint}</p>
      <textarea readonly id="export-preview"></textarea>
      <div class="foot">
        <button class="btn" data-op="download">下载 .md</button>
        <button class="btn primary" data-op="copy">复制到剪贴板</button>
        <button class="btn" data-op="close">关闭</button>
      </div>`
    const preview = this.modal.querySelector('#export-preview') as HTMLTextAreaElement
    preview.value = content

    this.modal.querySelectorAll('[data-tab]').forEach((btn) =>
      btn.addEventListener('click', () => {
        this.format = (btn as HTMLElement).dataset.tab as ExportFormat
        this.render(text, annotations)
      }),
    )
    this.modal.querySelector('#inc-resolved')?.addEventListener('change', (e) => {
      this.includeResolved = (e.target as HTMLInputElement).checked
      this.render(text, annotations)
    })
    this.modal.querySelector('[data-op="copy"]')?.addEventListener('click', () => {
      this.callbacks.onCopy(preview.value)
    })
    this.modal.querySelector('[data-op="download"]')?.addEventListener('click', () => {
      const blob = new Blob([preview.value], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `inkmark-${this.format}-${new Date().toISOString().slice(0, 10)}.md`
      a.click()
      URL.revokeObjectURL(url)
    })
    this.modal.querySelector('[data-op="close"]')?.addEventListener('click', () => this.close())
  }
}
