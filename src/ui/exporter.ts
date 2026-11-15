/** 导出弹层：四种格式预览 + 复制 + 下载；W3C 页支持把批注导出为 Web Annotation JSON。
 * 支持多文档：单文档直接下载对应文件；多文档复制为按文件分节的合并文本，
 * 评审下载打包为 zip；W3C 下载为单份合并 JSON。 */

import { buildReviewExport, type ReviewFormat } from '../core/review-export'
import { escapeHtml } from '../core/text'
import {artifactFile} from '../platform/export-artifact'
import type { ReviewDocument } from '../core/types'
import { isImageDocument } from '../core/types'
import {exportFile} from './file-transfer'
import {bindFileInput} from '../platform/files'
import {toast} from './toast'

export interface ExporterCallbacks {
  onCopy: (content: string) => void
  onClose: () => void
  /** W3C 页的「导入 Web Annotation JSON」：明确来源按身份分发；外部来源仅在单文档导出时回落该目标 */
  onImportW3C: (file: File, fallbackDocId: string | null) => void | Promise<void>
}

type TabId = ReviewFormat

const TABS: Array<{ id: TabId; label: string; hint: string }> = [
  { id: 'inline', label: '原文 + 批注', hint: '完整原文，批注以行内标记插在锚点后' },
  { id: 'snippets', label: '片段 + 批注', hint: '只列被批注的片段和对应批注' },
  { id: 'review', label: '评审引用块', hint: 'Markdown 引用格式，直接贴回给 AI agent' },
  {
    id: 'w3c',
    label: 'W3C 批注',
    hint: 'W3C Web Annotation JSON（quote + position 双选择器），可导入回本工具或供其他标注工具使用',
  },
]

export class ExporterView {
  private modal: HTMLElement
  private overlay: HTMLElement
  private format: TabId = 'inline'
  private includeResolved = false
  private includeFileInfo = false
  private docs: ReviewDocument[] = []

  constructor(
    modal: HTMLElement,
    overlay: HTMLElement,
    private callbacks: ExporterCallbacks,
  ) {
    this.modal = modal
    this.overlay = overlay
    // 弹层骨架类名只在这里设置一次；hidden 的显隐由 open()/close() 切换。
    // 此前 render() 每次重绘都重写整串 className（含 hidden），点 tab 会把弹层藏掉。
    this.modal.className =
      'viewport-dialog fixed left-1/2 top-1/2 z-100 hidden w-[min(880px,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border bg-card text-card-foreground shadow-2xl'
  }

  open(docs: ReviewDocument[], options: {includeResolved?: boolean} = {}): void {
    if (docs.length === 0) return
    this.docs = docs
    this.includeResolved = options.includeResolved ?? false
    if (docs.some(isImageDocument) && (this.format === 'inline' || this.format === 'snippets')) this.format = 'review'
    this.render()
    this.overlay.classList.remove('hidden')
    this.modal.classList.remove('hidden')
  }

  close(): void {
    this.docs = []
    this.overlay.classList.add('hidden')
    this.modal.classList.add('hidden')
    this.callbacks.onClose()
  }

  private render(): void {
    if (this.docs.length === 0) return
    const isW3C = this.format === 'w3c'
    const isMulti = this.docs.length > 1
    const hasImages = this.docs.some(isImageDocument)
    const artifact = buildReviewExport(this.docs, this.format, {includeResolved: this.includeResolved, includeFileInfo: this.includeFileInfo})
    const content = artifact.preview
    const tab = TABS.find((t) => t.id === this.format)!
    this.modal.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b px-4 py-3 sm:px-5 sm:py-3.5">
        <div class="flex flex-wrap items-center gap-1" role="tablist">
          ${TABS.filter((t) => !hasImages || t.id === 'review' || t.id === 'w3c').map(
            (t) =>
              `<button role="tab" aria-selected="${this.format === t.id}" class="btn btn-ghost btn-sm ${this.format === t.id ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground'}" data-tab="${t.id}">${t.label}</button>`,
          ).join('')}
        </div>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
          ${isW3C || isMulti || hasImages
            ? ''
            : `<label class="flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
          <input type="checkbox" id="inc-file-info" class="size-3.5 accent-[var(--primary)]" ${this.includeFileInfo ? 'checked' : ''}/>
          包含文件信息
        </label>`}
          <label class="flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
            <input type="checkbox" id="inc-resolved" class="size-3.5 accent-[var(--primary)]" ${this.includeResolved ? 'checked' : ''}/>
            包含已解决
          </label>
        </div>
      </div>
      <div class="px-5 pt-3">
        <p class="text-[13px] text-muted-foreground">${
          isMulti
            ? `已选 ${this.docs.length} 份文档：${escapeHtml(this.docs.map((d) => d.name).join('、'))}。${
                isW3C ? '复制与下载均为合并 JSON，保留各文档来源；不含原图。' : hasImages ? '下载 ZIP 包含原图、逐份评审及所选批注的可导入 JSON；复制仅包含文字，请同时附上原图。' : '输出按文件分节，每节顶部标注来源文件名；下载打包为 zip。'
              }`
            : hasImages ? (isW3C ? '图片坐标批注 JSON；不含原图。请在同一图片文档上导入，完整备份请用更多菜单。' : '下载评审包：原图 + 区域坐标与意见 + 所选批注的可导入 JSON。复制只包含文字，请同时附上原图。') : tab.hint
        }</p>
        <textarea readonly id="export-preview" class="input-base mt-2.5 h-[42vh] resize-none font-mono text-[13px] leading-relaxed"></textarea>
      </div>
      <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t bg-muted/40 px-4 py-3 sm:px-5">
        <span class="text-xs text-muted-foreground">${content.length.toLocaleString()} 字符</span>
        <span class="flex gap-1.5">
          ${isW3C ? `<button class="btn btn-outline btn-sm" data-op="import">导入 W3C JSON…</button>` : ''}
          <button class="btn btn-outline btn-sm" data-op="download">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
            下载 .${artifact.kind === 'bundle' ? 'zip' : isW3C ? 'json' : 'md'}
          </button>
          <button class="btn btn-default btn-sm" data-op="copy">复制到剪贴板</button>
          <button class="btn btn-ghost btn-sm" data-op="close">关闭</button>
        </span>
      </div>`
    const preview = this.modal.querySelector('#export-preview') as HTMLTextAreaElement
    preview.value = content

    this.modal.querySelectorAll('[data-tab]').forEach((btn) =>
      btn.addEventListener('click', () => {
        this.format = (btn as HTMLElement).dataset.tab as TabId
        this.render()
      }),
    )
    this.modal.querySelector('#inc-resolved')?.addEventListener('change', (e) => {
      this.includeResolved = (e.target as HTMLInputElement).checked
      this.render()
    })
    this.modal.querySelector('#inc-file-info')?.addEventListener('change', (e) => {
      this.includeFileInfo = (e.target as HTMLInputElement).checked
      this.render()
    })
    this.modal.querySelector('[data-op="copy"]')?.addEventListener('click', () => {
      this.callbacks.onCopy(preview.value)
    })
    this.modal.querySelector('[data-op="download"]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget as HTMLButtonElement
      button.disabled = true
      try { await exportFile(artifactFile(artifact)) }
      finally { button.disabled = false }
    })
    this.modal.querySelector('[data-op="import"]')?.addEventListener('click', () => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json,application/json'
      const exporting = this.docs
      const choose = bindFileInput(input, async files => {
        const file = files[0]
        if (!file) return
        await this.callbacks.onImportW3C(file, exporting.length === 1 ? exporting[0]!.id : null)
        if (this.docs === exporting) this.close()
      }, toast)
      choose()
    })
    this.modal.querySelector('[data-op="close"]')?.addEventListener('click', () => this.close())
  }
}
