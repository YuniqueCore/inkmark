/** 与 Brains 一样使用 Lezer 的 Markdown 语法范围，所有坐标都是源文 UTF-16 偏移。 */
import { GFM, parser } from '@lezer/markdown'
import { highlightTree, tagHighlighter, tags } from '@lezer/highlight'
import type { TextStyleRange } from './render-text'

const markdown = parser.configure(GFM)
const highlighter = tagHighlighter([
  {tag: [tags.heading1, tags.heading2, tags.heading3, tags.heading4, tags.heading5, tags.heading6], class: 'md-syntax-heading'},
  {tag: tags.strong, class: 'md-syntax-strong'},
  {tag: tags.emphasis, class: 'md-syntax-emphasis'},
  {tag: tags.strikethrough, class: 'md-syntax-strike'},
  {tag: tags.link, class: 'md-syntax-link'},
  {tag: tags.url, class: 'md-syntax-url'},
  {tag: tags.monospace, class: 'md-syntax-code'},
  {tag: tags.quote, class: 'md-syntax-quote'},
  {tag: [tags.meta, tags.processingInstruction], class: 'md-syntax-mark'},
])

export function markdownSyntaxRanges(text: string): TextStyleRange[] {
  const ranges: TextStyleRange[] = []
  highlightTree(markdown.parse(text), highlighter, (start, end, classes) => ranges.push({start, end, classes}))
  return ranges
}
