import {workspaceAction} from '../screenplay/support/actions'
import {test, expect} from '@playwright/test'
import {createDoc, workspace} from '../screenplay/support/markdown'

test('touch review: selection notifications preserve the draft and keyboard-sized panels remain actionable', async ({browser}) => {
  const context = await browser.newContext({viewport: {width: 390, height: 844}, hasTouch: true})
  const page = await context.newPage()
  try {
    await page.goto('http://localhost:5188')
    await createDoc(page, '# Touch review\n\nA stable primitive composes.', true)
    await page.locator('#editor .editor-blk').last().evaluate(root => {
      const range = document.createRange(); range.selectNodeContents(root)
      getSelection()!.removeAllRanges(); getSelection()!.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    })
    const pin = page.locator('#selection-pin')
    await expect(pin).toBeVisible()
    const bounds = (await pin.boundingBox())!
    expect(bounds.width).toBeGreaterThanOrEqual(40)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(382)
    await pin.tap()
    const composer = page.locator('body > .popover-panel.z-50')
    const comment = composer.locator('[data-role="composer-comment"]')
    await comment.fill('Keep the draft while selection handles move')
    await comment.focus()
    const input = await comment.elementHandle()
    await page.evaluate(() => {
      document.dispatchEvent(new Event('selectionchange'))
      document.dispatchEvent(new Event('selectionchange'))
    })
    expect(await input!.evaluate(node => node === document.activeElement)).toBe(true)
    await expect(comment).toHaveValue('Keep the draft while selection handles move')
    await page.setViewportSize({width: 390, height: 360})
    const submit = composer.getByRole('button', {name: '添加批注'})
    await submit.scrollIntoViewIfNeeded()
    await expect(submit).toBeInViewport()
    await submit.tap()
    await expect.poll(async () => (await workspace(page))?.docs[0]?.annotations.length ?? 0).toBe(1)
    await workspaceAction(page, 'search')
    await page.locator('#sp-input').fill('primitive')
    await page.locator('[data-sp-composer] [data-role="composer-comment"]').fill('Reachable above the keyboard')
    const batch = page.locator('#sp-submit')
    await batch.scrollIntoViewIfNeeded()
    await expect(batch).toBeInViewport()
    expect(await page.locator('.search-panel').evaluate(node => node.getBoundingClientRect().bottom)).toBeLessThanOrEqual(360)
    await expect(page.locator('.toast')).not.toHaveClass(/opacity-95/)
    if (process.platform === 'darwin') await expect(page.locator('.search-panel')).toHaveScreenshot('touch-search-keyboard.png')
    await batch.tap()
    await expect.poll(async () => (await workspace(page))?.docs[0]?.annotations.length ?? 0).toBe(2)
  } finally { await context.close() }
})
