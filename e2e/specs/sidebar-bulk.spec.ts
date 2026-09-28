/** 侧栏卡片多选：批量解决 / 批量删除（二次确认）、反选、快速选中 selector、
 * 类型 chips 以卡片实际为准、正文只高亮开关。 */

import { expect, test } from '../screenplay/fixtures/screenplay'
import { BrowseTheWorkbench } from '../screenplay/abilities/BrowseTheWorkbench'
import { AnnotateFirstBlock, OpenSampleDocument } from '../screenplay/tasks/workbench'
import { Workbench } from '../screenplay/screens/Workbench'

test.describe('侧栏卡片多选', () => {
  test.beforeEach(async ({ actor }) => {
    await actor.attemptsTo(OpenSampleDocument())
  })

  test('勾选两卡 → 批量解决（toast 反馈）→ 批量删除（二次确认）', async ({ actor }) => {
    const page = BrowseTheWorkbench.as(actor).page
    await actor.attemptsTo(
      AnnotateFirstBlock({ comment: '第一条' }),
      AnnotateFirstBlock({ from: 10, to: 20, kind: 'praise', comment: '第二条' }),
    )
    await expect(Workbench.sidebarCards(page)).toHaveCount(2)
    await Workbench.sidebarCardChecks(page).first().check()
    await expect(Workbench.sidebarBulkActions(page)).toContainText('已选 1')
    await Workbench.sidebarCardChecks(page).nth(1).check()
    await expect(Workbench.sidebarBulkActions(page)).toContainText('已选 2')
    await Workbench.sidebarBulkActions(page).getByRole('button', {name: '解决'}).click()
    await expect(page.getByText('已解决 2 条批注')).toBeVisible()
    // 选择保留：按钮按内容切换为「重开」
    await expect(Workbench.sidebarBulkActions(page)).toContainText('重开')
    await Workbench.sidebarBulkActions(page).getByRole('button', {name: '删除'}).click()
    await page
      .getByRole('alertdialog')
      .getByRole('button', {name: '删除', exact: true})
      .click()
    await expect(Workbench.sidebarBulkActions(page)).toHaveCount(0)
    await expect(page.locator('#sidebar')).toContainText('划选正文写批注')
  })

  test('快速选中某类型 → 反选翻转其余', async ({ actor }) => {
    const page = BrowseTheWorkbench.as(actor).page
    await actor.attemptsTo(
      AnnotateFirstBlock({ kind: 'suggestion', comment: '建议类' }),
      AnnotateFirstBlock({ from: 10, to: 20, kind: 'question', comment: '疑问类' }),
      AnnotateFirstBlock({ from: 20, to: 30, kind: 'praise', comment: '认可类' }),
    )
    await Workbench.sidebarQuickSelect(page).selectOption('kind:question')
    await expect(Workbench.sidebarBulkActions(page)).toContainText('已选 1')
    await Workbench.sidebarInvert(page).click()
    await expect(Workbench.sidebarBulkActions(page)).toContainText('已选 2')
    // 列表按正文位置排序：反选后留下建议（第1）与认可（第3），被快速选中的疑问（第2）取消
    const boxes = Workbench.sidebarCardChecks(page)
    await expect(boxes.nth(0)).toBeChecked()
    await expect(boxes.nth(1)).not.toBeChecked()
    await expect(boxes.nth(2)).toBeChecked()
  })

  test('类型 chips 以卡片实际为准；开关控制正文只高亮筛选结果', async ({ actor }) => {
    const page = BrowseTheWorkbench.as(actor).page
    await actor.attemptsTo(
      AnnotateFirstBlock({ kind: 'suggestion', comment: '建议类' }),
      AnnotateFirstBlock({ from: 10, to: 20, kind: 'praise', comment: '认可类' }),
    )
    // 人工四类常驻（与撰写卡一致），未出现的机器类型不占位
    const kinds = Workbench.kindChips(page)
    await expect(kinds).toHaveCount(4)
    await expect(kinds.nth(0)).toContainText('建议')
    await expect(kinds.nth(3)).toContainText('认可')
    // 开关关闭：正文高亮不随筛选；筛建议后仍 2 处高亮
    await kinds.nth(0).click()
    await expect(Workbench.highlights(page)).toHaveCount(2)
    await Workbench.highlightSwitch(page).click()
    await expect(Workbench.highlightSwitch(page)).toHaveAttribute('aria-checked', 'true')
    await expect(Workbench.highlights(page)).toHaveCount(1)
  })
})
