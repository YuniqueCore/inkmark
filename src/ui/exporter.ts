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

  private format = 'inline' as ExportFormat
  private includeResolved = false

  close(): void {
    this.overlay.classList.add('hidden')
    this.modal.classList.add('hidden')
    this.callbacks.onClose()
  }

  private render(text: string, annotations: Annotation[]): void {
    const content = exportAs(this.format, text, annotations, { includeResolved: this.includeResolved })
    const tab = TABS.find((t) => t.id === this.format)!
    this.modal.className =
      'fixed left-1/2 top-1/2 z-100 hidden w-[min(880px,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border bg-card text-card-foreground shadow-2xl'
    this.modal.innerHTML = `
      <div class="flex items-center justify-between border-b px-5 py-3.5">
        <div class="flex items-center gap-1" role="tablist">
          ${TABS.map(
            (t) =>
              `<button role="tab" class="btn btn-ghost btn-sm ${this.format === t.id ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground'}" data-tab="${t.id}">${t.label}</button>`,
          ).join('')}
        </div>
        <label class="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" id="inc-resolved" class="size-3.5 accent-[var(--primary)]" ${this.includeResolved ? 'checked' : ''}/>
          包含已解决
        </label>
      </div>
      <div class="px-5 pt-3">
        <p class="text-[13px] text-muted-foreground">${tab.hint}</p>
        <textarea readonly id="export-preview" class="input-base mt-2.5 h-[46vh] resize-none font-mono text-[13px] leading-relaxed"></textarea>
      </div>
      <div class="flex items-center justify-between border-t bg-muted/40 px-5 py-3">
        <span class="text-xs text-muted-foreground">${content.length.toLocaleString()} 字符</span>
        <span class="flex gap-1.5">
          <button class="btn btn-outline btn-sm" data-op="download">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
            下载 .md
          </button>
          <button class="btn btn-default btn-sm" data-op="copy">复制到剪贴板</button>
          <button class="btn btn-ghost btn-sm" data-op="close">关闭</button>
        </span>
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
