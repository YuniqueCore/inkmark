/** W3C Web Annotation 数据模型（anno.jsonld）导入 / 导出。纯函数。
 *
 * 导出：内部批注 → 标准 Annotation（TextQuoteSelector + TextPositionSelector 双选择器，
 * kind / resolved 以 tagging body 表达，保持模型内的无损信息）。
 * 导入：优先按位置 + 原文校验；失配时按引文多策略锚定（core/quote-match.ts：
 * 精确 + 上下文消歧 + 容错模糊回锚 + 置信度门控）；锚不上的条目跳过并计数，
 * 绝不静默错锚。
 */

import { anchorQuote } from './quote-match'
import { codePointsToUtf16, textQuoteSelector, utf16ToCodePoints } from './text'
import type { Annotation, AnnotationBody, AnnotationKind, ImageDocument, ReviewDocument, RegionAnnotation } from './types'
import { isSafeId } from './session-schema'
import { isImageDocument } from './types'
import { validRegion, imageIdentity } from './image'
import { stableId } from './identity'

const ANNO_CONTEXT = 'http://www.w3.org/ns/anno.jsonld'

const KIND_TO_MOTIVATION: Record<AnnotationKind, string> = {
  issue: 'commenting',
  suggestion: 'commenting',
  question: 'commenting',
  slop: 'commenting',
  praise: 'assessing',
  highlight: 'highlighting',
}

interface TextualBody {
  type: 'TextualBody'
  value: string
  purpose: 'describing' | 'tagging'
}

export interface W3CAnnotation {
  '@context': typeof ANNO_CONTEXT
  id: string
  type: 'Annotation'
  motivation: string
  created: string
  modified: string
  body: TextualBody[]
  target: {
    source: string
    selector: Array<
      | { type: 'TextQuoteSelector'; exact: string; prefix: string; suffix: string }
      | { type: 'TextPositionSelector'; start: number; end: number }
      | { type: 'FragmentSelector'; conformsTo: string; value: string }
    >
  }
}

const MOTIVATION_TO_KIND: Record<string, AnnotationKind> = {
  commenting: 'issue',
  assessing: 'praise',
  highlighting: 'highlight',
}

/** 内部批注 → W3C Annotation 数组。改稿侧批注的 target.source 带 `#revised` 标记。 */
export function toW3C(doc: ReviewDocument, opts?: { includeResolved?: boolean }): W3CAnnotation[] {
  if (isImageDocument(doc)) return doc.annotations.filter((a) => opts?.includeResolved || a.status === 'open').map((a) => ({
    '@context': ANNO_CONTEXT, id: `urn:inkmark:doc:${doc.id}#ann=${a.id}`, type: 'Annotation',
    motivation: KIND_TO_MOTIVATION[a.kind], created: new Date(a.createdAt).toISOString(), modified: new Date(a.updatedAt).toISOString(),
    body: annotationBodies(a), target: {source: imageW3CSource(doc), selector: [{
      type: 'FragmentSelector', conformsTo: 'http://www.w3.org/TR/media-frags/',
      value: `xywh=pixel:${a.selector.x},${a.selector.y},${a.selector.width},${a.selector.height}`,
    }]},
  }))
  const revised = doc.revised
  return doc.annotations
    .filter((a) => opts?.includeResolved || a.status === 'open')
    .map((a): W3CAnnotation | null => {
      const isRevised = a.target === 'revised'
      const sourceText = isRevised ? revised : doc.text
      if (sourceText === undefined) return null
      const bodies = annotationBodies(a)
      return {
        '@context': ANNO_CONTEXT,
        id: `urn:inkmark:doc:${doc.id}#ann=${a.id}`,
        type: 'Annotation' as const,
        motivation: KIND_TO_MOTIVATION[a.kind],
        created: new Date(a.createdAt).toISOString(),
        modified: new Date(a.updatedAt).toISOString(),
        body: bodies,
        target: {
          source: isRevised ? `urn:inkmark:doc:${doc.id}#revised` : `urn:inkmark:doc:${doc.id}`,
          selector: [
            { type: 'TextQuoteSelector' as const, ...textQuoteSelector(sourceText, a.start, a.end) },
            { type: 'TextPositionSelector' as const, start: utf16ToCodePoints(sourceText, a.start), end: utf16ToCodePoints(sourceText, a.end) },
          ],
        },
      }
    })
    .filter((a): a is W3CAnnotation => a !== null)
}

/** 解析 target.source 的 inkmark URN：urn:inkmark:doc:<docId>[#revised]。
 * 非 inkmark 来源（外部标注工具）返回 docId null，由导入方回落到当前文档。 */
export function parseW3CSource(source: unknown): { docId: string | null; revised: boolean } {
  const s = typeof source === 'string' ? source : ''
  const m = s.match(/^urn:inkmark:doc:([^#]+?)(?:#(?:revised|image=[A-Za-z0-9-]+))?$/)
  return { docId: m ? m[1]! : null, revised: s.endsWith('#revised') }
}

export interface W3CImportResult {
  annotations: Annotation[]
  /** 无法锚定被跳过的条数（exact 不在目标文本中） */
  unmatched: number
  total: number
}

/** 从任意解析出的 JSON 导入 W3C 批注：接受数组 / {items} / 单对象。
 * 带 `#revised` source 的条目改锚 revisedText（对照侧批注 roundtrip）。 */
export function fromW3C(
  data: unknown,
  text: string,
  opts?: { revisedText?: string; now?: number; identityScope?: string },
): W3CImportResult {
  const items = collectW3CItems(data)
  const now = opts?.now ?? Date.now()
  const annotations: Annotation[] = []
  let unmatched = 0
  items.forEach((item) => {
    const obj = item as Record<string, unknown> | null
    const source = obj && typeof obj === 'object' ? (obj as {target?: {source?: unknown}}).target?.source : undefined
    const isRevised = typeof source === 'string' && source.endsWith('#revised')
    const targetText = isRevised ? opts?.revisedText : text
    const ann = targetText === undefined ? null : parseOne(item, targetText, now, opts?.identityScope ?? '', isRevised)
    if (ann) annotations.push(ann)
    else unmatched++
  })
  return { annotations, unmatched, total: items.length }
}

/** 收集 W3C 数据里的 Annotation 条目：数组 / {items} / 单对象 */
export function collectW3CItems(data: unknown): unknown[] {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    if (Array.isArray(obj.items)) return obj.items
    if (obj.type === 'Annotation') return [data]
    if (typeof obj.target === 'object') return [data]
  }
  return []
}

function parseOne(item: unknown, text: string, now: number, scope: string, isRevised = false): Annotation | null {
  if (!item || typeof item !== 'object') return null
  const obj = item as Record<string, unknown>
  const target = obj.target as Record<string, unknown> | undefined
  if (!target || (typeof target.source === 'string' && target.source.includes('#image='))) return null
  const selectors = Array.isArray(target.selector) ? target.selector : []
  if (selectors.some((s) => (s as Record<string, unknown>)?.type === 'FragmentSelector')) return null
  const quote = selectors.find((s) => (s as Record<string, unknown>)?.type === 'TextQuoteSelector') as
    | { exact?: unknown; prefix?: unknown; suffix?: unknown }
    | undefined
  const position = selectors.find((s) => (s as Record<string, unknown>)?.type === 'TextPositionSelector') as
    | { start?: unknown; end?: unknown }
    | undefined
  const exact = typeof quote?.exact === 'string' ? quote.exact : null
  if (exact === null || exact === '') return null

  const hint =
    position && Number.isSafeInteger(position.start) && Number.isSafeInteger(position.end) &&
    (position.start as number) >= 0 && (position.end as number) >= (position.start as number)
      ? {start: codePointsToUtf16(text, position.start as number), end: codePointsToUtf16(text, position.end as number)}
      : undefined
  const anchor = anchorQuote(
    text,
    {exact, prefix: asString(quote?.prefix), suffix: asString(quote?.suffix)},
    hint,
  )
  if (anchor === null) return null

  return {...parseW3CBody(obj, now, scope), start: anchor.start, end: anchor.end,
    ...(isRevised ? {target: 'revised' as const} : {})}
}

function parseW3CBody(obj: Record<string, unknown>, now: number, scope: string): AnnotationBody {
  const bodies = Array.isArray(obj.body)
    ? obj.body.filter((body): body is Record<string, unknown> => Boolean(body) && typeof body === 'object')
    : []
  const comments = bodies.filter((b) => b.purpose === 'describing' && typeof b.value === 'string').map((b) => b.value as string)
  const comment = comments.length ? comments.join('\n') : '(无批注内容)'
  const tags = bodies.filter((b) => b.purpose === 'tagging' && typeof b.value === 'string').map((b) => b.value as string)
  const motivation = typeof obj.motivation === 'string' ? obj.motivation : ''
  const kind = tags.find((t): t is AnnotationKind => Object.hasOwn(KIND_TO_MOTIVATION, t)) ??
    (Object.hasOwn(MOTIVATION_TO_KIND, motivation) ? MOTIVATION_TO_KIND[motivation] : undefined) ?? 'highlight'
  const status = tags.includes('resolved') ? 'resolved' : 'open'
  const parsedCreated = Date.parse(asString(obj.created) ?? '')
  const parsedModified = Date.parse(asString(obj.modified) ?? '')
  const created = Number.isFinite(parsedCreated) ? parsedCreated : now
  const modified = Number.isFinite(parsedModified) ? parsedModified : created
  const idSuffix = asString(obj.id)?.split('ann=')[1]

  return {
    id: idSuffix && isSafeId(idSuffix) ? idSuffix : stableId('w3c', [scope, asString(obj.id) ?? obj]),
    kind,
    comment,
    status,
    source: 'manual',
    createdAt: created,
    updatedAt: modified,
  }
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function annotationBodies(a: AnnotationBody): TextualBody[] {
  return [
    {type: 'TextualBody', value: a.comment, purpose: 'describing'},
    {type: 'TextualBody', value: a.kind, purpose: 'tagging'},
    ...(a.status === 'resolved' ? [{type: 'TextualBody' as const, value: 'resolved', purpose: 'tagging' as const}] : []),
  ]
}

export function imageW3CSource(doc: ImageDocument): string {
  return `urn:inkmark:doc:${doc.id}#image=${imageIdentity(doc.image)}`
}

export function fromImageW3C(data: unknown, doc: ImageDocument): {annotations: RegionAnnotation[]; unmatched: number} {
  const annotations: RegionAnnotation[] = []
  const items = collectW3CItems(data)
  const source = imageW3CSource(doc)
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>
    const target = obj.target as {source?: unknown; selector?: unknown} | undefined
    if (target?.source !== source || !Array.isArray(target.selector)) continue
    const fragments = target.selector.filter((s) => s?.type === 'FragmentSelector')
    if (fragments.length !== 1 || typeof fragments[0].value !== 'string' || fragments[0].conformsTo !== 'http://www.w3.org/TR/media-frags/') continue
    const match = /^xywh=pixel:(\d+),(\d+),(\d+),(\d+)$/.exec(fragments[0].value)
    if (!match) continue
    const selector = {type: 'rectangle' as const, x: Number(match[1]), y: Number(match[2]), width: Number(match[3]), height: Number(match[4])}
    if (!validRegion(selector, doc.image)) continue
    annotations.push({...parseW3CBody(obj, Date.now(), doc.id), selector})
  }
  return {annotations, unmatched: items.length - annotations.length}
}
