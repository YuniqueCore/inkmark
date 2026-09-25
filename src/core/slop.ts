/** slop 词库扫描：正则命中 → 去重叠 → cluster/density 阈值 → slop 候选批注。纯函数。 */

import { splitBlocks } from './text'
import type { Annotation, SlopEntry, SlopHit, SlopLexicon } from './types'

interface CompiledEntry {
  regex: RegExp
  categoryId: string
  label: string
  entry: SlopEntry
}

const compileCache = new Map<string, RegExp>()

function compile(source: string): RegExp {
  let re = compileCache.get(source)
  if (!re) {
    re = new RegExp(source, 'gu')
    compileCache.set(source, re)
  }
  return re
}

/**
 * 计算扫描保护区间：代码围栏、行内代码、URL。这些区域里的命中是引文/代码，不是 slop。
 */
export function protectedRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  const fence = /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g
  for (const m of text.matchAll(fence)) {
    ranges.push({ start: m.index, end: m.index + m[0].length })
  }
  const withoutFences = replaceRanges(text, ranges)
  for (const m of withoutFences.matchAll(/`[^`\n]+`/g)) {
    if (m.index !== undefined) ranges.push({ start: m.index, end: m.index + m[0].length })
  }
  for (const m of withoutFences.matchAll(/https?:\/\/\S+/g)) {
    if (m.index !== undefined) ranges.push({ start: m.index, end: m.index + m[0].length })
  }
  return ranges
}

function replaceRanges(text: string, ranges: Array<{ start: number; end: number }>): string {
  // 按 UTF-16 单元替换，保证与 regex 的 index 对齐（不能 Array.from，会按码点拆分错位）
  const chars = text.split('')
  for (const r of ranges) {
    for (let i = r.start; i < r.end && i < chars.length; i++) chars[i] = '·'
  }
  return chars.join('')
}

function inRanges(pos: number, ranges: Array<{ start: number; end: number }>): boolean {
  return ranges.some((r) => pos >= r.start && pos < r.end)
}

/**
 * 扫描规范文本，产出 slop 命中。
 * - 重叠命中保留更长者（与 anti-slop-kit 的 dedupe 一致）
 * - cluster 词条：同一段落内同类目 ≥2 个不同词条才生效
 * - density 词条：全文命中数 ≥ density_min 才生效
 * - 代码/URL 内的命中丢弃
 */
export function scanSlop(text: string, lexicons: SlopLexicon[]): SlopHit[] {
  const entries: CompiledEntry[] = []
  for (const lex of lexicons) {
    for (const cat of lex.categories) {
      for (const entry of cat.entries) {
        entries.push({ regex: compile(entry.p), categoryId: cat.id, label: cat.label, entry })
      }
    }
  }

  const protectedRangesList = protectedRanges(text)

  // 第一遍：全部原始命中（含权重信息用于后续阈值）
  const raw: Array<{ hit: SlopHit; entry: CompiledEntry; blockIndex: number }> = []
  const blocks = splitBlocks(text)
  for (const entry of entries) {
    entry.regex.lastIndex = 0
    for (const m of text.matchAll(entry.regex)) {
      if (m.index === undefined) continue
      if (inRanges(m.index, protectedRangesList)) continue
      const blockIndex = blocks.findIndex(
        (b) => m.index >= b.start && m.index < b.start + b.text.length,
      )
      raw.push({
        hit: {
          start: m.index,
          end: m.index + m[0].length,
          matched: m[0],
          categoryId: entry.categoryId,
          label: entry.label,
          fix: entry.entry.fix,
          note: entry.entry.note,
        },
        entry,
        blockIndex,
      })
    }
  }

  // cluster 阈值：同段同类目 ≥ cluster_min 个不同词条
  const clusterOk = new Set<string>()
  const byBlockCat = new Map<string, Set<string>>()
  for (const r of raw) {
    if (r.entry.entry.mode !== 'cluster') continue
    const key = `${r.blockIndex}:${r.entry.categoryId}`
    const set = byBlockCat.get(key) ?? new Set<string>()
    set.add(r.entry.entry.p)
    byBlockCat.set(key, set)
  }
  for (const [key, set] of byBlockCat) {
    const min = clusterMinFor(raw, key)
    if (set.size >= min) clusterOk.add(key)
  }
  function clusterMinFor(rows: typeof raw, key: string): number {
    const sample = rows.find((r) => `${r.blockIndex}:${r.entry.categoryId}` === key)
    return sample?.entry.entry.cluster_min ?? 2
  }

  // density 阈值：全文命中数 ≥ density_min
  const densityCount = new Map<string, number>()
  for (const r of raw) {
    if (r.entry.entry.mode !== 'density') continue
    densityCount.set(r.entry.entry.p, (densityCount.get(r.entry.entry.p) ?? 0) + 1)
  }

  // 过滤阈值未达标的词条
  const kept = raw.filter((r) => {
    const mode = r.entry.entry.mode ?? 'plain'
    if (mode === 'cluster') return clusterOk.has(`${r.blockIndex}:${r.entry.categoryId}`)
    if (mode === 'density') return (densityCount.get(r.entry.entry.p) ?? 0) >= (r.entry.entry.density_min ?? 3)
    return true
  })

  // 重叠去重：位置更早、更长的胜出（与 slop_check.py 的 dedupe 语义一致）
  kept.sort((a, b) => a.hit.start - b.hit.start || b.hit.end - a.hit.end)
  const out: SlopHit[] = []
  let lastStart = -1
  let lastEnd = -1
  for (const r of kept) {
    if (r.hit.start < lastEnd && r.hit.start >= lastStart) continue
    out.push(r.hit)
    lastStart = r.hit.start
    lastEnd = r.hit.end
  }
  return out
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
