/** 批注 → 渲染分段。把块文本按批注范围切成 plain / highlighted 交替段。
 * 搜索预览区间（临时描边、非批注）可并入同一条扫描线，与批注底色叠加。 */

import type { Annotation } from './types'
import type { MatchRange } from './batch'

export interface Segment {
  text: string
  /** 覆盖此段的批注 id（一个段可被多个批注覆盖） */
  annIds: string[]
  /** 命中搜索预览（仅搜索预览段为 true） */
  search?: boolean
}

interface Range {
  id: string
  start: number
  end: number
}

const SEARCH_ID = '__search__'

/**
 * 把块内文字按批注范围（可叠加搜索预览区间）切段。ranges 是规范文本坐标，
 * 内部换算为块相对坐标并裁剪。相邻同集合的段会合并；空段不产出。
 */
export function buildSegments(
  blockStart: number,
  blockText: string,
  anns: Annotation[],
  searchRanges: MatchRange[] = [],
): Segment[] {
  const ranges: Range[] = []
  for (const a of anns) {
    const start = Math.max(0, a.start - blockStart)
    const end = Math.min(blockText.length, a.end - blockStart)
    if (end > start) ranges.push({ id: a.id, start, end })
  }
  for (const r of searchRanges) {
    const start = Math.max(0, r.start - blockStart)
    const end = Math.min(blockText.length, r.end - blockStart)
    if (end > start) ranges.push({ id: SEARCH_ID, start, end })
  }
  ranges.sort((x, y) => x.start - y.start || x.end - y.end)

  const segments: Segment[] = []
  const push = (text: string, active: Set<string>) => {
    if (text.length === 0) return
    const search = active.has(SEARCH_ID)
    const annIds = [...active].filter((id) => id !== SEARCH_ID)
    const prev = segments[segments.length - 1]
    if (prev && prev.search === search && sameIds(prev.annIds, annIds)) {
      prev.text += text
    } else {
      segments.push({ text, annIds, ...(search ? { search: true } : {}) })
    }
  }

  let cursor = 0
  // 扫描线：在每个边界处切换覆盖集合
  const events: Array<{ pos: number; id: string; open: boolean }> = []
  for (const r of ranges) {
    events.push({ pos: r.start, id: r.id, open: true })
    events.push({ pos: r.end, id: r.id, open: false })
  }
  events.sort((x, y) => x.pos - y.pos || (x.open ? 0 : -1))

  const active = new Set<string>()
  for (const ev of events) {
    if (ev.pos > cursor) {
      push(blockText.slice(cursor, ev.pos), active)
      cursor = ev.pos
    }
    if (ev.open) active.add(ev.id)
    else active.delete(ev.id)
  }
  if (cursor < blockText.length) {
    push(blockText.slice(cursor), active)
  }
  return segments
}

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x))
}
