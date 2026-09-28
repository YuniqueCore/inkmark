/** 搜索批量批注：侧栏搜索 → 命中统计 → 一键批量 → 分组卡（统计/展开/跳转/删除）。 */

import { expect, test } from '../screenplay/fixtures/screenplay'
import { BrowseTheWorkbench } from '../screenplay/abilities/BrowseTheWorkbench'
import { Interaction } from '../screenplay/support/kernel'
import { HighlightCount } from '../screenplay/questions/workbench'
import { OpenSampleDocument } from '../screenplay/tasks/workbench'

/** 在侧栏搜索框输入查询词 */
const SearchInSidebar = (query: string): Interaction =>
  Interaction.where(`侧栏搜索「${query}」`, async (actor) => {
    const page = BrowseTheWorkbench.as(actor).page
    await page.locator('#batch-search').fill(query)
    // 输入触发重渲染，撰写块出现且提交按钮恢复可用
    await page.locator('#batch-submit').waitFor({ state: 'visible' })
  })

/** 点「批量批注 N 处」 */
const SubmitBatch = (): Interaction =>
  Interaction.where('点「批量批注」', async (actor) => {
    await BrowseTheWorkbench.as(actor).page.locator('#batch-submit').click()
  })

/** 输入批量批注语（认可类型之外必填） */
const TypeBatchComment = (text: string): Interaction =>
  Interaction.where('输入批量批注语', async (actor) => {
    await BrowseTheWorkbench.as(actor).page.locator('#batch-comment').fill(text)
  })

test.describe('搜索批量批注', () => {
  test.beforeEach(async ({ actor }) => {
    await actor.attemptsTo(OpenSampleDocument())
  })

  test('搜索命中 → 一键批量 → 分组卡统计 N 处', async ({ actor }) => {
    const page = BrowseTheWorkbench.as(actor).page
    await actor.attemptsTo(SearchInSidebar('方式'), TypeBatchComment('统一批注'), SubmitBatch())

    // N 条一阶批注高亮 + 一张分组卡（带 N 处统计与批注语）
    await expect.poll(() => actor.asks(HighlightCount())).toBe(2)
    const card = page.locator('.ann-card[data-group]')
    await expect(card).toHaveCount(1)
    await expect(card).toContainText('2 处')
    await expect(card).toContainText('统一批注')
  })

  test('分组卡展开逐条跳转；全部解决与删除作用于整组', async ({ actor }) => {
    const page = BrowseTheWorkbench.as(actor).page
    await actor.attemptsTo(SearchInSidebar('方式'), TypeBatchComment('统一批注'), SubmitBatch())

    // 展开：两条摘录行
    await page.locator('.ann-card[data-group] [data-group-op="expand"]').click()
    const rows = page.locator('.ann-card[data-group] [data-op="focus"]')
    await expect(rows).toHaveCount(2)

    // 全部解决 → 卡片进入已解决态
    await page.locator('.ann-card[data-group] [data-group-op="toggle"]').click()
    await expect(page.locator('.ann-card[data-group]')).toContainText('已解决')

    // 删除整组（二次确认）→ 卡与正文高亮都消失
    await page.locator('.ann-card[data-group] [data-group-op="delete"]').click()
    await expect(page.getByRole('alertdialog')).toContainText('删除这 2 条批注')
    await page.getByRole('alertdialog').getByRole('button', { name: '删除', exact: true }).click()
    await expect(page.locator('.ann-card[data-group]')).toHaveCount(0)
    await expect.poll(() => actor.asks(HighlightCount())).toBe(0)
  })

  test('认可类型允许空批注语批量提交', async ({ actor }) => {
    const page = BrowseTheWorkbench.as(actor).page
    await actor.attemptsTo(SearchInSidebar('写作'))
    await page.locator('[data-batch-kind="praise"]').click()
    await expect(page.locator('#batch-submit')).toBeEnabled()
    await actor.attemptsTo(SubmitBatch())
    await expect(page.locator('.ann-card[data-group]')).toContainText('认可')
  })

  test('查询无命中或非认可空批注语时禁止提交', async ({ actor }) => {
    const page = BrowseTheWorkbench.as(actor).page
    await actor.attemptsTo(SearchInSidebar('不存在的词XYZ'))
    await expect(page.locator('#batch-submit')).toBeDisabled()
    await actor.attemptsTo(SearchInSidebar('写作'))
    await expect(page.locator('#batch-submit')).toBeDisabled() // 默认建议类 + 空批注语
  })
})
