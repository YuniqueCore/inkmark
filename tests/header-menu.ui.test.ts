// @vitest-environment happy-dom
import {expect, it, vi} from 'vitest'
import {wireHeaderMenu} from '../src/ui/header-menu'

it('a keyboard menu opens explicitly, skips disabled items, preserves focus and closes after one dispatch', () => {
  document.body.innerHTML = '<button id="menu">操作</button><button id="outside">正文</button>'
  const trigger = document.querySelector<HTMLButtonElement>('#menu')!
  const selected = vi.fn()
  const menu = wireHeaderMenu(trigger, [{id: 'open', label: '打开'}, {id: 'blocked', label: '不可用', disabled: true}, {id: 'remove', label: '删除', danger: true}], selected)
  const panel = document.getElementById('menu-menu')!
  const key = (name: string) => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', {key: name, bubbles: true}))
  trigger.dispatchEvent(new Event('mouseenter'))
  expect(panel.hidden).toBe(true)
  trigger.focus(); key('ArrowDown')
  expect(trigger.contains(panel)).toBe(false)
  expect((document.activeElement as HTMLElement).dataset.menuId).toBe('open')
  key('ArrowDown')
  expect((document.activeElement as HTMLElement).dataset.menuId).toBe('remove')
  menu.update([{id: 'open', label: '打开'}, {id: 'remove', label: '移入回收站', danger: true}])
  expect(document.activeElement?.textContent).toContain('移入回收站')
  ;(document.activeElement as HTMLElement).click()
  expect(selected).toHaveBeenCalledExactlyOnceWith('remove')
  expect(panel.hidden).toBe(true)
  expect(document.activeElement).toBe(trigger)
  trigger.click(); key('Escape')
  expect(panel.hidden).toBe(true)
  trigger.click()
  document.getElementById('outside')!.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true}))
  expect(panel.hidden).toBe(true)
})
