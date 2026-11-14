/** 规范文本与分块。规范文本（canonical text）是唯一事实源：批注偏移都对它计算。 */

export interface Block {
  /** 块在规范文本中的起始偏移 */
  start: number
  /** 块文本（不含分隔空行；内部单个换行保留，渲染为 <br>） */
  text: string
}

/** 应用内使用 UTF-16；W3C TextPositionSelector 以 Unicode code point 计数。 */
export function utf16ToCodePoints(text: string, offset: number): number {
  return Array.from(text.slice(0, offset)).length
}

export function codePointsToUtf16(text: string, offset: number): number {
  let units = 0
  let points = 0
  for (const character of text) {
    if (points >= offset) break
    units += character.length
    points++
  }
  return units
}

export function isSurrogateBoundary(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) return false
  const before = text.charCodeAt(offset - 1)
  const after = text.charCodeAt(offset)
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff
}

/** textarea 会把 CRLF 和 CR 规范化为 LF。 */
export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

/** 保存编辑时保留统一的换行类型；混合格式需要由调用方提示用户。 */
export function restoreLineEndings(value: string, original: string): {text: string; mixed: boolean} {
  const endings = new Set(original.match(/\r\n|\r|\n/g) ?? [])
  if (endings.size > 1) return {text: value, mixed: true}
  const ending = endings.values().next().value
  return {text: ending && ending !== '\n' ? value.replace(/\n/g, () => ending) : value, mixed: false}
}

export interface TextLine {
  start: number
  /** 不含行尾换行符 */
  end: number
  text: string
}

/** 按 LF、CRLF 或 CR 切行，起点始终指向未修改的原始文本。 */
export function scanLines(text: string): TextLine[] {
  const lines: TextLine[] = []
  const breaks = /\r\n|\r|\n/g
  let i = 0
  while (i < text.length) {
    breaks.lastIndex = i
    const br = breaks.exec(text)
    const end = br?.index ?? text.length
    lines.push({ start: i, end, text: text.slice(i, end) })
    i = br ? breaks.lastIndex : text.length
  }
  return lines
}

/**
 * 把规范文本切成连续块：按空行分组，连续非空行归为一个块。
 * 块是 [start, start + text.length) 的原文切片（可含内部单换行），偏移映射无损。
 */
export function splitBlocks(text: string): Block[] {
  const blocks: Block[] = []
  let group: TextLine[] = []
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

/** HTML 转义：渲染层把任意文本插入 innerHTML 模板的唯一出口（含属性值，
 * 引号转义防止属性逃逸）。此前 editor / confirm / filetree 各持一份且行为
 * 漂移（两份不转引号），已收敛为此处单源。 */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
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
