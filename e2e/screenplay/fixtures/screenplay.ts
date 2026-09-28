/** fixture：每个测试一个独立 Actor（独立 page 上下文），不共享单例。 */

import { test as base, expect } from '@playwright/test'
import { BrowseTheWorkbench } from '../abilities/BrowseTheWorkbench'
import { Actor } from '../support/kernel'

export const test = base.extend<{ actor: Actor }>({
  actor: async ({ page }, use) => {
    await page.goto('/')
    await use(Actor.named('审稿人').whoCan(BrowseTheWorkbench.using(page)))
  },
})

export { expect }
