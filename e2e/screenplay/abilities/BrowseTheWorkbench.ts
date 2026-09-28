/** 能力：驾驶被测工作台页面。只暴露技术句柄，不含断言与业务规则。 */

import type { Page } from '@playwright/test'
import { Ability, type Actor } from '../support/kernel'

export class BrowseTheWorkbench extends Ability {
  constructor(public readonly page: Page) {
    super()
  }

  static using(page: Page): BrowseTheWorkbench {
    return new BrowseTheWorkbench(page)
  }

  static as(actor: Actor): BrowseTheWorkbench {
    return actor.abilityTo(BrowseTheWorkbench)
  }
}
