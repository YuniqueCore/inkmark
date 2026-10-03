// @vitest-environment happy-dom
/** UI 层回归测试：右下悬浮阅读设置（1/4 圆环）。
 * 断言锚点：点按/hover 展开、子项沿弧定位、二级面板随子项渲染并上抛 patch、
 * 「全部设置」回调、Esc 与外部 pointerdown 收起。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReadingFab } from '../src/ui/reading-fab'
import { DEFAULT_PREFS, THEME_META } from '../src/core/prefs'
import type { ReadingPrefs } from '../src/core/prefs'

let root: HTMLElement
let prefs: ReadingPrefs
const patches: Partial<ReadingPrefs>[] = []
let settingsOpened = 0

beforeEach(() => {
  document.body.innerHTML = ''
  prefs = {...DEFAULT_PREFS}
  patches.length = 0
  settingsOpened = 0
  root = document.createElement('div')
  document.body.append(root)
  new ReadingFab(root, {
    getPrefs: () => prefs,
    onChange: (patch) => {
      patches.push(patch)
      prefs = {...prefs, ...patch}
    },
    onOpenSettings: () => {
      settingsOpened++
    },
  })
})

const expand = (): void => {
  ;(root.querySelector('.fab-btn') as HTMLButtonElement).click()
}

describe('ReadingFab · 展开与收起', () => {
  it('初始收起；点主钮展开六个子项并标记 aria-expanded，再点收起', () => {
    expect(root.classList.contains('open')).toBe(false)
    expand()
    expect(root.classList.contains('open')).toBe(true)
    expect(root.querySelectorAll('[data-fab-item]')).toHaveLength(6)
    expect(root.querySelector('.fab-btn')?.getAttribute('aria-expanded')).toBe('true')
    // 子项沿右上 1/4 圆弧（左/下偏移均为正的行内定位，锚定编辑区左下角）
    const first = root.querySelector('[data-fab-item="theme"]') as HTMLElement
    expect(first.style.left).toBeTruthy()
    expect(first.style.bottom).toBeTruthy()
    // 标签气泡数据就位（hover 时浮出）
    expect(first.dataset.label).toBe('主题')
    expand()
    expect(root.classList.contains('open')).toBe(false)
  })

  it('hover 主钮容器即展开，离开后宽限期收起', () => {
    vi.useFakeTimers()
    root.dispatchEvent(new MouseEvent('mouseenter'))
    expect(root.classList.contains('open')).toBe(true)
    root.dispatchEvent(new MouseEvent('mouseleave'))
    expect(root.classList.contains('open')).toBe(true) // 宽限期内保持
    vi.advanceTimersByTime(400)
    expect(root.classList.contains('open')).toBe(false)
    vi.useRealTimers()
  })

  it('Esc 与外部 pointerdown 收起', () => {
    expand()
    document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}))
    expect(root.classList.contains('open')).toBe(false)

    expand()
    document.dispatchEvent(new PointerEvent('pointerdown'))
    expect(root.classList.contains('open')).toBe(false)

    // 内部点击不收起
    expand()
    ;(root.querySelector('[data-fab-item="theme"]') as HTMLElement).dispatchEvent(
      new PointerEvent('pointerdown', {bubbles: true}),
    )
    expect(root.classList.contains('open')).toBe(true)
  })
})

describe('ReadingFab · 二级选项', () => {
  it('悬停主题子项弹出二级面板；点选主题上抛 patch 并跟进选中态', () => {
    expand()
    ;(root.querySelector('[data-fab-item="theme"]') as HTMLElement).dispatchEvent(
      new MouseEvent('mouseenter'),
    )
    const flyout = root.querySelector('[data-fab-flyout]') as HTMLElement
    expect(flyout.hidden).toBe(false)
    expect(flyout.querySelectorAll('[data-set-theme]')).toHaveLength(Object.keys(THEME_META).length)
    ;(flyout.querySelector('[data-set-theme="panda"]') as HTMLButtonElement).click()
    expect(patches).toEqual([{theme: 'panda'}])
    expect(flyout.querySelector('[data-set-theme="panda"]')?.classList.contains('on')).toBe(true)
  })

  it('字号二级面板：滑杆 input 上抛 fontSize 且不重渲染滑杆节点', () => {
    expand()
    ;(root.querySelector('[data-fab-item="size"]') as HTMLElement).dispatchEvent(
      new MouseEvent('mouseenter'),
    )
    const flyout = root.querySelector('[data-fab-flyout]') as HTMLElement
    const slider = flyout.querySelector('[data-set-size]') as HTMLInputElement
    slider.value = '20'
    slider.dispatchEvent(new Event('input', {bubbles: true}))
    expect(patches).toEqual([{fontSize: 20}])
    expect(flyout.querySelector('[data-set-size]')).toBe(slider)
    expect(flyout.querySelector('[data-size-label]')?.textContent).toBe('20px')
  })

  it('点「全部设置」触发 onOpenSettings 且收起悬浮球', () => {
    expand()
    ;(root.querySelector('[data-fab-item="settings"]') as HTMLElement).click()
    expect(settingsOpened).toBe(1)
    expect(root.classList.contains('open')).toBe(false)
  })
})

describe('ReadingFab · 字重面板', () => {
  it('悬停字重子项弹出四档面板；点选上抛 fontWeight patch', () => {
    expand()
    ;(root.querySelector('[data-fab-item="weight"]') as HTMLElement).dispatchEvent(new Event('mouseenter'))
    const panel = root.querySelector('[data-fab-flyout]') as HTMLElement
    expect(panel.hidden).toBe(false)
    expect(panel.querySelectorAll('[data-set-weight]')).toHaveLength(4)
    expect(panel.querySelector('.fab-flyout-head')?.textContent).toContain('字重')
    ;(panel.querySelector('[data-set-weight="bold"]') as HTMLButtonElement).click()
    expect(patches.at(-1)).toEqual({fontWeight: 'bold'})
    expect(panel.querySelector('[data-set-weight="bold"]')?.classList.contains('on')).toBe(true)
  })
})
