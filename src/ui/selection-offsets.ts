/** 选区 ↔ 规范文本偏移的桥接：把 DOM 选区换算成 `[start, end)` 偏移，
 * 并提供批注高亮元素的矩形查询。纯查询、无状态——编辑区以 `.editor-blk`
 * 上的 `data-start` 为偏移基准（与 core/anchors 的渲染约定对应）。 */

import type { DocItem } from '../core/types'
import type { SelectionInfo } from './selection-pin'

/** 把当前 DOM 选区换算为选区信息。不在编辑区内、空选区或纯空白时返回 null。 */
export function resolveSelection(
  e: MouseEvent,
  editorEl: HTMLElement,
  doc: DocItem,
): SelectionInfo | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null
  const range = sel.getRangeAt(0)
  if (!editorEl.contains(range.commonAncestorContainer)) return null

  const start = domPointToOffset(range.startContainer, range.startOffset)
  const end = domPointToOffset(range.endContainer, range.endOffset)
  if (start === null || end === null || end <= start) return null
  const blk = (range.startContainer.nodeType === Node.TEXT_NODE
    ? range.startContainer.parentElement
    : (range.startContainer as HTMLElement))?.closest('.editor-blk') as HTMLElement | null
  const side = blk?.dataset.side === 'b' ? ('b' as const) : undefined
  const text = side === 'b' ? (doc.revised ?? '') : doc.text
  const quoted = text.slice(start, end)
  if (quoted.trim() === '') return null
  // 拖拽方向：anchor（按下点）在 range 起点即正向选
  const forward =
    sel.anchorNode === range.startContainer && sel.anchorOffset === range.startOffset
  return {
    start,
    end,
    rect: range.getBoundingClientRect(),
    quoted,
    mouse: { x: e.clientX, y: e.clientY },
    forward,
    docId: doc.id,
    ...(side ? { side } : {}),
  }
}

/** 批注高亮元素的视口矩形（侧栏定位 / 弹出锚点用）；找不到返回 null。 */
export function rectOfAnnotation(root: HTMLElement, id: string): DOMRect | null {
  const el = root.querySelector(`.seg-hl[data-ann-ids~="${id}"]`) as HTMLElement | null
  return el?.getBoundingClientRect() ?? null
}

/** 规范文本偏移区间 → 编辑区内的 DOM Range（搜索跳转用）；定位不到返回 null。 */
export function rangeOfOffsets(root: HTMLElement, start: number, end: number): Range | null {
  for (const blk of root.querySelectorAll<HTMLElement>('.editor-blk')) {
    const blockStart = Number(blk.dataset.start ?? 0)
    const blockEnd = blockStart + textLengthOf(blk)
    if (start < blockStart || start >= blockEnd) continue
    const s = offsetToPoint(blk, start - blockStart)
    const e = offsetToPoint(blk, Math.min(end, blockEnd) - blockStart)
    const range = document.createRange()
    range.setStart(s.node, s.offset)
    range.setEnd(e.node, e.offset)
    return range
  }
  return null
}

/** 块内规范偏移 → DOM 位置（textLengthOf 与 domPointToOffset 同一计数规则，<br> 记 1） */
function offsetToPoint(blk: HTMLElement, offset: number): { node: Node; offset: number } {
  let acc = 0
  const walk = (n: Node): { node: Node; offset: number } | null => {
    for (const child of Array.from(n.childNodes)) {
      const len = textLengthOf(child)
      if (offset < acc + len) {
        if (child.nodeType === Node.TEXT_NODE) return { node: child, offset: offset - acc }
        return walk(child) ?? { node: child, offset: 0 }
      }
      acc += len
    }
    return null
  }
  return walk(blk) ?? { node: blk, offset: blk.childNodes.length }
}

/** DOM 位置 → 规范文本偏移。位置不在任何编辑块内返回 null。 */
function domPointToOffset(node: Node, offset: number): number | null {
  const blk = (node.nodeType === Node.TEXT_NODE ? node.parentElement : node as HTMLElement)?.closest('.editor-blk') as HTMLElement | null
  if (!blk) return null
  const blockStart = Number(blk.dataset.start ?? 0)
  const innerPrefix = (): number => {
    if (node.nodeType === Node.TEXT_NODE) return offset
    return Array.from(node.childNodes)
      .slice(0, offset)
      .reduce((acc, child) => acc + textLengthOf(child), 0)
  }
  if (node === blk) {
    const acc = Array.from(blk.childNodes)
      .slice(0, offset)
      .reduce((a, c) => a + textLengthOf(c), 0)
    return blockStart + acc
  }
  let acc = 0
  let found = false
  const visit = (n: Node): void => {
    if (found) return
    for (const child of Array.from(n.childNodes)) {
      if (found) return
      if (child === node) {
        acc += innerPrefix()
        found = true
        return
      }
      if (child.contains(node)) {
        visit(child)
      } else {
        acc += textLengthOf(child)
      }
    }
  }
  visit(blk)
  return found ? blockStart + acc : null
}

function textLengthOf(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length ?? 0
  // <br> 计 1 个字符（与规范文本里的 \n 对应）
  if ((node as HTMLElement).tagName === 'BR') return 1
  return Array.from(node.childNodes).reduce((a, c) => a + textLengthOf(c), 0)
}
