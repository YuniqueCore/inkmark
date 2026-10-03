/** 阅读偏好：右下悬浮快捷设置（1/4 圆环）、完整设置弹层、主题/纹理/字体/字号
 * 即时生效与刷新持久化、文件树批量反选。 */

import { expect, test } from '../screenplay/fixtures/screenplay'
import { BrowseTheWorkbench } from '../screenplay/abilities/BrowseTheWorkbench'
import { ImportTextFile } from '../screenplay/interactions/workspace'
import { OpenSampleDocument } from '../screenplay/tasks/workbench'
import { Workbench } from '../screenplay/screens/Workbench'

test.describe('悬浮快捷设置', () => {
  test('hover 展开 → 二级面板切换熊猫主题 → 刷新后保持', async ({ actor }) => {
    const page = BrowseTheWorkbench.as(actor).page
    await actor.attemptsTo(OpenSampleDocument())
    await Workbench.fabToggle(page).hover()
    await expect(Workbench.fabItem(page, 'theme')).toBeVisible()
    await Workbench.fabItem(page, 'theme').hover()
    await expect(Workbench.fabFlyout(page)).toBeVisible()
    await Workbench.fabFlyout(page).locator('[data-set-theme="panda"]').click()
    // 熊猫：分面主题（html 记录 data-theme），中区保持浅色（.dark 不加）
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'panda')
    await expect(page.locator('html')).not.toHaveClass(/dark/)
    await expect(page.locator('#editor')).toHaveAttribute('data-texture', 'none')
    // 刷新后由防闪烁脚本恢复，无闪烁回退
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'panda')
  })

  test('全部设置：纹理 / 字体 / 字号即时生效，完成后关闭', async ({ actor }) => {
    const page = BrowseTheWorkbench.as(actor).page
    await actor.attemptsTo(OpenSampleDocument())
    await Workbench.fabToggle(page).hover()
    await Workbench.fabItem(page, 'settings').click()
    const dialog = Workbench.settingsDialog(page)
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('[data-set-theme]')).toHaveCount(12)
    await dialog.locator('[data-set-texture="grid"]').click()
    await expect(page.locator('#editor')).toHaveAttribute('data-texture', 'grid')
    await dialog.locator('[data-set-font="song"]').click()
    await expect(page.locator('#editor')).toHaveAttribute('data-font', 'song')
    await dialog.locator('[data-set-size]').fill('19')
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.style.getPropertyValue('--doc-font-size')),
      )
      .toBe('19px')
    await dialog.getByRole('button', {name: '完成'}).click()
    await expect(dialog).toBeHidden()
    // 关闭后设置仍在：字号变量、纹理、字体保持
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--doc-font-size'))).toBe('19px')
    await expect(page.locator('#editor')).toHaveAttribute('data-texture', 'grid')
  })
})

test.describe('文件树反选', () => {
  test('勾选一份 → 反选翻转其余 → 再反选还原', async ({ actor }) => {
    const page = BrowseTheWorkbench.as(actor).page
    await actor.attemptsTo(
      ImportTextFile('甲.txt', '甲的内容。'),
      ImportTextFile('乙.txt', '乙的内容。'),
      ImportTextFile('丙.txt', '丙的内容。'),
    )
    await page.locator('#filetree [data-select]').first().check()
    await expect(Workbench.bulkBar(page)).toContainText('已选 1')
    await Workbench.treeInvert(page).click()
    await expect(Workbench.bulkBar(page)).toContainText('已选 2')
    const boxes = page.locator('#filetree [data-select]')
    await expect(boxes.nth(0)).not.toBeChecked()
    await expect(boxes.nth(1)).toBeChecked()
    await expect(boxes.nth(2)).toBeChecked()
    await Workbench.treeInvert(page).click()
    await expect(Workbench.bulkBar(page)).toContainText('已选 1')
    await expect(boxes.nth(0)).toBeChecked()
  })
})
