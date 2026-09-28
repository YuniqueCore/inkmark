/** 导入冲突诊断树：同名导入弹诊断、覆盖重锚批注、重命名并存、取消整次作废。 */

import type { Page } from '@playwright/test'
import type { Actor } from '../screenplay/support/kernel'
import { expect, test } from '../screenplay/fixtures/screenplay'
import { BrowseTheWorkbench } from '../screenplay/abilities/BrowseTheWorkbench'
import { Workbench } from '../screenplay/screens/Workbench'
import { ImportTextFile } from '../screenplay/interactions/workspace'
import { HighlightCount } from '../screenplay/questions/workbench'
import { AnnotateFirstBlock } from '../screenplay/tasks/workbench'

const dialog = (page: Page) => Workbench.conflictDialog(page)
const pageOf = (actor: Actor): Page => BrowseTheWorkbench.as(actor).page

test.describe('导入冲突诊断', () => {
  test('同名异文导入弹诊断树；覆盖后正文更新、批注重锚不丢', async ({ actor }) => {
    const page = pageOf(actor)
    await actor.attemptsTo(ImportTextFile('a.txt', '这是旧版本的正文内容，包含一段引文。'))
    await actor.attemptsTo(AnnotateFirstBlock({ kind: 'suggestion', comment: '保留意见' }))
    await expect.poll(() => actor.asks(HighlightCount())).toBe(1)

    // 同名异文再导入：诊断树出现，默认重命名
    await actor.attemptsTo(ImportTextFile('a.txt', '全新版本正文，旧引文被删掉了。'))
    await expect(dialog(page)).toBeVisible()
    await expect(dialog(page)).toContainText('发现 1 个同名冲突')
    await expect(dialog(page)).toContainText('批注 1')

    // 选覆盖：预演重锚显示失锚预告（引文被删）
    await dialog(page).locator('[data-action="overwrite"]').click()
    await expect(dialog(page)).toContainText('失锚 1')

    await dialog(page).getByRole('button', { name: '确认导入' }).click()
    await expect(dialog(page)).toHaveCount(0)

    // 正文已替换，批注保留（失锚态，钉在改动处）
    await expect(page.locator('#editor .editor-blk').first()).toContainText('全新版本正文')
    await expect.poll(() => actor.asks(HighlightCount())).toBe(1)
    await expect(page.locator('#sidebar')).toContainText('失锚')
  })

  test('默认重命名：两版并存，树里出现 a-1.txt', async ({ actor }) => {
    const page = pageOf(actor)
    await actor.attemptsTo(ImportTextFile('a.txt', '第一版内容。'))
    await actor.attemptsTo(ImportTextFile('a.txt', '第二版内容。'))
    await expect(dialog(page)).toBeVisible()

    await expect(dialog(page)).toContainText('→ a-1.txt')
    await dialog(page).getByRole('button', { name: '确认导入' }).click()

    await expect(page.locator('#filetree')).toContainText('a-1.txt')
    await expect(Workbench.treeItems(page)).toHaveCount(2)
  })

  test('取消 = 整次作废：不产生新文档，正文与批注原样保留', async ({ actor }) => {
    const page = pageOf(actor)
    await actor.attemptsTo(ImportTextFile('a.txt', '保持不变的内容。'))
    await actor.attemptsTo(AnnotateFirstBlock({ kind: 'praise' }))
    await expect.poll(() => actor.asks(HighlightCount())).toBe(1)

    await actor.attemptsTo(ImportTextFile('a.txt', '另一个版本的内容。'))
    await dialog(page).getByRole('button', { name: '取消' }).click()

    await expect(dialog(page)).toHaveCount(0)
    await expect(Workbench.treeItems(page)).toHaveCount(1)
    await expect(page.locator('#editor .editor-blk').first()).toContainText('保持不变的内容。')
    await expect.poll(() => actor.asks(HighlightCount())).toBe(1)
  })
})
