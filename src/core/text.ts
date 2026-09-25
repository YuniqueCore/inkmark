/** 规范文本与分块。规范文本（canonical text）是唯一事实源：批注偏移都对它计算。 */

export interface Block {
  /** 块在规范文本中的起始偏移 */
  start: number
  /** 块文本（不含分隔空行；内部单个换行保留，渲染为 <br>） */
  text: string
}

interface Line {
  start: number
  /** 不含行尾换行符 */
  end: number
  text: string
}

function scanLines(text: string): Line[] {
  const lines: Line[] = []
  let i = 0
  while (i < text.length) {
    const br = text.indexOf('\n', i)
    const end = br === -1 ? text.length : br
    lines.push({ start: i, end, text: text.slice(i, end) })
    i = br === -1 ? text.length : br + 1
  }
  return lines
}

/**
 * 把规范文本切成连续块：按空行分组，连续非空行归为一个块。
 * 块是 [start, start + text.length) 的原文切片（可含内部单换行），偏移映射无损。
 */
export function splitBlocks(text: string): Block[] {
  const blocks: Block[] = []
  let group: Line[] = []
  const flush = () => {
    if (group.length === 0) return
    const first = group[0]!
    const last = group[group.length - 1]!
    blocks.push({ start: first.start, text: text.slice(first.start, last.end) })
    group = []
  }
  for (const line of scanLines(text)) {
    if (line.text.trim() === '') {
      flush()
    } else {
      group.push(line)
    }
  }
  flush()
  return blocks
}

/** 找偏移所在的块（二分）。偏移落在空行分隔区时归前一个块；越过全文末尾返回 undefined。 */
export function blockAt(blocks: Block[], offset: number): Block | undefined {
  const last = blocks[blocks.length - 1]
  if (!last || offset > last.start + last.text.length) return undefined
  let lo = 0
  let hi = blocks.length - 1
  let found: Block | undefined
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const b = blocks[mid]!
    if (offset < b.start) {
      hi = mid - 1
    } else if (offset >= b.start + b.text.length) {
      found = b
      lo = mid + 1
    } else {
      return b
    }
  }
  return found
}

/** 摘录：把 [start, end) 截到 maxLen，两端加省略号（只在截断时）。 */
export function snippet(text: string, start: number, end: number, maxLen = 120): string {
  const raw = text.slice(Math.max(0, start), Math.min(text.length, end)).trim()
  if (raw.length <= maxLen) return raw
  const half = Math.floor(maxLen / 2)
  return raw.slice(0, half) + '……' + raw.slice(-half)
}

/** W3C TextQuoteSelector 风格：精确原文 + 前后文，用于跨会话校验锚点。 */
export function textQuoteSelector(text: string, start: number, end: number, ctx = 32): {
  exact: string
  prefix: string
  suffix: string
} {
  return {
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - ctx), start),
    suffix: text.slice(end, Math.min(text.length, end + ctx)),
  }
}
