/** 编辑区渲染：把块 + 分段画成 DOM。只负责画，不持状态。 */

import { buildSegments } from '../core/anchors'
import { splitBlocks } from '../core/text'
import type { Annotation, AnnotationKind } from '../core/types'

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export const KIND_LABEL: Record<AnnotationKind, string> = {
  issue: '问题',
  suggestion: '建议',
  question: '疑问',
  highlight: '重点',
  praise: '认可',
  slop: 'AI 味',
}

/** 多类重叠时取优先级最高的底色 */
const KIND_PRIORITY: AnnotationKind[] = ['slop', 'issue', 'praise', 'suggestion', 'question', 'highlight']

function renderBlockContent(blockText: string, blockAnns: Annotation[], blockStart: number): string {
  const segments = buildSegments(blockStart, blockText, blockAnns)
  return segments
    .map((seg) => {
      const html = escapeHtml(seg.text).replaceAll('\n', '<br>')
      if (seg.annIds.length === 0) return html
      const kinds = seg.annIds
        .map((id) => blockAnns.find((a) => a.id === id)?.kind ?? 'issue')
        .filter((k, i, arr) => arr.indexOf(k) === i)
      const kind = KIND_PRIORITY.find((k) => kinds.includes(k)) ?? 'issue'
      return `<span class="seg-hl k-${kind}" data-ann-ids="${seg.annIds.join(' ')}">${html}</span>`
    })
    .join('')
}

export interface EditorCallbacks {
  onSelectionChange: (e: MouseEvent) => void
  onAnnotationClick: (id: string, rect: DOMRect) => void
}

export class EditorView {
  private root: HTMLElement

  constructor(root: HTMLElement, callbacks: EditorCallbacks) {
    this.root = root
    this.root.addEventListener('mouseup', (e) => callbacks.onSelectionChange(e))
    this.root.addEventListener('keyup', (e) => {
      // Shift 方向键选词后同样唤起标注小点（锚定到选区矩形，鼠标点用选区中点近似）
      if (e.key.startsWith('Arrow') || e.key === 'a' || e.key === 'A') {
        const sel = window.getSelection()
        if (sel && sel.rangeCount > 0) {
          const rect = sel.getRangeAt(0).getBoundingClientRect()
          callbacks.onSelectionChange(new MouseEvent('keyup', {
            clientX: rect.left + rect.width / 2,
            clientY: rect.bottom,
          }))
        }
      }
    })
    this.root.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('.seg-hl') as HTMLElement | null
      if (!target) return
      const ids = (target.dataset.annIds ?? '').split(' ').filter(Boolean)
      if (ids.length > 0) callbacks.onAnnotationClick(ids[0]!, target.getBoundingClientRect())
    })
  }

  render(text: string, annotations: Annotation[], onEmptySample?: () => void): void {
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
            <button class="btn btn-default btn-sm" id="btn-empty-sample">载入示例文本</button>
            <span class="text-xs text-muted-foreground">或直接把文本粘贴进来</span>
          </div>
        </div>`
      this.root.querySelector('#btn-empty-sample')?.addEventListener('click', () => onEmptySample?.())
      return
    }
    const blocks = splitBlocks(text)
    const parts = blocks.map((b) => {
      const anns = annotations.filter((a) => a.start < b.start + b.text.length && a.end > b.start)
      return `<p class="editor-blk" data-start="${b.start}">${renderBlockContent(b.text, anns, b.start)}</p>`
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
}
