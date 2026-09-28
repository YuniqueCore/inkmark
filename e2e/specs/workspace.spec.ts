/** 工作台集成：导出弹层、文件树批量操作、顶栏窄视口收敛。 */

import { expect, test } from '../screenplay/fixtures/screenplay'
import { BrowseTheWorkbench } from '../screenplay/abilities/BrowseTheWorkbench'
import {
  BulkDeleteDocs,
  CloseExportModal,
  ConfirmDialog,
  OpenExportModal,
  ResizeViewport,
} from '../screenplay/interactions/workspace'
import { HorizontalOverflow } from '../screenplay/questions/workbench'
import { AnnotateFirstBlock, OpenSampleDocument } from '../screenplay/tasks/workbench'

test.describe('导出弹层', () => {
  test.beforeEach(async ({ actor }) => {
    await actor.attemptsTo(OpenSampleDocument(), AnnotateFirstBlock({ comment: '有个问题' }))
  })

  test('打开 → 预览有内容 → 关闭', async ({ actor }) => {
    const page = BrowseTheWorkbench.as(actor).page
    await actor.attemptsTo(OpenExportModal())
    await expect(page.locator('#export-modal')).toBeVisible()
    await expect(page.locator('#export-preview')).not.toBeEmpty()
    await actor.attemptsTo(CloseExportModal())
    await expect(page.locator('#export-modal')).toBeHidden()
  })

  test('切换格式重渲染预览（W3C 页有导入按钮）', async ({ actor }) => {
    const page = BrowseTheWorkbench.as(actor).page
    await actor.attemptsTo(OpenExportModal())
    await page.locator('#export-modal [data-tab="w3c"]').click()
    await expect(page.locator('#export-modal')).toContainText('W3C')
    await expect(page.locator('#export-modal').getByRole('button', { name: /导入 W3C/ })).toBeVisible()
  })
})

test.describe('文件树批量操作', () => {
  test.beforeEach(async ({ actor }) => {
    await actor.attemptsTo(OpenSampleDocument())
  })

  test('全选 → 批量删除（二次确认）→ 树清空', async ({ actor }) => {
    const page = BrowseTheWorkbench.as(actor).page
    await actor.attemptsTo(BulkDeleteDocs())
    // 二次确认弹层（alertdialog；批量移除的确认文案是「移除」）
    await expect(page.getByRole('alertdialog').getByRole('button', { name: '移除', exact: true })).toBeVisible()
    await actor.attemptsTo(ConfirmDialog())
    await expect(page.locator('#filetree')).toContainText('还没有文档')
  })
})

test.describe('窄视口顶栏', () => {
  test('390px 下无横向溢出', async ({ actor }) => {
    await actor.attemptsTo(OpenSampleDocument(), ResizeViewport(390, 844))
    // resize 后有一帧过渡布局（旧列宽尚未退出流式布局），轮询到稳定态
    await expect.poll(() => actor.asks(HorizontalOverflow())).toBe(false)
  })
})
