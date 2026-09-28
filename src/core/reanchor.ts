/** 编辑原文后的批注重锚。纯函数。
 *
 * 策略（两级）：
 * 1. 引文锚定（core/quote-match.ts）：exact 精确搜索 + prefix/suffix 加权消歧
 *    + 位置提示评分，引文被小改时按编辑距离模糊回锚；全部候选过「按引文长度
 *    分级」的置信度门控——短引文且上下文已变会被否决（宁可失锚也不错锚）。
 * 2. diff 位移兜底：引文锚不上时，按字符级 diff（行级对单行文档粒度太粗）
 *    把偏移映射到新文本，落在被删除区域内的范围钳制到改动边界——
 *    批注不丢，钉在真实改动点并标失锚。
 *
 * 语义约定：本函数绝不丢弃批注（用户数据），只可能移动位置。
 */

import { diffChars, type DiffRow } from './diff'
import { anchorQuote } from './quote-match'
import { textQuoteSelector } from './text'
import type { Annotation } from './types'

export interface ReanchorResult {
  annotations: Annotation[]
  /** quote 在新文本中找到、且位置发生变化的批注数 */
  moved: number
  /** exact 已不在新文本、经 diff 位移钳制到改动边界的批注数 */
  clamped: number
}

export function reanchorAnnotations(
  oldText: string,
  newText: string,
  annotations: Annotation[],
): ReanchorResult {
  if (oldText === newText) return { annotations, moved: 0, clamped: 0 }

  const rows = diffChars(oldText, newText)
  let moved = 0
  let clamped = 0

  const next = annotations.map((a) => {
    const quote = textQuoteSelector(oldText, a.start, a.end)
    const found = anchorQuote(
      newText,
      {exact: quote.exact, prefix: quote.prefix, suffix: quote.suffix},
      {start: a.start, end: a.end},
    )
    if (found) {
      if (found.start !== a.start || found.end !== a.end) moved++
      // 引文重新找得回来 → 失锚标记清除（引文已被改掉又改回来的场景）
      const { anchorLost: _lost, ...rest } = a
      return { ...rest, start: found.start, end: found.end }
    }

    const start = mapOffset(rows, a.start)
    const end = mapOffset(rows, a.end)
    clamped++
    // 末行无换行符，diff 行进按 +1 统一计步，这里统一钳回新文本范围
    const s = Math.max(0, Math.min(start, newText.length))
    const e = Math.max(0, Math.min(end, newText.length))
    let lo = Math.min(s, e)
    let hi = Math.max(s, e)
    if (lo === hi) {
      // 整行被删等场景钳制点会重合：零宽区间渲染不出任何标记，
      // 扩成 1 字符让失锚标记可见、可点（批注本就是「钉在改动处」的近似）
      lo = Math.max(0, Math.min(lo, newText.length - 1))
      hi = Math.min(lo + 1, newText.length)
    }
    // 引文已被改掉：标记失锚（编辑器波浪线 + 侧栏徽标），批注仍不丢
    return { ...a, start: lo, end: hi, anchorLost: true as const }
  })

  return { annotations: next, moved, clamped }
}

/**
 * 旧文本偏移 → 新文本偏移（字符级 rows，无换行计步）。等值段内精确平移；
 * 落在删除段内的偏移钳制到该处改动的边界（前一等值段之后的插入位置）；
 * 越界钳到文末。
 */
function mapOffset(rows: DiffRow[], offset: number): number {
  let aStart = 0
  let bStart = 0
  let lastBoundary = 0
  for (const row of rows) {
    const len = row.text.length
    if (row.type === 'equal') {
      const aEnd = aStart + len
      if (offset < aEnd) return bStart + (offset - aStart)
      lastBoundary = bStart + len
      aStart = aEnd
      bStart += len
    } else if (row.type === 'del') {
      const aEnd = aStart + len
      if (offset < aEnd) return lastBoundary // 删除区：钳到改动起点
      aStart = aEnd
    } else {
      lastBoundary = bStart + len
      bStart += len
    }
  }
  return bStart
}
