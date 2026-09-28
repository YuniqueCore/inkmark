/** 屏幕契约：工作台的语义定位器。只放定位器，不放工作流。 */

import type { Locator, Page } from '@playwright/test'

export const Workbench = {
  /** 正文首块（示例文档的第一段） */
  firstBlock: (page: Page): Locator => page.locator('#editor .editor-blk').first(),
  /** 划选后出现的小点（body 直挂的 fixed 圆钮） */
  pinDot: (page: Page): Locator => page.locator('body > button.fixed'),
  /** 划词撰写卡 */
  composerCard: (page: Page): Locator => page.locator('body > div.popover-panel.z-50'),
  composerInput: (page: Page): Locator => page.locator('#pin-composer-input'),
  phraseRow: (page: Page): Locator => page.locator('#pin-phrases'),
  phraseChips: (page: Page): Locator => page.locator('#pin-phrases .phrase-chip'),
  kindChip: (page: Page, kind: string): Locator =>
    page.locator(`body > div.popover-panel.z-50 [data-kind="${kind}"]`),
  submitButton: (page: Page): Locator =>
    page.locator('body > div.popover-panel.z-50').getByRole('button', { name: '添加批注' }),
  /** 批注高亮段 */
  highlights: (page: Page): Locator => page.locator('#editor .seg-hl'),
  /** 批注详情弹层（点击高亮出现） */
  popup: (page: Page): Locator => page.locator('body > div.popover-panel.z-60'),
  popupInput: (page: Page): Locator => page.locator('.popup-edit-input'),
  popupPhraseChips: (page: Page): Locator => page.locator('[data-role="phrases"] .phrase-chip'),
  /** 侧栏批注卡 */
  sidebarCards: (page: Page): Locator => page.locator('#sidebar .ann-card'),
  /** 文档树 */
  treeItems: (page: Page): Locator => page.locator('#filetree [data-doc-id]'),
  selectAllCheckbox: (page: Page): Locator => page.locator('#filetree [data-select-all]'),
  bulkBar: (page: Page): Locator => page.locator('#filetree [data-bulk-bar]'),
  bulkDelete: (page: Page): Locator => page.locator('#filetree [data-bulk="delete"]'),
  /** 导出弹层 */
  exportModal: (page: Page): Locator => page.locator('#export-modal'),
  /** 顶栏图标按钮（title 语义） */
  headerButton: (page: Page, title: RegExp): Locator => page.locator('header').getByTitle(title),
}
