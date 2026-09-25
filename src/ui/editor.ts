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
  slop: 'AI 味',
}

/** 多类重叠时取优先级最高的底色 */
const KIND_PRIORITY: AnnotationKind[] = ['slop', 'issue', 'suggestion', 'question', 'highlight']

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
  onSelectionChange: () => void
  onAnnotationClick: (id: string) => void
}

export class EditorView {
  private root: HTMLElement

  constructor(root: HTMLElement, callbacks: EditorCallbacks) {
    this.root = root
    this.root.addEventListener('mouseup', callbacks.onSelectionChange)
    this.root.addEventListener('keyup', (e) => {
      // Shift 方向键选词后同样唤起工具条
      if (e.key.startsWith('Arrow') || e.key === 'a' || e.key === 'A') callbacks.onSelectionChange()
    })
    this.root.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('.seg-hl') as HTMLElement | null
      if (!target) return
      const ids = (target.dataset.annIds ?? '').split(' ').filter(Boolean)
      if (ids.length > 0) callbacks.onAnnotationClick(ids[0]!)
    })
  }

  render(text: string, annotations: Annotation[], onEmptySample?: () => void): void {
    if (text.trim() === '') {
      this.root.innerHTML = `
        <div class="editor-empty">
          <h2>InkMark</h2>
          <p>粘贴或打开一段文本（支持 .txt / .md），划选文字即可批注。<br>
          顶部「slop 预扫描」会用 anti-slop 词库自动标出套话候选。</p>
          <button class="btn primary" id="btn-empty-sample">载入示例文本</button>
        </div>`
      this.root.querySelector('#btn-empty-sample')?.addEventListener('click', () => onEmptySample?.())
      return
    }
    const blocks = splitBlocks(text)
    const parts = blocks.map((b) => {
      const anns = annotations.filter((a) => a.start < b.start + b.text.length && a.end > b.start)
      return `<p class="blk" data-start="${b.start}">${renderBlockContent(b.text, anns, b.start)}</p>`
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
