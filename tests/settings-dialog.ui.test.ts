// @vitest-environment happy-dom
/** UI 层回归测试：设置弹层。
 * 断言锚点：四组控件按 META 渲染齐全；点选/拖动上抛完整偏好对象并跟进选中态；
 * 滑杆 input 不重渲染自身（拖动不中断）；完成/Esc 关闭并 resolve。
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { settingsDialog } from '../src/ui/settings-dialog'
import { FONT_META, FONT_SIZE, TEXTURE_META, THEME_META } from '../src/core/prefs'
import { DEFAULT_PREFS } from '../src/core/prefs'
import type { ReadingPrefs } from '../src/core/prefs'

let panel: HTMLElement
let changes: ReadingPrefs[]
let settled: Promise<void>

const open = (prefs: ReadingPrefs = DEFAULT_PREFS): void => {
  changes = []
  settled = settingsDialog(prefs, (p) => changes.push(p))
  panel = document.querySelector('[role="dialog"]')!
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('settingsDialog · 渲染', () => {
  it('主题/纹理/字体/字号按 META 渲染齐全，当前项 on', () => {
    open({...DEFAULT_PREFS, theme: 'panda', texture: 'grid', font: 'serif'})
    expect(panel.querySelectorAll('[data-set-theme]')).toHaveLength(Object.keys(THEME_META).length)
    expect(panel.querySelectorAll('[data-set-texture]')).toHaveLength(Object.keys(TEXTURE_META).length)
    expect(panel.querySelectorAll('[data-set-font]')).toHaveLength(Object.keys(FONT_META).length)
    expect(panel.querySelector('[data-set-theme="panda"]')?.classList.contains('on')).toBe(true)
    expect(panel.querySelector('[data-set-texture="grid"]')?.classList.contains('on')).toBe(true)
    expect(panel.querySelector('[data-set-font="serif"]')?.classList.contains('on')).toBe(true)
    const slider = panel.querySelector('[data-set-size]') as HTMLInputElement
    expect(Number(slider.value)).toBe(FONT_SIZE.default)
    expect(panel.querySelector('[data-size-label]')?.textContent).toContain('16.5')
    // 主题卡内嵌真实 token 的缩略示意
    expect(panel.querySelector('[data-set-theme="panda"] .theme-preview')).toBeTruthy()
  })
})

describe('settingsDialog · 交互', () => {
  it('点主题卡上抛完整偏好对象并同步选中态', async () => {
    open()
    ;(panel.querySelector('[data-set-theme="panda"]') as HTMLButtonElement).click()
    expect(changes).toEqual([{...DEFAULT_PREFS, theme: 'panda'}])
    expect(panel.querySelector('[data-set-theme="panda"]')?.classList.contains('on')).toBe(true)
    expect(panel.querySelector('[data-set-theme="light"]')?.classList.contains('on')).toBe(false)
    ;(panel.querySelector('[data-op="close"]') as HTMLButtonElement).click()
    await expect(settled).resolves.toBeUndefined()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('字号滑杆 input 上抛数值并更新标签，且不重渲染滑杆节点', () => {
    open()
    const slider = panel.querySelector('[data-set-size]') as HTMLInputElement
    slider.value = '19'
    slider.dispatchEvent(new Event('input', {bubbles: true}))
    expect(changes).toEqual([{...DEFAULT_PREFS, fontSize: 19}])
    expect(panel.querySelector('[data-size-label]')?.textContent).toBe('19px')
    expect(panel.querySelector('[data-set-size]')).toBe(slider) // 同一节点：拖动不被打断
  })

  it('Esc 关闭并 resolve；遮罩点击同样关闭', async () => {
    open()
    document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}))
    await expect(settled).resolves.toBeUndefined()
    expect(document.querySelector('[role="dialog"]')).toBeNull()

    settled = settingsDialog(DEFAULT_PREFS, () => {})
    document.querySelector('.fixed.inset-0')!.dispatchEvent(new MouseEvent('mousedown'))
    await expect(settled).resolves.toBeUndefined()
  })
})
