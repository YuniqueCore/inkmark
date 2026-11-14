/** 把同一段规范文本上的批注、搜索和语法样式组合为安全的 DOM 片段。 */
import { buildSegments } from '../core/anchors'
import { escapeHtml } from '../core/text'
import type { MatchRange } from '../core/batch'
import type { Annotation, AnnotationKind } from '../core/types'

export interface TextStyleRange { start: number; end: number; classes: string }
const KIND_PRIORITY: AnnotationKind[] = ['slop', 'issue', 'praise', 'suggestion', 'question', 'highlight']

export function renderAnnotatedText(
  text: string,
  start: number,
  annotations: Annotation[],
  search: MatchRange[] = [],
  styles: TextStyleRange[] = [],
  lineBreaks = true,
): string {
  const segments = buildSegments(start, text, annotations, search)
  let cursor = start
  return segments.map((segment) => {
    const end = cursor + segment.text.length
    // Lezer 返回按位置排序且互不重叠的范围；二分找到首个相交范围。
    let low = 0
    let high = styles.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if (styles[mid]!.end <= cursor) low = mid + 1
      else high = mid
    }
    let position = cursor
    let index = low
    let content = ''
    while (position < end) {
      const style = styles[index]
      const applied = style && style.start <= position && style.end > position ? style : undefined
      const next = applied ? Math.min(end, applied.end) : Math.min(end, style?.start ?? end)
      const from = position - start
      const to = next - start
      const value = lineBreaks ? renderLineBreaks(text, from, to) : escapeHtml(text.slice(from, to))
      content += applied ? `<span class="${applied.classes}">${value}</span>` : value
      position = next
      if (applied) index++
    }
    cursor = end
    if (segment.annIds.length === 0) return segment.search ? `<span class="seg-search">${content}</span>` : content
    const kinds = segment.annIds.map((id) => annotations.find((a) => a.id === id)?.kind ?? 'issue')
    const kind = KIND_PRIORITY.find((k) => kinds.includes(k)) ?? 'issue'
    const lost = segment.annIds.every((id) => annotations.find((a) => a.id === id)?.anchorLost)
    return `<span class="seg-hl k-${kind}${lost ? ' seg-lost' : ''}${segment.search ? ' seg-search' : ''}" ${lost ? 'title="原引文已不在原文中，批注钉在改动处"' : ''} data-ann-ids="${escapeHtml(segment.annIds.join(' '))}">${content}</span>`
  }).join('')
}

/** 隐藏 CRLF 的 CR 但保留其一个 UTF-16 单位，DOM 偏移与原文一致。 */
function renderLineBreaks(text: string, start: number, end: number): string {
  const chunk = text.slice(start, end)
  const breaks = /[\r\n]/g
  let cursor = 0
  let html = ''
  for (let match = breaks.exec(chunk); match; match = breaks.exec(chunk)) {
    html += escapeHtml(chunk.slice(cursor, match.index))
    html += match[0] === '\r' && text[start + match.index + 1] === '\n'
      ? '<span hidden aria-hidden="true">&#13;</span>'
      : '<br>'
    cursor = match.index + 1
  }
  return html + escapeHtml(chunk.slice(cursor))
}
