/** ⌘F 搜索面板：预览描边 / 批量批注 / 替换指令 / 跨文档 / 分组卡内单条编辑。 */

import type { Page } from '@playwright/test'
import { expect, test } from '../screenplay/fixtures/screenplay'
import { BrowseTheWorkbench } from '../screenplay/abilities/BrowseTheWorkbench'
import { Interaction } from '../screenplay/support/kernel'
import {
  ImportTextFile,
  OpenExportModal,
} from '../screenplay/interactions/workspace'
import { HighlightCount } from '../screenplay/questions/workbench'
import { OpenSampleDocument } from '../screenplay/tasks/workbench'

const panelInput = (page: Page) => page.locator('#sp-input')
const panelSubmit = (page: Page) => page.locator('#sp-submit')

/** ⌘F 打开面板并输入查询词 */
const SearchViaHotkey = (query: string): Interaction =>
  Interaction.where(`⌘F 打开面板搜索「${query}」`, async (actor) => {
    const page = BrowseTheWorkbench.as(actor).page
    await page.keyboard.press('ControlOrMeta+f')
    await panelInput(page).waitFor({ state: 'visible' })
    await panelInput(page).fill(query)
    // 输入触发编辑器预览描边
    await page.locator('#editor .seg-search').first().waitFor({ state: 'visible' })
  })

test.describe('搜索面板（⌘F）', () => {
  test.beforeEach(async ({ actor }) => {
    await actor.attemptsTo(OpenSampleDocument())
  })

  test('⌘F 唤起面板；输入实时预览描边；Esc 关闭并清除预览', async ({ actor }) => {
    const page = BrowseTheWorkbench.as(actor).page
    await actor.attemptsTo(SearchViaHotkey('方式'))
    await expect(page.locator('#sp-count')).toContainText('命中 2 处')
    await expect(page.locator('#editor .seg-search')).toHaveCount(2)

    await page.keyboard.press('Escape')
    await expect(page.locator('#sp-input')).toHaveCount(0)
    await expect(page.locator('#editor .seg-search')).toHaveCount(0)
  })

  test('批量批注 → 分组卡；组内单条「编辑」直开弹层', async ({ actor }) => {
    const page = BrowseTheWorkbench.as(actor).page
    await actor.attemptsTo(SearchViaHotkey('方式'))
    await page.locator('#sp-comment').fill('统一处理')
    await panelSubmit(page).click()

    await expect.poll(() => actor.asks(HighlightCount())).toBe(2)
    const card = page.locator('.ann-card[data-group]')
    await expect(card).toContainText('2 处')
    // 面板关闭后预览描边清除
    await expect(page.locator('#editor .seg-search')).toHaveCount(0)

    await card.locator('[data-group-op="expand"]').click()
    await card.locator('[data-op="edit"]').first().click()
    await expect(page.locator('.popup-edit-input')).toBeVisible()
  })

  test('替换词随批量批注写入，导出含机器可执行指令', async ({ actor }) => {
    const page = BrowseTheWorkbench.as(actor).page
    await actor.attemptsTo(SearchViaHotkey('方式'))
    await page.locator('#sp-comment').fill('统一替换')
    await page.locator('#sp-replacement').fill('路径')
    await panelSubmit(page).click()

    await actor.attemptsTo(OpenExportModal())
    await expect(page.locator('#export-preview')).toHaveValue(/替换为「路径」/)
  })

  test('跨文档批量：两份文档各得一张分组卡', async ({ actor }) => {
    const page = BrowseTheWorkbench.as(actor).page
    await actor.attemptsTo(
      ImportTextFile('另一份.txt', '这里也有方式二字。\n还有方式一次。'),
      SearchViaHotkey('方式'),
    )
    await page.locator('#sp-cross').check()
    await expect(page.locator('#sp-count')).toContainText('命中 4 处')
    await page.locator('#sp-comment').fill('统一处理')
    await panelSubmit(page).click()

    // 当前文档 2 处；切到另一份也有分组卡
    await expect.poll(() => actor.asks(HighlightCount())).toBe(2)
    await actor.attemptsTo(ImportTextFile('占位.txt', '占位内容。'))
    await page.locator('#filetree').getByText('另一份.txt').click()
    await expect.poll(() => actor.asks(HighlightCount())).toBe(2)
    await expect(page.locator('.ann-card[data-group]')).toContainText('2 处')
  })

  test('侧栏搜索按钮同样唤起面板；Enter 跳转到下一处命中', async ({ actor }) => {
    const page = BrowseTheWorkbench.as(actor).page
    await page.locator('[data-op="open-search"]').click()
    await panelInput(page).waitFor({ state: 'visible' })
    await panelInput(page).fill('方式')
    await page.locator('#editor .seg-search').first().waitFor({ state: 'visible' })
    await panelInput(page).press('Enter') // 导航不抛错、命中描边仍在
    await expect(page.locator('#editor .seg-search')).toHaveCount(2)
  })

  test('面板输入与组合事件不重绘面板（输入法组合安全）', async ({ actor }) => {
    const page = BrowseTheWorkbench.as(actor).page
    await actor.attemptsTo(SearchViaHotkey('方式'))
    const same = await page.evaluate(() => {
      const before = document.querySelector('#sp-input')!
      before.dispatchEvent(new Event('input', { bubbles: true }))
      before.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: '方' }))
      before.dispatchEvent(new Event('input', { bubbles: true }))
      const after = document.querySelector('#sp-input')
      return after !== null && after === before
    })
    expect(same).toBe(true)
  })
})
