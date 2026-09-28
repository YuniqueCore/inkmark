/** W3C Web Annotation 数据模型（anno.jsonld）导入 / 导出。纯函数。
 *
 * 导出：内部批注 → 标准 Annotation（TextQuoteSelector + TextPositionSelector 双选择器，
 * kind / resolved 以 tagging body 表达，保持模型内的无损信息）。
 * 导入：优先按位置 + 原文校验；失配时按引文多策略锚定（core/quote-match.ts：
 * 精确 + 上下文消歧 + 容错模糊回锚 + 置信度门控）；锚不上的条目跳过并计数，
 * 绝不静默错锚。
 */

import { anchorQuote } from './quote-match'
import { textQuoteSelector } from './text'
import type { Annotation, AnnotationKind, DocItem } from './types'

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
    >
  }
}

const MOTIVATION_TO_KIND: Record<string, AnnotationKind> = {
  commenting: 'issue',
  assessing: 'praise',
  highlighting: 'highlight',
}

/** 内部批注 → W3C Annotation 数组。改稿侧批注的 target.source 带 `#revised` 标记。 */
export function toW3C(doc: DocItem, opts?: { includeResolved?: boolean }): W3CAnnotation[] {
  const revised = doc.revised
  return doc.annotations
    .filter((a) => opts?.includeResolved || a.status === 'open')
    .map((a) => {
      const isRevised = a.target === 'revised'
      const sourceText = isRevised ? revised : doc.text
      if (sourceText === undefined) return null
      const bodies: TextualBody[] = [{ type: 'TextualBody', value: a.comment, purpose: 'describing' }]
      bodies.push({ type: 'TextualBody', value: a.kind, purpose: 'tagging' })
      if (a.status === 'resolved') bodies.push({ type: 'TextualBody', value: 'resolved', purpose: 'tagging' })
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
            { type: 'TextPositionSelector' as const, start: a.start, end: a.end },
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
  const m = s.match(/^urn:inkmark:doc:([^#]+?)(?:#revised)?$/)
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
  opts?: { revisedText?: string; now?: number },
): W3CImportResult {
  const items = collectW3CItems(data)
  const now = opts?.now ?? Date.now()
  const annotations: Annotation[] = []
  let unmatched = 0
  items.forEach((item, idx) => {
    const obj = item as Record<string, unknown> | null
    const isRevised =
      !!obj && typeof obj === 'object' &&
      (obj as { target?: { source?: unknown } })?.target?.source?.toString().includes('#revised') === true
    const targetText = isRevised ? opts?.revisedText : text
    const ann = targetText === undefined ? null : parseOne(item, targetText, now, idx, isRevised)
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

function parseOne(item: unknown, text: string, now: number, idx: number, isRevised = false): Annotation | null {
  if (!item || typeof item !== 'object') return null
  const obj = item as Record<string, unknown>
  const target = obj.target as Record<string, unknown> | undefined
  if (!target) return null
  const selectors = Array.isArray(target.selector) ? target.selector : []
  const quote = selectors.find((s) => (s as Record<string, unknown>)?.type === 'TextQuoteSelector') as
    | { exact?: unknown; prefix?: unknown; suffix?: unknown }
    | undefined
  const position = selectors.find((s) => (s as Record<string, unknown>)?.type === 'TextPositionSelector') as
    | { start?: unknown; end?: unknown }
    | undefined
  const exact = typeof quote?.exact === 'string' ? quote.exact : null
  if (exact === null || exact === '') return null

  const hint =
    position && typeof position.start === 'number' && typeof position.end === 'number'
      ? {start: position.start, end: position.end}
      : undefined
  const anchor = anchorQuote(
    text,
    {exact, prefix: asString(quote?.prefix), suffix: asString(quote?.suffix)},
    hint,
  )
  if (anchor === null) return null

  const bodies = Array.isArray(obj.body) ? (obj.body as Array<Record<string, unknown>>) : []
  const comment =
    bodies
      .filter((b) => b.purpose === 'describing' && typeof b.value === 'string')
      .map((b) => b.value as string)
      .join('\n') || '(无批注内容)'
  const tags = bodies.filter((b) => b.purpose === 'tagging').map((b) => String(b.value ?? ''))
  const kind = tags.find((t): t is AnnotationKind => t in KIND_TO_MOTIVATION) ??
    MOTIVATION_TO_KIND[String(obj.motivation ?? '')] ?? 'highlight'
  const status = tags.includes('resolved') ? 'resolved' : 'open'
  const created = Date.parse(asString(obj.created) ?? '') || now
  const modified = Date.parse(asString(obj.modified) ?? '') || created
  const idSuffix = asString(obj.id)?.split('ann=')[1]

  return {
    id: idSuffix || `w3c-${now}-${idx}`,
    start: anchor.start,
    end: anchor.end,
    kind,
    comment,
    status,
    source: 'manual',
    ...(isRevised ? { target: 'revised' as const } : {}),
    createdAt: created,
    updatedAt: modified,
  }
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}
