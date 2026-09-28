/** 工作台级原子交互：顶栏、抽屉、文件树、导出弹层。 */

import { BrowseTheWorkbench } from '../abilities/BrowseTheWorkbench'
import { Workbench } from '../screens/Workbench'
import { Interaction, Task } from '../support/kernel'

/** 调整视口（等价用户旋转/缩放窗口） */
export const ResizeViewport = (width: number, height: number): Interaction =>
  Interaction.where(`视口调整为 ${width}×${height}`, async (actor) => {
    await BrowseTheWorkbench.as(actor).page.setViewportSize({ width, height })
  })

/** 打开导出弹层 */
export const OpenExportModal = (): Interaction =>
  Interaction.where('点顶栏「导出」', async (actor) => {
    await Workbench.headerButton(BrowseTheWorkbench.as(actor).page, /^导出批注/).click()
  })

/** 关闭导出弹层 */
export const CloseExportModal = (): Interaction =>
  Interaction.where('关闭导出弹层', async (actor) => {
    await Workbench.exportModal(BrowseTheWorkbench.as(actor).page).getByRole('button', { name: '关闭' }).click()
  })

/** 运行 slop 预扫描（生成 AI 味候选批注） */
export const RunSlopScan = (): Interaction =>
  Interaction.where('点顶栏 slop 预扫描', async (actor) => {
    await Workbench.headerButton(BrowseTheWorkbench.as(actor).page, /词库预扫描/).click()
  })

/** 切换文档树抽屉 / 批注栏抽屉（移动端语义） */
export const ToggleTreeDrawer = (): Interaction =>
  Interaction.where('切换文档树抽屉', async (actor) => {
    await Workbench.headerButton(BrowseTheWorkbench.as(actor).page, /收起\/展开文档树/).click()
  })

export const ToggleSidebarDrawer = (): Interaction =>
  Interaction.where('切换批注栏抽屉', async (actor) => {
    await Workbench.headerButton(BrowseTheWorkbench.as(actor).page, /收起\/展开批注栏/).click()
  })

/** 点击抽屉背板 */
export const ClickDrawerBackdrop = (): Interaction =>
  Interaction.where('点击抽屉背板', async (actor) => {
    await BrowseTheWorkbench.as(actor).page.locator('#drawer-backdrop').click({ position: { x: 10, y: 10 } })
  })

/** 全选文档树条目并触发批量删除 */
export const BulkDeleteDocs = (): Task =>
  Task.where(
    '#actor 全选文档并批量删除',
    Interaction.where('勾选全选框', async (actor) => {
      await Workbench.selectAllCheckbox(BrowseTheWorkbench.as(actor).page).check()
    }),
    Interaction.where('点批量删除', async (actor) => {
      await Workbench.bulkDelete(BrowseTheWorkbench.as(actor).page).click()
    }),
  )

/** 在确认弹层里点确认按钮（批量移除的确认文案是「移除」；scope 到弹层避免撞顶栏同名按钮） */
export const ConfirmDialog = (): Interaction =>
  Interaction.where('确认危险操作', async (actor) => {
    await BrowseTheWorkbench.as(actor).page
      .getByRole('alertdialog')
      .getByRole('button', { name: '移除', exact: true })
      .click()
  })
