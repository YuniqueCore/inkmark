/** 手机视口的抽屉式文档树 / 批注栏：互斥、背板关闭、Esc 关闭。
 * 取代 tests/mobile.test.ts（它靠手搭骨架模拟 index.html，这里用真实布局）。 */

import { expect, test } from '../screenplay/fixtures/screenplay'
import { BrowseTheWorkbench } from '../screenplay/abilities/BrowseTheWorkbench'
import { ClickDrawerBackdrop, ToggleSidebarDrawer, ToggleTreeDrawer } from '../screenplay/interactions/workspace'
import { DrawerState } from '../screenplay/questions/workbench'

test.use({ viewport: { width: 390, height: 844 } })

test.describe('移动端抽屉', () => {
  // 空工作台即可：抽屉开合与文档无关；390px 下「示例」按钮本就隐藏（lg 才出现）

  test('文档树抽屉可开；开批注栏自动关文档树（互斥）', async ({ actor }) => {
    await actor.attemptsTo(ToggleTreeDrawer())
    await expect(await actor.asks(DrawerState())).toEqual({ tree: true, sidebar: false })
    await actor.attemptsTo(ToggleSidebarDrawer())
    await expect(await actor.asks(DrawerState())).toEqual({ tree: false, sidebar: true })
  })

  test('背板点击关闭抽屉', async ({ actor }) => {
    await actor.attemptsTo(ToggleSidebarDrawer(), ClickDrawerBackdrop())
    await expect(await actor.asks(DrawerState())).toEqual({ tree: false, sidebar: false })
  })

  test('Esc 关闭抽屉', async ({ actor }) => {
    await actor.attemptsTo(ToggleTreeDrawer())
    await BrowseTheWorkbench.as(actor).page.keyboard.press('Escape')
    await expect(await actor.asks(DrawerState())).toEqual({ tree: false, sidebar: false })
  })
})
