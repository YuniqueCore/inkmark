/** 左下角悬浮阅读设置：闲置 40% 透明、hover/展开不透明；展开后子项沿右上 1/4 圆弧
 * 铺开（三角函数定位 + 交错过渡），悬停子项浮出标签气泡并展开二级选项/滑杆
 * （面板挂子项右侧、向右展开）。触摸设备点按等效。
 * 选项控件复用 pref-controls 的渲染与事件委托；「全部设置」唤起完整设置弹层。
 */

import type { ReadingPrefs } from '../core/prefs'
import {
  bindPrefControls,
  fontOptionsHtml,
  fontSizeControlHtml,
  fontWeightOptionsHtml,
  textureOptionsHtml,
  themeOptionsHtml,
} from './pref-controls'
import { icon } from './icons'

type FabId = 'theme' | 'texture' | 'size' | 'font' | 'weight' | 'settings'

export interface ReadingFabCallbacks {
  getPrefs: () => ReadingPrefs
  onChange: (patch: Partial<ReadingPrefs>) => void
  onOpenSettings: () => void
}

const ITEMS: {id: FabId; label: string; visual: string}[] = [
  {id: 'theme', label: '主题', visual: icon('palette', 'size-4')},
  {id: 'texture', label: '纹理', visual: icon('waves', 'size-4')},
  {id: 'size', label: '字号', visual: icon('type', 'size-4')},
  {id: 'font', label: '字体', visual: '<span class="text-[13px] font-semibold leading-none">字</span>'},
  {id: 'weight', label: '字重', visual: '<span class="text-[14px] font-bold leading-none">B</span>'},
  {id: 'settings', label: '全部设置', visual: '<span class="text-[11px] font-semibold leading-none">设置</span>'},
]

/** 几何常量：主钮 44（size-11）、子项 36（size-9）、弧半径与 1/4 圆弧均分角 */
const BTN = 44
const ITEM = 36
const RADIUS = 84
const ANGLE_STEP = Math.PI / 2 / (ITEMS.length - 1)
const FLYOUT_WIDTH: Record<Exclude<FabId, 'settings'>, string> = {
  theme: '252px',
  texture: '272px',
  size: '224px',
  font: '240px',
  weight: '236px',
}

const HEAD_LABEL: Record<Exclude<FabId, 'settings'>, string> = {
  theme: '主题',
  texture: '纹理',
  size: '字号',
  font: '字体',
  weight: '字重',
}

/** 第 i 项在右上 1/4 圆弧上的位置（0°→90°，自正右向正上）与对应弧角 */
function arcPos(i: number): {left: number; bottom: number; rad: number} {
  const rad = i * ANGLE_STEP
  return {
    left: BTN / 2 + RADIUS * Math.cos(rad) - ITEM / 2,
    bottom: BTN / 2 + RADIUS * Math.sin(rad) - ITEM / 2,
    rad,
  }
}

export class ReadingFab {
  private open = false
  private activeId: FabId | null = null
  private closeTimer: ReturnType<typeof setTimeout> | undefined
  private flyout: HTMLElement

  constructor(private root: HTMLElement, private callbacks: ReadingFabCallbacks) {
    root.innerHTML = `
      <div class="fab-bridge"></div>
      ${ITEMS.map(
        (item, i) => {
          const p = arcPos(i)
          return `<button type="button" class="fab-item" data-fab-item="${item.id}"
            data-label="${item.label}"
            aria-label="${item.label}" title="${item.label}"
            style="left:${p.left}px;bottom:${p.bottom}px">${item.visual}</button>`
        },
      ).join('')}
      <button type="button" class="fab-btn" aria-label="阅读设置" title="阅读设置"
        aria-expanded="false">${icon('settings', 'size-[18px]')}</button>
      <div class="fab-flyout" data-fab-flyout hidden></div>`
    this.flyout = root.querySelector('[data-fab-flyout]') as HTMLElement

    const btn = root.querySelector('.fab-btn') as HTMLButtonElement
    btn.addEventListener('click', () => this.setOpen(!this.open))
    // 悬停意图：进入容器即展开，离开后宽限期收起（悬停桥保证移向子项途中不脱离）
    root.addEventListener('mouseenter', () => {
      clearTimeout(this.closeTimer)
      this.setOpen(true)
    })
    root.addEventListener('mouseleave', () => {
      clearTimeout(this.closeTimer)
      this.closeTimer = setTimeout(() => this.setOpen(false), 350)
    })
    root.querySelectorAll<HTMLElement>('[data-fab-item]').forEach((el) => {
      const id = el.dataset.fabItem as FabId
      el.addEventListener('mouseenter', () => this.setActive(id))
      el.addEventListener('click', () => {
        if (id === 'settings') {
          this.setOpen(false)
          this.callbacks.onOpenSettings()
          return
        }
        this.setOpen(true)
        this.setActive(id)
      })
    })
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.open && !e.isComposing) this.setOpen(false)
    })
    document.addEventListener('pointerdown', (e) => {
      if (this.open && !this.root.contains(e.target as Node)) this.setOpen(false)
    })
    bindPrefControls(this.flyout, (patch) => {
      this.callbacks.onChange(patch)
      // 滑杆拖动不重渲染（中断拖拽）；其余改动重渲染以跟进选中态
      if (this.activeId !== 'size') this.renderFlyout()
    })
  }

  private setOpen(open: boolean): void {
    if (this.open === open) return
    this.open = open
    this.root.classList.toggle('open', open)
    this.root.querySelector('.fab-btn')?.setAttribute('aria-expanded', String(open))
    // 交错展开：打开时逐项延迟，收起立即
    this.root.querySelectorAll<HTMLElement>('.fab-item').forEach((el, i) => {
      el.style.transitionDelay = open ? `${i * 24}ms` : '0ms'
    })
    if (!open) this.setActive(null)
  }

  private setActive(id: FabId | null): void {
    this.activeId = id
    this.root.querySelectorAll<HTMLElement>('[data-fab-item]').forEach((el) => {
      el.classList.toggle('on', el.dataset.fabItem === id)
    })
    if (!id || id === 'settings') {
      this.flyout.hidden = true
      return
    }
    this.renderFlyout()
  }

  /** 二级面板：标题行 + 选项/滑杆，挂在激活子项右侧、垂直居中于该项 */
  private renderFlyout(): void {
    const id = this.activeId
    if (!id || id === 'settings') return
    const prefs = this.callbacks.getPrefs()
    const content = {
      theme: `<div class="grid grid-cols-2 gap-1.5">${themeOptionsHtml(prefs.theme)}</div>`,
      texture: `<div class="grid grid-cols-5 gap-1.5">${textureOptionsHtml(prefs.texture)}</div>`,
      size: `<div class="px-1 py-0.5">${fontSizeControlHtml(prefs.fontSize)}</div>`,
      font: `<div class="grid grid-cols-2 gap-1.5">${fontOptionsHtml(prefs.font)}</div>`,
      weight: `<div class="grid grid-cols-4 gap-1.5">${fontWeightOptionsHtml(prefs.fontWeight)}</div>`,
    }[id]
    const item = ITEMS.find((it) => it.id === id)
    if (!item) return
    const p = arcPos(ITEMS.indexOf(item))
    this.flyout.style.width = FLYOUT_WIDTH[id]
    this.flyout.style.transform = 'translateY(50%)'
    this.flyout.setAttribute('aria-label', `${item.label}选项`)
    this.flyout.hidden = false
    this.flyout.innerHTML = `<div class="fab-flyout-head"><span>${HEAD_LABEL[id]}</span></div>${content}`
    // 视口钳制：面板以激活子项为中心，但上下不得溢出视口（主题面板高、
    // 锚点又低，不钳会裁切）；面板挂子项右侧，右缘贴视口时收拢
    const ideal = BTN / 2 + RADIUS * Math.sin(p.rad)
    const h = this.flyout.offsetHeight
    const lo = h / 2 - 12
    const hi = window.innerHeight - 28 - h / 2
    this.flyout.style.bottom = `${Math.min(Math.max(ideal, lo), Math.max(lo, hi))}px`
    const left = BTN / 2 + RADIUS * Math.cos(p.rad) + ITEM / 2 + 8
    this.flyout.style.left = `${Math.max(8, Math.min(left, window.innerWidth - 28 - this.flyout.offsetWidth))}px`
  }
}
