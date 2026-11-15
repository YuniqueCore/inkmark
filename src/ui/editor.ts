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
  onEmpty: (root: HTMLElement, sample: () => void) => void
}

export class EditorView {
  private root: HTMLElement
  private onEmpty: (root: HTMLElement, sample: () => void) => void

  constructor(root: HTMLElement, callbacks: EditorCallbacks) {
    this.root = root
    this.onEmpty = callbacks.onEmpty
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
      this.onEmpty(this.root, onEmptySample ?? (() => {}))
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
