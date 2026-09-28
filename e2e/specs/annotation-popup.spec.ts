/** 批注弹层：真实浏览器里的编辑态——类型 chips、快捷语切换、认可空描述。 */

import { expect, test } from '../screenplay/fixtures/screenplay'
import { BrowseTheWorkbench } from '../screenplay/abilities/BrowseTheWorkbench'
import { Interaction } from '../screenplay/support/kernel'
import { Workbench } from '../screenplay/screens/Workbench'
import { HighlightCount } from '../screenplay/questions/workbench'
import { RunSlopScan } from '../screenplay/interactions/workspace'
import { AnnotateFirstBlock, OpenSampleDocument } from '../screenplay/tasks/workbench'

/** 点击第一条批注高亮：应用入口直进编辑态（main.ts openFor(..., true)） */
const ClickFirstHighlight = (): Interaction =>
  Interaction.where('点击正文批注高亮', async (actor) => {
    await Workbench.highlights(BrowseTheWorkbench.as(actor).page).first().click()
  })

test.describe('批注弹层编辑态', () => {
  test.beforeEach(async ({ actor }) => {
    await actor.attemptsTo(OpenSampleDocument())
  })

  test('slop 批注显示静态类型徽标；切到建议后快捷语可用（死按钮回归）', async ({ actor }) => {
    const page = BrowseTheWorkbench.as(actor).page
    await actor.attemptsTo(RunSlopScan())
    await actor.attemptsTo(ClickFirstHighlight()) // 直进编辑态

    // 人工四类 chips；当前类型（AI 味）不在清单 → 前置静态徽标
    await expect(page.locator('[data-role="edit-kind"]')).toHaveCount(4)
    await expect(page.locator('.popup-item .chip-toggle.on').first()).toContainText('AI 味')
    await expect(Workbench.popupPhraseChips(page)).toHaveCount(0)

    // 切到建议：快捷语出现且可点（innerHTML 重绘后必须仍有事件）
    await page.locator('[data-role="edit-kind"][data-kind="suggestion"]').click()
    await expect(Workbench.popupPhraseChips(page).first()).toBeVisible()
    await Workbench.popupPhraseChips(page).first().click()
    await expect(Workbench.popupInput(page)).toHaveValue(/./)
  })

  test('认可类型空批注语可保存；建议类型空语被拦截', async ({ actor }) => {
    const page = BrowseTheWorkbench.as(actor).page
    await actor.attemptsTo(AnnotateFirstBlock({ kind: 'praise' }))
    await expect.poll(() => actor.asks(HighlightCount())).toBe(1)
    await actor.attemptsTo(ClickFirstHighlight()) // 直进编辑态
    await Workbench.popupInput(page).fill('')
    await Workbench.popup(page).getByRole('button', { name: '保存' }).click()
    // 认可空语：保存成功，退出编辑态
    await expect(Workbench.popup(page).getByRole('button', { name: '保存' })).toHaveCount(0)

    // 展示态点「编辑」再进编辑态：切到建议类，空语保存被拦截
    await Workbench.popup(page).getByRole('button', { name: '编辑' }).click()
    await Workbench.popupInput(page).fill('')
    await page.locator('[data-role="edit-kind"][data-kind="suggestion"]').click()
    await Workbench.popup(page).getByRole('button', { name: '保存' }).click()
    await expect(Workbench.popup(page).getByRole('button', { name: '保存' })).toBeVisible()
  })
})
