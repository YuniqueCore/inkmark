// @vitest-environment happy-dom
/** Header 分组菜单：悬停意图、点击钉住、选择派发、Esc/外点关闭。 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { wireHeaderMenu } from '../src/ui/header-menu'
import type { MenuItem } from '../src/ui/header-menu'

const items: MenuItem[] = [
  {id: 'a', label: '打开文件', icon: '<svg data-ico="a"></svg>', hint: '.md'},
  {id: 'b', label: '载入示例'},
  {id: 'c', label: '移除', danger: true, separatorBefore: true},
]

let trigger: HTMLButtonElement
let onSelect: ReturnType<typeof vi.fn>

beforeEach(() => {
  document.body.innerHTML = ''
  onSelect = vi.fn()
  trigger = document.createElement('button')
  document.body.append(trigger)
  wireHeaderMenu(trigger, items, onSelect)
})

const panel = (): HTMLElement => trigger.querySelector('.hdr-menu') as HTMLElement

describe('wireHeaderMenu', () => {
  it('初始收起；mouseenter 悬停展开，mouseleave 延迟收起，移入面板取消收起', () => {
    vi.useFakeTimers()
    trigger.dispatchEvent(new Event('mouseenter'))
    vi.advanceTimersByTime(150)
    expect(panel().hidden).toBe(false)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    trigger.dispatchEvent(new Event('mouseleave'))
    vi.advanceTimersByTime(200)
    expect(panel().hidden).toBe(false) // 260ms 未到

    panel().dispatchEvent(new Event('mouseenter'))
    vi.advanceTimersByTime(400)
    expect(panel().hidden).toBe(false) // 移入面板取消收起

    panel().dispatchEvent(new Event('mouseleave'))
    vi.advanceTimersByTime(300)
    expect(panel().hidden).toBe(true)
    vi.useRealTimers()
  })

  it('点击钉住：mouseleave 不收起；再点收起', () => {
    trigger.click()
    expect(panel().hidden).toBe(false)
    trigger.dispatchEvent(new Event('mouseleave'))
    expect(panel().hidden).toBe(false) // pinned 不自动收
    trigger.click()
    expect(panel().hidden).toBe(true)
  })

  it('项渲染 icon/标签/hint/分隔线，点击上抛 id 并收起', () => {
    trigger.click()
    expect(panel().querySelectorAll('[data-menu-id]')).toHaveLength(3)
    expect(panel().querySelector('[data-ico="a"]')).toBeTruthy()
    expect(panel().textContent).toContain('.md')
    expect(panel().querySelectorAll('.hdr-sep')).toHaveLength(1)
    expect(panel().querySelector('[data-menu-id="c"]')?.classList.contains('danger')).toBe(true)

    ;(panel().querySelector('[data-menu-id="b"]') as HTMLButtonElement).click()
    expect(onSelect).toHaveBeenCalledWith('b')
    expect(panel().hidden).toBe(true)
  })

  it('Esc 与外点关闭', () => {
    trigger.click()
    document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}))
    expect(panel().hidden).toBe(true)

    trigger.click()
    document.dispatchEvent(new PointerEvent('pointerdown'))
    expect(panel().hidden).toBe(true)
  })
})
