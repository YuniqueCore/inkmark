/** 与 Brains 一样使用 Lezer 的 Markdown 语法范围，所有坐标都是源文 UTF-16 偏移。 */
import { GFM, parser } from '@lezer/markdown'
import { highlightTree, tagHighlighter, tags } from '@lezer/highlight'
import type { TextStyleRange } from './render-text'

const markdown = parser.configure(GFM)
const highlighter = tagHighlighter([
  {tag: tags.heading, class: 'md-syntax-heading'},
  {tag: tags.strong, class: 'md-syntax-strong'},
  {tag: tags.emphasis, class: 'md-syntax-emphasis'},
  {tag: tags.strikethrough, class: 'md-syntax-strike'},
  {tag: tags.link, class: 'md-syntax-link'},
  {tag: tags.url, class: 'md-syntax-url'},
  {tag: tags.monospace, class: 'md-syntax-code'},
  {tag: tags.quote, class: 'md-syntax-quote'},
  {tag: tags.labelName, class: 'md-syntax-meta'},
  {tag: tags.string, class: 'md-syntax-literal'},
  {tag: tags.comment, class: 'md-syntax-comment'},
  {tag: [tags.meta, tags.processingInstruction, tags.contentSeparator, tags.atom, tags.escape, tags.character], class: 'md-syntax-mark'},
])

export function markdownSyntaxRanges(text: string): TextStyleRange[] {
  const ranges: TextStyleRange[] = []
  highlightTree(markdown.parse(text), highlighter, (start, end, classes) => ranges.push({start, end, classes}))
  return ranges
}
