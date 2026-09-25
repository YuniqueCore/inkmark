/** 面板宽度拖拽：pointer capture + CSS 变量，拖拽期间只改一个变量，无组件重渲染。
 *
 * 布局网格模板由 main 根据可见性拼接（宽度位全部引用 --tree-w / --side-w），
 * 本模块只负责把指针位移换算成变量值；双击恢复默认宽度。
 */

import { icon } from './icons'

export interface ResizerOptions {
  layout: HTMLElement
  leftHandle: HTMLElement
  rightHandle: HTMLElement
  treeEl: HTMLElement
  sidebarEl: HTMLElement
}

const KEY = 'inkmark:panels'
const DEFAULTS = {treeW: 240, sideW: 380}
const CLAMP = {tree: [170, 440] as const, side: [300, 620] as const}

export function loadPanelWidths(): {treeW: number; sideW: number} {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {...DEFAULTS}
    const parsed = JSON.parse(raw) as Partial<{treeW: number; sideW: number}>
    return {
      treeW: clamp(parsed.treeW ?? DEFAULTS.treeW, CLAMP.tree),
      sideW: clamp(parsed.sideW ?? DEFAULTS.sideW, CLAMP.side),
    }
  } catch {
    return {...DEFAULTS}
  }
}

export function initResizers(opts: ResizerOptions): void {
  const widths = loadPanelWidths()
  applyWidths(opts.layout, widths)

  setupHandle(opts.layout, opts.leftHandle, 'tree', widths)
  setupHandle(opts.layout, opts.rightHandle, 'side', widths)
}

function setupHandle(
  layout: HTMLElement,
  handle: HTMLElement,
  which: 'tree' | 'side',
  widths: {treeW: number; sideW: number},
): void {
  handle.innerHTML = `<div class="resize-thumb">${icon('grip', 'size-3')}</div>`
  let active: {pointerId: number; startX: number; startW: number} | null = null

  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    active = {pointerId: e.pointerId, startX: e.clientX, startW: which === 'tree' ? widths.treeW : widths.sideW}
    try {
      handle.setPointerCapture(e.pointerId)
    } catch {
      // 合成指针（测试/无真实外设）没有可捕获的活跃指针，拖拽降级为元素内移动
    }
    handle.classList.add('dragging')
    document.body.classList.add('select-none')
  })
  handle.addEventListener('pointermove', (e) => {
    if (!active || e.pointerId !== active.pointerId) return
    // 左手柄向右拖增宽；右手柄向左拖增宽
    const delta = which === 'tree' ? e.clientX - active.startX : active.startX - e.clientX
    const range = CLAMP[which]
    const next = clamp(active.startW + delta, range)
    if (which === 'tree') widths.treeW = next
    else widths.sideW = next
    applyWidths(layout, widths)
  })
  const endDrag = (e: PointerEvent) => {
    if (!active || e.pointerId !== active.pointerId) return
    active = null
    handle.classList.remove('dragging')
    document.body.classList.remove('select-none')
    try {
      localStorage.setItem(KEY, JSON.stringify({treeW: widths.treeW, sideW: widths.sideW}))
    } catch {
      // 存储不可用时放弃持久化
    }
  }
  handle.addEventListener('pointerup', endDrag)
  handle.addEventListener('pointercancel', endDrag)
  handle.addEventListener('dblclick', () => {
    if (which === 'tree') widths.treeW = DEFAULTS.treeW
    else widths.sideW = DEFAULTS.sideW
    applyWidths(layout, widths)
    try {
      localStorage.setItem(KEY, JSON.stringify({treeW: widths.treeW, sideW: widths.sideW}))
    } catch {
      // 忽略
    }
  })
}

/** 把宽度写入 CSS 变量；网格模板里的宽度位全部引用这两个变量 */
function applyWidths(layout: HTMLElement, widths: {treeW: number; sideW: number}): void {
  layout.style.setProperty('--tree-w', `${widths.treeW}px`)
  layout.style.setProperty('--side-w', `${widths.sideW}px`)
}

function clamp(v: number, [lo, hi]: readonly [number, number]): number {
  return Math.max(lo, Math.min(hi, v))
}
