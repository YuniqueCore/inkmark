/** 编辑区渲染：把块 + 分段画成 DOM。只负责画，不持状态。 */

import type { DiffRow } from '../core/diff'
import { splitBlocks } from '../core/text'
import type { Annotation } from '../core/types'
import type { MatchRange } from '../core/batch'
import { rangeOfOffsets } from './selection-offsets'
import { renderAnnotatedText, type TextStyleRange } from './render-text'
import {observeTextSelection, type SelectionPoint} from './text-selection'

/** 编辑原文模式下的选段过滤：批注只与同侧的行相交 */
function annsForSide(anns: Annotation[], revised: boolean): Annotation[] {
  return anns.filter((a) => revised === (a.target === 'revised'))
}

export interface EditorCallbacks {
  onSelectionChange: (e: SelectionPoint) => void
  onAnnotationClick: (id: string, rect: DOMRect) => void
  onNewDocument: () => void
}

export interface EditModeCallbacks {
  onSave: (text: string) => void
  onCancel: () => void
}

export class EditorView {
  private root: HTMLElement
  private onNewDocument: () => void

  constructor(root: HTMLElement, callbacks: EditorCallbacks) {
    this.root = root
    this.onNewDocument = callbacks.onNewDocument
    observeTextSelection(this.root, callbacks.onSelectionChange)
    this.root.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('.seg-hl') as HTMLElement | null
      if (!target) return
      const ids = (target.dataset.annIds ?? '').split(' ').filter(Boolean)
      if (ids.length > 0) callbacks.onAnnotationClick(ids[0]!, target.getBoundingClientRect())
    })
  }

  render(
    text: string,
    annotations: Annotation[],
    onEmptySample?: () => void,
    searchRanges: MatchRange[] = [],
    syntax: TextStyleRange[] = [],
  ): void {
    if (text.trim() === '') {
      this.root.innerHTML = `
        <div class="mx-auto mt-[18vh] max-w-md rounded-xl border border-dashed bg-card/60 p-8 text-center">
          <div class="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-lg border bg-secondary">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="size-5 text-muted-foreground"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
          </div>
          <h2 class="text-base font-semibold tracking-tight">从一段文本开始</h2>
          <p class="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            粘贴或打开 .txt / .md，划选文字即可批注；<br>
            「slop 预扫描」会用 anti-slop 词库自动标出套话候选。
          </p>
          <div class="mt-5 flex items-center justify-center gap-2">
            <button class="btn btn-default btn-sm" id="btn-empty-paste">粘贴新建文档</button>
            <button class="btn btn-outline btn-sm" id="btn-empty-sample">载入示例文本</button>
          </div>
          <p class="mt-3 text-xs text-muted-foreground">也可以直接粘贴截图，或拖入 PNG / JPEG / WebP 图片进行区域批注</p>
        </div>`
      this.root.querySelector('#btn-empty-sample')?.addEventListener('click', () => onEmptySample?.())
      this.root.querySelector('#btn-empty-paste')?.addEventListener('click', this.onNewDocument)
      return
    }
    const blocks = splitBlocks(text)
    const originalAnnotations = annsForSide(annotations, false)
    const parts = blocks.map((b) => {
      const anns = originalAnnotations.filter((a) => a.start < b.start + b.text.length && a.end > b.start)
      const hits = searchRanges.filter((r) => r.start < b.start + b.text.length && r.end > b.start)
      return `<p class="editor-blk" data-start="${b.start}">${renderAnnotatedText(b.text, b.start, anns, hits, syntax)}</p>`
    })
    this.root.innerHTML = parts.join('')
  }

  /**
   * 对照视图：原文 vs AI 改稿的 track-changes 行渲染。
   * del / equal 行带 .editor-blk + data-start——原文侧批注高亮、点击、划选换算复用批注视图机制；
   * add 行带 data-side="b"，改稿侧批注（target === 'revised'）同样可点击、可划选撰写。
   */
  renderDiff(rows: DiffRow[], annotations: Annotation[]): void {
    const parts = rows.map((row) => {
      const mark = row.type === 'del' ? '−' : row.type === 'add' ? '+' : ''
      if (row.type === 'add') {
        const bStart = row.bStart ?? 0
        const anns = annsForSide(annotations, true).filter(
          (a) => a.start < bStart + row.text.length && a.end > bStart,
        )
        const inner = renderAnnotatedText(row.text, bStart, anns)
        return (
          `<div class="diff-row diff-add"><span class="diff-mark" aria-hidden="true">${mark}</span>` +
          `<p class="editor-blk diff-blk" data-start="${bStart}" data-side="b">${inner || '<br>'}</p></div>`
        )
      }
      const aStart = row.aStart ?? 0
      const anns = annsForSide(annotations, false).filter(
        (a) => a.start < aStart + row.text.length && a.end > aStart,
      )
      const inner = renderAnnotatedText(row.text, aStart, anns)
      return (
        `<div class="diff-row diff-${row.type}"><span class="diff-mark" aria-hidden="true">${mark}</span>` +
        `<p class="editor-blk diff-blk" data-start="${aStart}">${inner || '<br>'}</p></div>`
      )
    })
    this.root.innerHTML = parts.join('')
  }

  /** 编辑原文模式：textarea 直改规范文本；完成时由 main 统一重锚批注。 */
  renderEditMode(text: string, callbacks: EditModeCallbacks): void {
    this.root.innerHTML = `
      <div class="mx-auto flex h-full max-w-[880px] flex-col">
        <textarea id="edit-source" class="input-base mt-4 min-h-0 flex-1 resize-none font-mono text-[14px] leading-[1.9]" spellcheck="false"></textarea>
        <div class="my-4 flex items-center justify-between rounded-xl border bg-card/60 px-4 py-3">
          <span class="text-xs text-muted-foreground">直接修改规范文本；完成后批注将按引文自动重新锚定，改不掉的钉在改动处。</span>
          <span class="flex gap-2">
            <button class="btn btn-outline btn-sm" data-op="cancel-edit-text">取消</button>
            <button class="btn btn-default btn-sm" data-op="save-edit-text">完成并重锚批注</button>
          </span>
        </div>
      </div>`
    const ta = this.root.querySelector('#edit-source') as HTMLTextAreaElement
    ta.value = text
    this.root.querySelector('[data-op="save-edit-text"]')?.addEventListener('click', () => callbacks.onSave(ta.value))
    this.root.querySelector('[data-op="cancel-edit-text"]')?.addEventListener('click', () => callbacks.onCancel())
  }

  /** 编辑模式下的 textarea 当前内容；不在编辑模式时返回 null */
  editValue(): string | null {
    const ta = this.root.querySelector('#edit-source') as HTMLTextAreaElement | null
    return ta ? ta.value : null
  }

  /** 侧栏定位：滚动到批注的高亮处并短暂描边。 */
  focusAnnotation(id: string): void {
    const el = this.root.querySelector(`.seg-hl[data-ann-ids~="${id}"]`) as HTMLElement | null
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('active')
    setTimeout(() => el.classList.remove('active'), 1400)
  }

  /** 搜索跳转：滚动到规范文本偏移处（预览描边由 searchRanges 渲染负责）。 */
  scrollToRange(start: number, end: number): void {
    const range = rangeOfOffsets(this.root, start, end)
    if (!range) return
    const rect = range.getBoundingClientRect()
    const host = this.root.getBoundingClientRect()
    const margin = 60
    if (rect.top < host.top + margin || rect.bottom > host.bottom - margin) {
      this.root.scrollTop += rect.top - host.top - this.root.clientHeight / 2 + rect.height
    }
  }
}
