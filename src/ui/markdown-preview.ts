/** Markdown 预览和源文位置映射：同一 micromark 事件流驱动渲染与选区。 */
import { compile, parse, postprocess, preprocess } from 'micromark'
import { gfm, gfmHtml } from 'micromark-extension-gfm'
import morphdom from 'morphdom'
import type { Event, HtmlExtension, Token } from 'micromark-util-types'
import type { Annotation, DocItem } from '../core/types'
import type { MatchRange } from '../core/batch'
import type { SelectionInfo } from './selection-pin'
import { renderAnnotatedText } from './render-text'
import { isSurrogateBoundary } from '../core/text'

declare module 'micromark-util-types' {
  interface TokenTypeMap { inkSource: 'inkSource' }
}

const visible = new Set([
  'data', 'characterEscape', 'characterReference', 'codeTextData', 'codeFlowValue',
  'htmlFlowData', 'htmlTextData', 'autolinkProtocol', 'autolinkEmail',
  'literalAutolinkEmail', 'literalAutolinkHttp', 'literalAutolinkWww',
])
const hiddenContext = new Set(['image', 'definition', 'resource', 'reference', 'codeFencedFence'])
const sourceExtension: HtmlExtension = {
  enter: {inkSource(token) { this.tag(`<span class="md-source" data-source-start="${token.start.offset}" data-source-end="${token.end.offset}">`) }},
  exit: {inkSource() { this.tag('</span>') }},
}
interface ImageState { docId: string | null; text: string | null; revision: number; approved: Set<number> }

function compileMarkdown(text: string): string {
  const events = postprocess(parse({extensions: [gfm()]}).document().write(preprocess()(text, undefined, true)))
  const result: Event[] = []
  const stack: string[] = []
  const wrappers = new Map<Token, Token>()
  for (const event of events) {
    const [action, token, context] = event
    if (action === 'enter') {
      const lineInText = token.type === 'lineEnding' && (stack.includes('paragraph') || stack.includes('codeText'))
      if ((visible.has(token.type) || lineInText) && !stack.some((type) => hiddenContext.has(type))) {
        const wrapper: Token = {type: 'inkSource', start: token.start, end: token.end}
        wrappers.set(token, wrapper)
        result.push(['enter', wrapper, context])
      }
      stack.push(token.type)
      result.push(event)
    } else {
      result.push(event)
      const wrapper = wrappers.get(token)
      if (wrapper) result.push(['exit', wrapper, context])
      stack.pop()
    }
  }
  return compile({htmlExtensions: [gfmHtml(), sourceExtension]})(result)
}

/** 只对用户点击的图片发起请求；重绘保留现有图片节点和正在进行的加载。 */
function protectImages(fragment: DocumentFragment, state: ImageState): void {
  fragment.querySelectorAll('img').forEach((image, index) => {
    const ownerDoc = state.docId
    const ownerText = state.text
    const src = image.getAttribute('src') ?? ''
    const alt = image.getAttribute('alt') || '图片'
    if (state.approved.has(index)) {
      image.dataset.previewImage = String(index)
      image.referrerPolicy = 'no-referrer'
      return
    }
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'markdown-image-placeholder'
    button.dataset.previewPlaceholder = `${state.revision}:${index}:${src}:${alt}`
    button.textContent = `图片：${alt}（点击加载）`
    button.disabled = !src
    button.addEventListener('click', () => {
      state.approved.add(index)
      const loaded = document.createElement('img')
      loaded.alt = alt
      loaded.dataset.previewImage = String(index)
      loaded.referrerPolicy = 'no-referrer'
      loaded.addEventListener('error', () => {
        if (ownerDoc !== state.docId || ownerText !== state.text) return
        state.approved.delete(index)
        button.textContent = `图片加载失败：${alt}（点击重试）`
        loaded.replaceWith(button)
      }, {once: true})
      button.replaceWith(loaded)
      loaded.src = src
    })
    image.replaceWith(button)
  })
}

/** 叠加批注时只替换文本节点，保留解析器生成的链接、表格和排版结构。 */
export class MarkdownPreviewView {
  private cachedText: string | null = null
  private cachedHtml = ''
  private images: ImageState = {docId: null, text: null, revision: 0, approved: new Set()}

  constructor(private root: HTMLElement) {}

  render(docId: string, text: string, annotations: Annotation[], search: MatchRange[]): void {
    const root = this.root
    const state = this.images
    if (state.docId !== docId || state.text !== text) {
      state.docId = docId
      state.text = text
      state.approved.clear()
      state.revision++
    }
    if (this.cachedText !== text) {
      this.cachedHtml = compileMarkdown(text)
      this.cachedText = text
    }
    const template = document.createElement('template')
    template.innerHTML = this.cachedHtml
    protectImages(template.content, state)
    template.content.querySelectorAll<HTMLAnchorElement>('a').forEach((link) => {
      const href = link.getAttribute('href') ?? ''
      if (!href) link.removeAttribute('href')
      else if (!href.startsWith('#')) {
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
      }
    })
    const spans = Array.from(template.content.querySelectorAll<HTMLElement>('.md-source'))
    const nonProjectable = new Set(annotations.filter((a) => /\]\s*[([]/.test(text.slice(a.start, a.end))).map((a) => a.id))
    for (const span of spans) {
      const start = Number(span.dataset.sourceStart)
      const end = Number(span.dataset.sourceEnd)
      if (text.slice(start, end) === (span.textContent ?? '')) continue
      for (const ann of annotations) {
        if (ann.start < end && ann.end > start && !(ann.start <= start && ann.end >= end)) nonProjectable.add(ann.id)
      }
    }
    const projectable = annotations.filter((a) => !nonProjectable.has(a.id))
    for (const span of spans) {
      const start = Number(span.dataset.sourceStart)
      const end = Number(span.dataset.sourceEnd)
      const rendered = span.textContent ?? ''
      const linear = text.slice(start, end) === rendered
      span.dataset.sourceMapping = linear ? 'linear' : 'atomic'
      const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT)
      const nodes: Text[] = []
      while (walker.nextNode()) nodes.push(walker.currentNode as Text)
      let offset = 0
      for (const node of nodes) {
        const value = node.data
        const selected = linear ? projectable : projectable.filter((a) => a.start <= start && a.end >= end).map((a) => ({...a, start: 0, end: value.length}))
        const hits = linear ? search : search.filter((hit) => hit.start <= start && hit.end >= end).map(() => ({start: 0, end: value.length}))
        const html = renderAnnotatedText(value, linear ? start + offset : 0, selected, hits, [], false)
        const part = document.createElement('template')
        part.innerHTML = html
        node.replaceWith(part.content)
        offset += value.length
      }
    }
    const next = root.cloneNode(false) as HTMLElement
    next.append(template.content)
    morphdom(root, next, {
      childrenOnly: true,
      getNodeKey: (node) => {
        if (!(node instanceof HTMLElement)) return undefined
        if (node.dataset.previewImage !== undefined) return `preview-image-${node.dataset.previewImage}`
        if (node.dataset.previewPlaceholder !== undefined) return `preview-placeholder-${node.dataset.previewPlaceholder}`
        return node.id
      },
      onBeforeElUpdated: (current, target) => !(current instanceof HTMLImageElement && target instanceof HTMLImageElement && current.dataset.previewImage === target.dataset.previewImage),
    })
  }
}

/** 无法精确表示的局部实体选区明确拒绝，绝不推测源文坐标。 */
export function resolvePreviewSelection(event: Pick<MouseEvent, 'clientX' | 'clientY'>, root: HTMLElement, doc: DocItem): {info: SelectionInfo | null; error?: string} {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return {info: null}
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return {info: null}
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    if (node.parentElement?.closest('.md-source') || !range.intersectsNode(node)) continue
    const from = node === range.startContainer ? range.startOffset : 0
    const to = node === range.endContainer ? range.endOffset : node.length
    if (node.data.slice(from, to).trim()) return {info: null, error: '选区包含无法映射到原文的内容，请重新选择正文。'}
  }
  let start: number | null = null
  let end: number | null = null
  for (const span of root.querySelectorAll<HTMLElement>('.md-source')) {
    if (!range.intersectsNode(span)) continue
    const length = (span.textContent ?? '').length
    const prefix = (node: Node, offset: number): number => {
      const part = document.createRange()
      part.selectNodeContents(span)
      part.setEnd(node, offset)
      return part.toString().length
    }
    const from = span.contains(range.startContainer) ? prefix(range.startContainer, range.startOffset) : 0
    const to = span.contains(range.endContainer) ? prefix(range.endContainer, range.endOffset) : length
    if (to <= from) continue
    const sourceStart = Number(span.dataset.sourceStart)
    const sourceEnd = Number(span.dataset.sourceEnd)
    const linear = span.dataset.sourceMapping === 'linear'
    if (!linear && (from !== 0 || to !== length)) return {info: null, error: '此字符由一个 Markdown 实体或转义生成，请完整选中它。'}
    const mappedStart = linear ? sourceStart + from : sourceStart
    const mappedEnd = linear ? sourceStart + to : sourceEnd
    if (isSurrogateBoundary(doc.text, mappedStart) || isSurrogateBoundary(doc.text, mappedEnd)) {
      return {info: null, error: '请完整选中该字符。'}
    }
    if (end !== null) {
      if (mappedStart < end) return {info: null, error: '此选区的显示顺序与原文不同，请缩小选区。'}
      const gap = doc.text.slice(end, mappedStart)
      if (/\]\s*[([]/.test(gap) || !/^[\s*_~`#>\[\]()!|+.\-\d]*$/.test(gap)) {
        return {info: null, error: '选区跨越未显示的 Markdown 内容，请在原文中选择。'}
      }
    }
    start ??= mappedStart
    end = mappedEnd
  }
  if (start === null || end === null || end <= start) return {info: null, error: '请选中预览中的正文文字。'}
  const quoted = doc.text.slice(start, end)
  if (!quoted.trim()) return {info: null}
  return {info: {
    start, end, quoted, sourceText: doc.text, preview: true, docId: doc.id,
    rect: range.getBoundingClientRect(), mouse: {x: event.clientX, y: event.clientY},
    forward: selection.anchorNode === range.startContainer && selection.anchorOffset === range.startOffset,
  }}
}
