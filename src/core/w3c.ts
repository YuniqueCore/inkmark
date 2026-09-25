/** W3C Web Annotation 数据模型（anno.jsonld）导入 / 导出。纯函数。
 *
 * 导出：内部批注 → 标准 Annotation（TextQuoteSelector + TextPositionSelector 双选择器，
 * kind / resolved 以 tagging body 表达，保持模型内的无损信息）。
 * 导入：优先按位置 + 原文校验；失配时按 exact 全文搜索、prefix/suffix 消歧重锚
 * （robust anchoring）；找不到的条目跳过并计数，绝不静默错锚。
 */

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

/** 内部批注 → W3C Annotation 数组。 */
export function toW3C(doc: DocItem, opts?: { includeResolved?: boolean }): W3CAnnotation[] {
  return doc.annotations
    .filter((a) => opts?.includeResolved || a.status === 'open')
    .map((a) => {
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
          source: `urn:inkmark:doc:${doc.id}`,
          selector: [
            { type: 'TextQuoteSelector' as const, ...textQuoteSelector(doc.text, a.start, a.end) },
            { type: 'TextPositionSelector' as const, start: a.start, end: a.end },
          ],
        },
      }
    })
}

export interface W3CImportResult {
  annotations: Annotation[]
  /** 无法锚定被跳过的条数（exact 不在目标文本中） */
  unmatched: number
  total: number
}

/** 从任意解析出的 JSON 导入 W3C 批注：接受数组 / {items} / 单对象。 */
export function fromW3C(data: unknown, text: string, now = Date.now()): W3CImportResult {
  const items = collectItems(data)
  const annotations: Annotation[] = []
  let unmatched = 0
  items.forEach((item, idx) => {
    const ann = parseOne(item, text, now, idx)
    if (ann) annotations.push(ann)
    else unmatched++
  })
  return { annotations, unmatched, total: items.length }
}

function collectItems(data: unknown): unknown[] {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    if (Array.isArray(obj.items)) return obj.items
    if (obj.type === 'Annotation') return [data]
    if (typeof obj.target === 'object') return [data]
  }
  return []
}

function parseOne(item: unknown, text: string, now: number, idx: number): Annotation | null {
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

  const anchor = reanchor(text, exact, asString(quote?.prefix), asString(quote?.suffix), position)
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
    createdAt: created,
    updatedAt: modified,
  }
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

/**
 * 锚点解析：①位置选择器处原文与 exact 一致 → 直接用；②全文唯一直接用；
 * ③多处命中时用 prefix / suffix 消歧（匹配数最多者，平局取最早）。
 */
function reanchor(
  text: string,
  exact: string,
  prefix: string | undefined,
  suffix: string | undefined,
  position: { start?: unknown; end?: unknown } | undefined,
): { start: number; end: number } | null {
  const p = prefix ?? ''
  const s = suffix ?? ''
  if (position && typeof position.start === 'number' && typeof position.end === 'number') {
    if (
      position.start >= 0 &&
      position.end <= text.length &&
      text.slice(position.start, position.end) === exact
    ) {
      return { start: position.start, end: position.end }
    }
  }
  let at = text.indexOf(exact)
  if (at === -1) return null
  let best = at
  let bestScore = scoreAt(text, at, exact.length, p, s)
  if (bestScore < 2) {
    while (at !== -1) {
      const score = scoreAt(text, at, exact.length, p, s)
      if (score > bestScore) {
        best = at
        bestScore = score
        if (score === 2) break
      }
      at = text.indexOf(exact, at + 1)
    }
  }
  return { start: best, end: best + exact.length }
}

function scoreAt(text: string, at: number, len: number, prefix: string, suffix: string): number {
  let score = 0
  if (prefix === '' || (at >= prefix.length && text.startsWith(prefix, at - prefix.length))) score++
  if (suffix === '' || text.startsWith(suffix, at + len)) score++
  return score
}
