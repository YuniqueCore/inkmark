/** 屏幕契约：工作台的语义定位器。只放定位器，不放工作流。 */

import type { Locator, Page } from '@playwright/test'

/** 划词撰写卡（body 直挂的浮层；对象字面量内部复用经此入口） */
const composerCardOf = (page: Page): Locator => page.locator('body > div.popover-panel.z-50')

export const Workbench = {
  /** 正文首块（示例文档的第一段） */
  firstBlock: (page: Page): Locator => page.locator('#editor .editor-blk').first(),
  /** 划选后出现的小点（body 直挂的 fixed 圆钮） */
  pinDot: (page: Page): Locator => page.locator('body > button.fixed'),
  /** 划词撰写卡 */
  composerCard: composerCardOf,
  composerInput: (page: Page): Locator =>
    composerCardOf(page).locator('[data-role="composer-comment"]'),
  composerReplacement: (page: Page): Locator =>
    composerCardOf(page).locator('[data-role="composer-replacement"]'),
  phraseRow: (page: Page): Locator => composerCardOf(page).locator('[data-role="phrases"]'),
  phraseChips: (page: Page): Locator =>
    composerCardOf(page).locator('[data-role="phrases"] .phrase-chip'),
  kindChip: (page: Page, kind: string): Locator =>
    composerCardOf(page).locator(`.kind-chip[data-kind="${kind}"]`),
  submitButton: (page: Page): Locator =>
    composerCardOf(page).getByRole('button', { name: '添加批注' }),
  /** 批注高亮段 */
  highlights: (page: Page): Locator => page.locator('#editor .seg-hl'),
  /** 批注详情弹层（点击高亮出现） */
  popup: (page: Page): Locator => page.locator('body > div.popover-panel.z-60'),
  popupInput: (page: Page): Locator => page.locator('.popup-edit-input'),
  popupPhraseChips: (page: Page): Locator =>
    page.locator('body > div.popover-panel.z-60 [data-role="phrases"] .phrase-chip'),
  /** ⌘F 搜索面板 */
  panel: (page: Page): Locator => page.locator('body > div.popover-panel.z-70'),  panelInput: (page: Page): Locator => page.locator('#sp-input'),
  panelCount: (page: Page): Locator => page.locator('#sp-count'),
  panelComment: (page: Page): Locator =>
    page.locator('[data-sp-composer] [data-role="composer-comment"]'),
  panelReplacement: (page: Page): Locator =>
    page.locator('[data-sp-composer] [data-role="composer-replacement"]'),
  panelCaseToggle: (page: Page): Locator => page.locator('#sp-case'),
  panelRegexToggle: (page: Page): Locator => page.locator('#sp-regex'),
  panelCrossDoc: (page: Page): Locator => page.locator('#sp-cross'),
  panelSubmit: (page: Page): Locator => page.locator('#sp-submit'),
  /** 导入冲突诊断树 */
  conflictDialog: (page: Page): Locator => page.locator('[role="dialog"][aria-label="导入冲突诊断"]'),
  /** 右下悬浮阅读设置（1/4 圆环）与设置弹层 */
  fab: (page: Page): Locator => page.locator('#reading-fab'),
  fabToggle: (page: Page): Locator => page.locator('#reading-fab .fab-btn'),
  fabItem: (page: Page, id: string): Locator => page.locator(`#reading-fab [data-fab-item="${id}"]`),
  fabFlyout: (page: Page): Locator => page.locator('#reading-fab .fab-flyout'),
  settingsDialog: (page: Page): Locator => page.locator('[role="dialog"][aria-label="设置"]'),
  treeInvert: (page: Page): Locator => page.locator('#filetree [data-select-invert]'),
  /** 侧栏批注卡 */
  sidebarCards: (page: Page): Locator => page.locator('#sidebar .ann-card'),
  /** 侧栏卡片多选与批量操作 */
  sidebarBulkStrip: (page: Page): Locator => page.locator('#sidebar [data-bulk-strip]'),
  sidebarBulkActions: (page: Page): Locator => page.locator('#sidebar [data-bulk-actions]'),
  sidebarCardChecks: (page: Page): Locator => page.locator('#sidebar .ann-card [data-select]'),
  sidebarSelectAll: (page: Page): Locator => page.locator('#sidebar [data-select-all]'),
  sidebarInvert: (page: Page): Locator => page.locator('#sidebar [data-select-invert]'),
  sidebarQuickSelect: (page: Page): Locator => page.locator('#sidebar [data-quick-select]'),
  highlightSwitch: (page: Page): Locator => page.locator('#sidebar #only-hl'),
  kindChips: (page: Page): Locator => page.locator('#sidebar .kind-chip'),
  /** 文档树 */
  treeItems: (page: Page): Locator => page.locator('#filetree [data-doc]'),
  selectAllCheckbox: (page: Page): Locator => page.locator('#filetree [data-select-all]'),
  bulkBar: (page: Page): Locator => page.locator('#filetree [data-bulk-bar]'),
  bulkDelete: (page: Page): Locator => page.locator('#filetree [data-bulk="delete"]'),
  /** 导出弹层 */
  exportModal: (page: Page): Locator => page.locator('#export-modal'),
  /** 顶栏图标按钮（title 语义） */
  headerButton: (page: Page, title: RegExp): Locator => page.locator('header').getByTitle(title),
}
