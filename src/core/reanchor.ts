/** 编辑原文后的批注重锚。纯函数。
 *
 * 策略（两级）：
 * 1. quote 重锚：编辑前快照 exact/prefix/suffix，在新文本里精确搜索 + 消歧
 *    （复用 W3C 导入路径）——覆盖绝大多数编辑，包括文本被移动的情况；
 * 2. diff 位移兜底：exact 已被改掉时，按行级 diff 把偏移映射到新文本，
 *    落在被删除区域内的范围钳制到改动边界——批注不丢，钉在改动处。
 *
 * 语义约定：本函数绝不丢弃批注（用户数据），只可能移动位置。
 */

import { diffLines, type DiffRow } from './diff'
import { reanchor } from './w3c'
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

  const rows = diffLines(oldText, newText)
  let moved = 0
  let clamped = 0

  const next = annotations.map((a) => {
    const quote = textQuoteSelector(oldText, a.start, a.end)
    const found = reanchor(newText, quote.exact, quote.prefix, quote.suffix, {
      start: a.start,
      end: a.end,
    })
    if (found && (found.start !== a.start || found.end !== a.end)) moved++
    if (found) return { ...a, start: found.start, end: found.end }

    const start = mapOffset(rows, a.start)
    const end = mapOffset(rows, a.end)
    clamped++
    // 末行无换行符，diff 行进按 +1 统一计步，这里统一钳回新文本范围
    const s = Math.max(0, Math.min(start, newText.length))
    const e = Math.max(0, Math.min(end, newText.length))
    return { ...a, start: Math.min(s, e), end: Math.max(s, e) }
  })

  return { annotations: next, moved, clamped }
}

/**
 * 旧文本偏移 → 新文本偏移。等值行内精确平移；落在删除行内的偏移钳制到
 * 该处改动的边界（前一等值行之后的插入位置）；越界钳到文末。
 */
function mapOffset(rows: DiffRow[], offset: number): number {
  let aStart = 0
  let bStart = 0
  let lastBoundary = 0
  for (const row of rows) {
    const len = row.text.length + 1 // 行内容 + 换行
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
