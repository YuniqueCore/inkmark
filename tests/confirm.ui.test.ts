// @vitest-environment happy-dom
/** choiceDialog：三键（确认/第三选择/取消）与 confirmDialog 布尔映射。 */

import { beforeEach, describe, expect, it } from 'vitest'
import { choiceDialog, confirmDialog } from '../src/ui/confirm'

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('choiceDialog', () => {
  it('提供 altText 时出现三个动作，点击 alt 解析为 alt', async () => {
    const p = choiceDialog({ title: '删除？', altText: '标记为已解决', danger: true })
    const buttons = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[data-op]'))
    expect(buttons.map((b) => b.dataset.op)).toEqual(['cancel', 'alt', 'confirm'])
    ;(document.querySelector('[data-op="alt"]') as HTMLButtonElement).click()
    await expect(p).resolves.toBe('alt')
  })

  it('确认与取消分别解析', async () => {
    const p1 = choiceDialog({ title: '确认？' })
    expect(document.body.querySelectorAll('[data-op="alt"]')).toHaveLength(0)
    ;(document.querySelector('[data-op="confirm"]') as HTMLButtonElement).click()
    await expect(p1).resolves.toBe('confirm')

    const p2 = choiceDialog({ title: '确认？' })
    ;(document.querySelector('[data-op="cancel"]') as HTMLButtonElement).click()
    await expect(p2).resolves.toBe('cancel')
  })
})

describe('confirmDialog', () => {
  it('confirm → true，cancel → false（布尔映射不变）', async () => {
    const p1 = confirmDialog({ title: '删除？' })
    ;(document.querySelector('[data-op="confirm"]') as HTMLButtonElement).click()
    await expect(p1).resolves.toBe(true)

    const p2 = confirmDialog({ title: '删除？' })
    ;(document.querySelector('[data-op="cancel"]') as HTMLButtonElement).click()
    await expect(p2).resolves.toBe(false)
  })
})
