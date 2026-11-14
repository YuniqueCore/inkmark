/** 导出弹层：四种格式预览 + 复制 + 下载；W3C 页支持把批注导出为 Web Annotation JSON。
 * 支持多文档：单文档直接下载对应文件；多文档复制为按文件分节的合并文本，
 * 下载打包为 zip（每份文档一个文件，来源文件名打头）。 */

import { exportAs, exportFileName, zipEntryNames } from '../core/export'
import { toW3C } from '../core/w3c'
import { escapeHtml } from '../core/text'
import { strToU8, zipSync } from 'fflate'
import type { ImageDocument, ReviewDocument } from '../core/types'
import { isImageDocument, SESSION_VERSION, KIND_LABEL } from '../core/types'
import { filterAnnotations } from '../core/document'
import { imageBytes } from '../core/image'

export interface ExporterCallbacks {
  onCopy: (content: string) => void
  onClose: () => void
  /** W3C 页的「导入 Web Annotation JSON」：解析并合并进当前文档 */
  onImportW3C: (file: File) => void
}

type TabId = 'inline' | 'snippets' | 'review' | 'w3c'

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
      'fixed left-1/2 top-1/2 z-100 hidden w-[min(880px,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border bg-card text-card-foreground shadow-2xl'
  }

  open(docs: ReviewDocument[]): void {
    if (docs.length === 0) return
    this.docs = docs
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

  /** 单份文档在当前格式下的完整内容（zip 打包用） */
  private perDocContent(doc: ReviewDocument): string {
    if (this.format === 'w3c') {
      return JSON.stringify(toW3C(doc, { includeResolved: this.includeResolved }), null, 2)
    }
    if (isImageDocument(doc)) return this.imageReview(doc)
    return exportAs(this.format, doc.text, doc.annotations, {
      includeResolved: this.includeResolved,
      revisedText: doc.revised,
      fileName: doc.name,
    })
  }

  private content(): string {
    if (this.docs.length === 0) return ''
    const isMulti = this.docs.length > 1
    if (this.format === 'w3c') {
      const items = this.docs.flatMap((d) => toW3C(d, { includeResolved: this.includeResolved }))
      return JSON.stringify(items, null, 2)
    }
    if (isMulti) return this.docs.map((d) => `# ${d.name}\n\n${this.perDocContent(d)}`).join('\n\n---\n\n')
    const doc = this.docs[0]!
    if (isImageDocument(doc)) return this.imageReview(doc)
    return exportAs(this.format, doc.text, doc.annotations, {
      includeResolved: this.includeResolved,
      revisedText: doc.revised,
      fileName: this.includeFileInfo ? doc.name : undefined,
    })
  }

  private imageName(doc: ImageDocument): string {
    const extension = doc.image.dataUrl.startsWith('data:image/jpeg;') ? 'jpg' : doc.image.dataUrl.startsWith('data:image/webp;') ? 'webp' : 'png'
    return `image-${this.docs.indexOf(doc) + 1}.${extension}`
  }

  private imageReview(doc: ImageDocument): string {
    const regions = doc.annotations.filter((a) => this.includeResolved || a.status === 'open')
    return [`# ${doc.name}`, `![原图](${this.imageName(doc)})`,
      `原图尺寸：${doc.image.width} × ${doc.image.height} px。坐标原点在左上角，区域为 x, y, width, height。`,
      ...regions.map((a, i) => {
        const r = a.selector
        return `## ${i + 1}. ${KIND_LABEL[a.kind]}${a.status === 'resolved' ? ' · 已解决' : ''}\n\n区域：(${r.x}, ${r.y}, ${r.width}, ${r.height}) px\n\n${a.comment}`
      }),
    ].join('\n\n')
  }

  private render(): void {
    if (this.docs.length === 0) return
    const isW3C = this.format === 'w3c'
    const isMulti = this.docs.length > 1
    const hasImages = this.docs.some(isImageDocument)
    const content = this.content()
    const tab = TABS.find((t) => t.id === this.format)!
    this.modal.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b px-4 py-3 sm:px-5 sm:py-3.5">
        <div class="flex flex-wrap items-center gap-1" role="tablist">
          ${TABS.filter((t) => !hasImages || t.id === 'review' || t.id === 'w3c').map(
            (t) =>
              `<button role="tab" class="btn btn-ghost btn-sm ${this.format === t.id ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground'}" data-tab="${t.id}">${t.label}</button>`,
          ).join('')}
        </div>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
          ${isW3C || isMulti
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
                isW3C ? '输出为合并的 Annotation 数组（target.source 标注来源文档）。' : '输出按文件分节，每节顶部标注来源文件名；下载打包为 zip。'
              }`
            : hasImages ? (isW3C ? '图片坐标批注 JSON；不含原图。请在同一图片文档上导入，完整备份请下载评审包。' : '下载评审包：原图 + 区域坐标与意见 + 可重新导入的完整 JSON 备份。复制只包含文字，请同时附上原图。') : tab.hint
        }</p>
        <textarea readonly id="export-preview" class="input-base mt-2.5 h-[42vh] resize-none font-mono text-[13px] leading-relaxed"></textarea>
      </div>
      <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t bg-muted/40 px-4 py-3 sm:px-5">
        <span class="text-xs text-muted-foreground">${content.length.toLocaleString()} 字符</span>
        <span class="flex gap-1.5">
          ${isW3C ? `<button class="btn btn-outline btn-sm" data-op="import">导入 W3C JSON…</button>` : ''}
          <button class="btn btn-outline btn-sm" data-op="download">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
            下载 .${!isW3C && (isMulti || hasImages) ? 'zip' : isW3C ? 'json' : 'md'}
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
    this.modal.querySelector('[data-op="download"]')?.addEventListener('click', () => {
      // 文件名以来源文档名打头（chapter-3-批注-snippets-2026-09-28.md），
      // 而不是产品名——多份文档的批注文件放在一起才分得清谁是谁；
      // 多文档下载打包为 zip，每份文档一个文件。
      const a = document.createElement('a')
      if (isMulti || (hasImages && !isW3C)) {
        const files: Record<string, Uint8Array> = {}
        const names = zipEntryNames(this.docs.map((d) => d.name), this.format)
        this.docs.forEach((d, i) => {
          files[names[i]!] = strToU8(this.perDocContent(d))
        })
        if (hasImages && !isW3C) {
          for (const doc of this.docs) if (isImageDocument(doc)) files[this.imageName(doc)] = imageBytes(doc.image)
          files['inkmark-documents.json'] = strToU8(JSON.stringify({version: SESSION_VERSION, docs: this.docs.map((doc) => filterAnnotations(doc, (a) => this.includeResolved || a.status === 'open')), activeDocId: this.docs[0]!.id, trash: [], savedAt: Date.now()}))
        }
        const zipped = zipSync(files)
        a.href = URL.createObjectURL(new Blob([zipped], { type: 'application/zip' }))
        a.download = `批注-${this.format}-${this.docs.length}文档-${new Date().toISOString().slice(0, 10)}.zip`
      } else {
        const doc = this.docs[0]!
        const type = isW3C ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8'
        a.href = URL.createObjectURL(new Blob([preview.value], { type }))
        a.download = exportFileName(doc.name, this.format, new Date())
      }
      a.click()
      URL.revokeObjectURL(a.href)
    })
    this.modal.querySelector('[data-op="import"]')?.addEventListener('click', () => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json,application/json'
      input.addEventListener('change', () => {
        const file = input.files?.[0]
        if (file) {
          this.callbacks.onImportW3C(file)
          this.render()
        }
      })
      input.click()
    })
    this.modal.querySelector('[data-op="close"]')?.addEventListener('click', () => this.close())
  }
}
