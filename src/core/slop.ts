/** slop 词库扫描 —— anti-slop-kit `slop_check.py` 的 TS 移植（候选信号检测，非作者鉴定）。
 *
 * 管线与参考实现一致：保护区掩码 → 逐词库收集 → 重叠去重 → cluster/density 升级 → 跨词库合并。
 * 与参考实现的既有差异（有意保留）：未闭合代码围栏额外保护到文末，编辑中的半截围栏不误报。
 */

import type { Annotation, SlopEntry, SlopHit, SlopLexicon } from './types'

interface CompiledEntry {
  regex: RegExp
  categoryId: string
  label: string
  entry: SlopEntry
}

/** python re flag 名 → JS flag。词库当前只用 IGNORECASE / MULTILINE；未知 flag 无 JS 对应，忽略。 */
const PY_FLAGS: Record<string, string> = { IGNORECASE: 'i', MULTILINE: 'm', DOTALL: 's' }

const compileCache = new Map<string, RegExp>()

function compile(source: string, pyFlags: string[] = []): RegExp {
  const key = pyFlags.join(',') + '\u0000' + source
  let re = compileCache.get(key)
  if (!re) {
    let jsFlags = 'gu'
    for (const f of pyFlags) {
      const mapped = PY_FLAGS[f]
      if (mapped && !jsFlags.includes(mapped)) jsFlags += mapped
    }
    re = new RegExp(source, jsFlags)
    compileCache.set(key, re)
  }
  return re
}

function blankOut(match: string): string {
  // 等长占位且保留换行，保证偏移与段落结构不变（对齐 slop_check.py 的 protect()）
  return match.replace(/[^\n]/g, '·')
}

/**
 * 保护区掩码：代码围栏 → 行内代码 → URL / 邮箱（顺序对齐 slop_check.py）。
 * 后续模式在前一步掩码后的文本上匹配，代码内的 URL 不会重复命中。
 */
export function maskProtected(text: string): string {
  let out = text.replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g, blankOut)
  out = out.replace(/`[^`\n]+`/g, blankOut)
  out = out.replace(/https?:\/\/\S+|\b[\w.-]+@[\w.-]+\.\w+\b/g, blankOut)
  return out
}

/** 段落起始偏移：按空行分段（与 slop_check.py split_paragraphs 同一正则语义）。 */
function splitParagraphStarts(scannable: string): number[] {
  const starts: number[] = []
  for (const m of scannable.matchAll(/[^\n]+(?:\n(?!\n)[^\n]*)*/g)) {
    if (m.index !== undefined) starts.push(m.index)
  }
  return starts
}

function paragraphIndexOf(starts: number[], offset: number): number {
  // bisect_right(starts, offset) - 1：落在空行分隔区的偏移归前一个段落
  let lo = 0
  let hi = starts.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (starts[mid]! <= offset) lo = mid + 1
    else hi = mid
  }
  return lo - 1
}

interface RawHit {
  entry: CompiledEntry
  start: number
  end: number
  matched: string
}

function collectMatches(entries: CompiledEntry[], scannable: string): RawHit[] {
  const hits: RawHit[] = []
  for (const entry of entries) {
    entry.regex.lastIndex = 0
    for (const m of scannable.matchAll(entry.regex)) {
      if (m.index === undefined) continue
      hits.push({ entry, start: m.index, end: m.index + m[0].length, matched: m[0] })
    }
  }
  // 位置更早优先；同位置更长者优先（「综上所述」压过「总之」）
  hits.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start))
  return hits
}

function dedupe(hits: RawHit[]): RawHit[] {
  const kept: RawHit[] = []
  let lastStart = -1
  let lastEnd = -1
  for (const h of hits) {
    if (h.start < lastEnd && h.start >= lastStart) continue
    kept.push(h)
    lastStart = h.start
    lastEnd = h.end
  }
  return kept
}

/** cluster / density 模式升级：达标才报，未达标静默。阈值语义对齐 slop_check.py escalate()。 */
function escalate(entries: CompiledEntry[], hits: RawHit[], paraStarts: number[]): RawHit[] {
  const byEntry = new Map<CompiledEntry, RawHit[]>()
  for (const h of hits) {
    const list = byEntry.get(h.entry) ?? []
    list.push(h)
    byEntry.set(h.entry, list)
  }

  // cluster：每段每个类目出现的不同词条集合，孤立的单词不构成信号
  const catParaEntries = new Map<string, Map<number, Set<CompiledEntry>>>()
  for (const e of entries) {
    if (e.entry.mode !== 'cluster') continue
    for (const h of byEntry.get(e) ?? []) {
      const para = paragraphIndexOf(paraStarts, h.start)
      const byPara = catParaEntries.get(e.categoryId) ?? new Map<number, Set<CompiledEntry>>()
      const set = byPara.get(para) ?? new Set<CompiledEntry>()
      set.add(e)
      byPara.set(para, set)
      catParaEntries.set(e.categoryId, byPara)
    }
  }

  const out: RawHit[] = []
  for (const [e, group] of byEntry) {
    const mode = e.entry.mode ?? 'plain'
    if (mode === 'plain') {
      out.push(...group)
    } else if (mode === 'cluster') {
      const min = e.entry.cluster_min ?? 1
      const byPara = catParaEntries.get(e.categoryId)
      for (const h of group) {
        const para = paragraphIndexOf(paraStarts, h.start)
        if ((byPara?.get(para)?.size ?? 0) >= min) out.push(h)
      }
    } else {
      if (group.length >= (e.entry.density_min ?? 1)) out.push(...group)
    }
  }
  return out
}

/**
 * 扫描规范文本，产出 slop 命中。每个词库独立走「收集 → 去重 → 升级」（与 slop_check.py
 * 逐 pack 处理一致），跨词库合并后按位置排序。
 */
export function scanSlop(text: string, lexicons: SlopLexicon[]): SlopHit[] {
  const scannable = maskProtected(text)
  const paraStarts = splitParagraphStarts(scannable)
  const out: SlopHit[] = []
  for (const lex of lexicons) {
    const entries: CompiledEntry[] = []
    for (const cat of lex.categories) {
      for (const entry of cat.entries) {
        entries.push({ regex: compile(entry.p, entry.flags), categoryId: cat.id, label: cat.label, entry })
      }
    }
    // 去重先于阈值升级：被更长匹配吞掉的命中不参与 cluster/density 计数
    const deduped = dedupe(collectMatches(entries, scannable))
    for (const h of escalate(entries, deduped, paraStarts)) {
      out.push({
        start: h.start,
        end: h.end,
        matched: h.matched,
        categoryId: h.entry.categoryId,
        label: h.entry.label,
        fix: h.entry.entry.fix,
        note: h.entry.entry.note,
      })
    }
  }
  return out.sort((a, b) => a.start - b.start)
}

/** 命中 → slop 候选批注（comment 自动组合类别与建议）。 */
export function hitsToAnnotations(hits: SlopHit[], now = Date.now()): Annotation[] {
  return hits.map((h, i) => ({
    id: `slop-${now}-${i}`,
    start: h.start,
    end: h.end,
    kind: 'slop' as const,
    comment: h.fix ? `建议：${h.fix}` : h.note ?? '候选信号，请人工复核',
    status: 'open' as const,
    source: 'slop' as const,
    meta: {
      categoryId: h.categoryId,
      label: h.label,
      matched: h.matched,
      fix: h.fix,
      note: h.note,
    },
    createdAt: now,
    updatedAt: now,
  }))
}
