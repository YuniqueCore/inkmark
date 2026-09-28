/** 工作台集成：导出弹层、文件树批量操作、顶栏窄视口收敛、危险操作确认。 */

import { expect, test } from '../screenplay/fixtures/screenplay'
import { BrowseTheWorkbench } from '../screenplay/abilities/BrowseTheWorkbench'
import { Interaction } from '../screenplay/support/kernel'
import {
  BulkDeleteDocs,
  ClickSampleButton,
  CloseExportModal,
  ConfirmDialog,
  EnterSourceEditMode,
  ImportTextFile,
  OpenExportModal,
  ReplaceSourceText,
  ResizeViewport,
  SaveSourceEdit,
} from '../screenplay/interactions/workspace'
import { HorizontalOverflow, HighlightCount } from '../screenplay/questions/workbench'
import { AnnotateFirstBlock, OpenSampleDocument } from '../screenplay/tasks/workbench'

/** 点确认弹层的「取消」 */
const CancelDialog = (): Interaction =>
  Interaction.where('取消危险操作', async (actor) => {
    await BrowseTheWorkbench.as(actor).page.getByRole('alertdialog').getByRole('button', { name: '取消' }).click()
  })

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

test.describe('危险操作确认', () => {
  test('空工作台点示例：不弹窗直接载入', async ({ actor }) => {
    const page = BrowseTheWorkbench.as(actor).page
    await actor.attemptsTo(ClickSampleButton())
    await expect(page.locator('#editor')).toContainText('随着人工智能的飞速发展')
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
  })

  test('有内容时点示例：确认后新建示例并跳转；取消则原地不动', async ({ actor }) => {
    const page = BrowseTheWorkbench.as(actor).page
    await actor.attemptsTo(ImportTextFile('我的文档.txt', '我自己的第一个文档内容。\n第二行。'))
    await expect(page.locator('#editor')).toContainText('我自己的第一个文档内容')

    await actor.attemptsTo(ClickSampleButton())
    await expect(page.getByRole('alertdialog')).toBeVisible()
    await expect(page.getByRole('alertdialog')).toContainText('载入示例文档')
    await actor.attemptsTo(CancelDialog())
    await expect(page.locator('#editor')).toContainText('我自己的第一个文档内容')
    await expect(page.locator('#filetree')).not.toContainText('示例：AI 味产品文')

    await actor.attemptsTo(ClickSampleButton())
    await page.getByRole('alertdialog').getByRole('button', { name: '载入示例' }).click()
    await expect(page.locator('#editor')).toContainText('随着人工智能的飞速发展')
    await expect(page.locator('#filetree')).toContainText('我的文档.txt')
    await expect(page.locator('#filetree')).toContainText('示例：AI 味产品文')
  })

  test('已有示例时再点：确认后跳转已有文档，不堆副本', async ({ actor }) => {
    const page = BrowseTheWorkbench.as(actor).page
    await actor.attemptsTo(OpenSampleDocument())
    await actor.attemptsTo(ClickSampleButton())
    await expect(page.getByRole('alertdialog')).toContainText('跳转到示例文档')
    await page.getByRole('alertdialog').getByRole('button', { name: '跳转' }).click()
    // 树里仍然只有一份示例文档
    const sampleCount = await page.getByRole('button', { name: /示例：AI 味产品文/ }).count()
    expect(sampleCount).toBe(1)
  })

  test('编辑原文保存致批注失锚：先确认；取消留在编辑态，确认后落盘', async ({ actor }) => {
    const page = BrowseTheWorkbench.as(actor).page
    await actor.attemptsTo(OpenSampleDocument(), AnnotateFirstBlock({ kind: 'praise' }))
    await expect.poll(() => actor.asks(HighlightCount())).toBe(1)

    await actor.attemptsTo(EnterSourceEditMode(), ReplaceSourceText('随着人工智能的大发展，智能写作工具日新月异。'))
    await actor.attemptsTo(SaveSourceEdit())
    await expect(page.getByRole('alertdialog')).toBeVisible()
    await expect(page.getByRole('alertdialog')).toContainText('失锚')
    await actor.attemptsTo(CancelDialog())
    await expect(page.locator('#edit-source')).toBeVisible() // 取消：留在编辑态

    await actor.attemptsTo(SaveSourceEdit())
    await page.getByRole('alertdialog').getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.locator('#editor')).toContainText('随着人工智能的大发展')
    await expect(page.locator('#editor .seg-lost').first()).toBeVisible() // 失锚可见标记
  })
})
