import type {Page} from '@playwright/test'

export async function workspaceAction(page: Page, action: string): Promise<void> {
  await page.locator('#btn-more').click()
  await page.locator(`#btn-more-menu [data-menu-id="${action}"]`).click()
}

export async function documentAction(page: Page, action: string): Promise<void> {
  if (!await page.locator('#btn-import').isVisible()) await page.locator('#btn-tree-drawer').click()
  await page.locator('#btn-import').click()
  await page.locator(`#btn-import-menu [data-menu-id="${action}"]`).click()
}
