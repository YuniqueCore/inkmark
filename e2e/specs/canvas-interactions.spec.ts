import {test, expect, type Page} from '@playwright/test'
import {picture, pastePicture, drawRegion, saveRegion} from '../screenplay/support/images'
import {workspace} from '../screenplay/support/markdown'

test.describe.configure({timeout: 60_000})

const regions = async (page: Page) => (await workspace(page)).docs[0].annotations.map((a: {selector: unknown}) => a.selector)
async function point(page: Page, x: number, y: number) {
  const box = (await page.locator('#image-view img').boundingBox())!
  return {x: box.x + x * box.width / 900, y: box.y + y * box.height / 600}
}
async function drag(page: Page, from: {x: number; y: number}, to: {x: number; y: number}) {
  await page.mouse.move(from.x, from.y); await page.mouse.down()
  await page.mouse.move(to.x, to.y, {steps: 8}); await page.mouse.up()
}

test('direct canvas journey: draw repeatedly, move and resize objects, pan temporarily, cancel and persist', async ({page}) => {
  await page.setViewportSize({width: 1440, height: 1000})
  await page.goto('/')
  await pastePicture(page, await picture(page))
  await expect(page.locator('.image-canvas canvas')).toBeVisible()
  await expect(page.locator('[data-image-action="draw"],[data-image-action="select"],[data-image-action="pan"]')).toHaveCount(0)
  await test.step('A selected region does not prevent the next empty-space drag from creating a review', async () => {
    await drawRegion(page, [80, 80], [200, 180]); await saveRegion(page, 'First review')
    await drawRegion(page, [350, 260], [500, 400])
    await page.locator('[data-image-form] textarea').fill('Second')
    await page.keyboard.press('Space'); await page.keyboard.type('review')
    await expect(page.locator('[data-image-form] textarea')).toHaveValue('Second review')
    await page.locator('[data-image-save]').click()
    await expect.poll(async () => (await regions(page)).length).toBe(2)
  })
  await test.step('An unselected object moves immediately; its resize handle changes only that region', async () => {
    await page.locator('[data-image-action="original"]').click()
    const before = await regions(page)
    await drag(page, await point(page, 130, 130), await point(page, 160, 150))
    await expect.poll(async () => (await regions(page))[0].x).toBeCloseTo(before[0].x + 30, 0)
    const moved = (await regions(page))[0]
    expect(moved.width).toBe(before[0].width); expect(moved.height).toBe(before[0].height)
    await drag(page, await point(page, moved.x + moved.width, moved.y + moved.height), await point(page, moved.x + moved.width + 40, moved.y + moved.height + 25))
    await expect.poll(async () => (await regions(page))[0].width).toBeCloseTo(moved.width + 40, 0)
    expect((await regions(page))[0].height).toBeCloseTo(moved.height + 25, 0)
    expect((await regions(page))[1]).toEqual(before[1])
  })
  await page.locator('.image-viewport').focus()
  const keyboardBefore = (await regions(page))[0]
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowDown')
  await expect.poll(async () => (await regions(page))[0]).toEqual({...keyboardBefore, x: keyboardBefore.x + 1, y: keyboardBefore.y + 10})
  const committed = await regions(page)
  await test.step('Space and middle-button drags pan without moving the selected object; releasing Space mid-drag stays a pan', async () => {
    await page.locator('[data-image-action="original"]').click()
    for (let i = 0; i < 4; i++) await page.locator('[data-image-action="in"]').click()
    const viewport = page.locator('.image-viewport')
    const box = (await viewport.boundingBox())!
    const x = box.x + box.width * .6; const y = box.y + box.height * .6
    await page.mouse.move(x, y); await page.keyboard.down('Space')
    await page.mouse.down()
    await page.mouse.move(x - 80, y - 70, {steps: 4})
    await page.keyboard.up('Space')
    await page.mouse.move(x - 160, y - 140, {steps: 4}); await page.mouse.up()
    await expect.poll(() => page.locator('.image-scroll').evaluate(el => el.scrollTop)).toBeGreaterThan(100)
    const scrolled = await page.locator('.image-scroll').evaluate(el => el.scrollLeft)
    await page.mouse.move(x, y); await page.mouse.down({button: 'middle'})
    await page.mouse.move(x - 40, y, {steps: 4}); await page.mouse.up({button: 'middle'})
    await expect.poll(() => page.locator('.image-scroll').evaluate(el => el.scrollLeft)).toBeGreaterThan(scrolled)
    await expect(page.locator('[data-image-action="edit"]')).toBeEnabled()
    await page.keyboard.press('Home')
    await expect.poll(() => page.locator('.image-scroll').evaluate(el => el.scrollTop)).toBe(0)
    await page.keyboard.press('PageDown')
    await expect.poll(() => page.locator('.image-scroll').evaluate(el => el.scrollTop)).toBeGreaterThan(100)
    expect(await regions(page)).toEqual(committed)
    await expect(page.locator('.image-composer')).toBeHidden()
  })
  await test.step('Escape and lost focus roll back incomplete gestures; drawing works again and survives reload', async () => {
    await page.locator('[data-image-action="fit"]').click()
    const from = await point(page, 600, 430); const to = await point(page, 800, 540)
    await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y)
    await page.keyboard.press('Escape'); await page.mouse.up()
    await expect(page.locator('.image-composer')).toBeHidden()
    const object = await point(page, committed[0].x + 30, committed[0].y + 30)
    await page.mouse.move(object.x, object.y); await page.mouse.down(); await page.mouse.move(object.x + 20, object.y + 20)
    await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.mouse.up()
    expect(await regions(page)).toEqual(committed)
    await drawRegion(page, [50, 430], [220, 540])
    await page.locator('[data-image-form] textarea').fill('After interrupted gestures')
    const draftStart = await point(page, 100, 480)
    await page.mouse.move(draftStart.x, draftStart.y); await page.mouse.down()
    await page.mouse.move(draftStart.x + 20, draftStart.y + 20)
    await expect(page.locator('.image-viewport')).toBeFocused()
    await page.keyboard.press('Escape'); await page.mouse.up()
    await expect(page.locator('[data-image-form] textarea')).toHaveValue('After interrupted gestures')
    await saveRegion(page, 'After interrupted gestures')
    await page.reload()
    await expect(page.locator('.image-canvas canvas')).toBeVisible()
    expect((await regions(page)).slice(0, 2)).toEqual(committed)
    expect(await regions(page)).toHaveLength(3)
  })
  await test.step('Blank selection, filtering and deletion clear the canvas and sidebar selection together', async () => {
    await page.locator('#sidebar [data-op="focus"]').first().click()
    const blank = await point(page, 850, 80)
    await page.mouse.click(blank.x, blank.y)
    await expect(page.locator('[data-image-action="edit"]')).toBeDisabled()
    await expect(page.locator('#sidebar .ann-card.ring-2')).toHaveCount(0)
    await page.locator('#sidebar [data-op="focus"]').first().click()
    await page.locator('#sidebar [data-kind="question"]').click()
    await page.locator('#only-hl').click()
    await expect(page.locator('[data-image-action="edit"]')).toBeDisabled()
    await page.locator('#sidebar [data-kind="question"]').click()
    await page.locator('#sidebar [data-op="focus"]').first().click()
    await page.locator('#sidebar [data-op="delete"]').first().click()
    await page.getByRole('alertdialog').getByRole('button', {name: '删除', exact: true}).click()
    await expect(page.locator('[data-image-action="edit"]')).toBeDisabled()
    await expect.poll(async () => (await regions(page)).length).toBe(2)
  })
})

test.describe('touch canvas gestures', () => {
  test.use({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true})
  test('two fingers cancel provisional drawing, pan and pinch; lifting either finger never creates a phantom region', async ({page, context}) => {
    await page.goto('/')
    const bytes = await picture(page)
    await pastePicture(page, bytes)
    await expect(page.locator('[data-image-action="coordinates"]')).toBeEnabled()
    await expect(page.locator('#save-text')).toHaveText('已保存')
    await page.locator('[data-image-action="original"]').tap()
    const box = (await page.locator('.image-viewport').boundingBox())!
    const x = box.x + 100; const y = box.y + 180
    const cdp = await context.newCDPSession(page)
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', touchPoints: {id: number; x: number; y: number}[]) => cdp.send('Input.dispatchTouchEvent', {type, touchPoints})
    for (const liftFirst of [true, false]) {
      await touch('touchStart', [{id: 1, x, y}])
      await touch('touchMove', [{id: 1, x: x + 20, y: y + 20}])
      await touch('touchStart', [{id: 1, x: x + 20, y: y + 20}, {id: 2, x: x + 140, y: y + 20}])
      const before = await page.locator('.image-scroll').evaluate(el => el.scrollTop)
      await touch('touchMove', [{id: 1, x: x + 20, y: y - 50}, {id: 2, x: x + 140, y: y - 50}])
      await expect.poll(() => page.locator('.image-scroll').evaluate(el => el.scrollTop)).toBeGreaterThan(before + 30)
      const width = (await page.locator('#image-view img').boundingBox())!.width
      await touch('touchMove', [{id: 1, x: x - 10, y: y - 50}, {id: 2, x: x + 170, y: y - 50}])
      expect((await page.locator('#image-view img').boundingBox())!.width).toBeGreaterThan(width)
      const remaining = {id: liftFirst ? 2 : 1, x: x + 90, y: y - 60}
      await touch('touchEnd', [remaining])
      await touch('touchMove', [{...remaining, y: y - 100}])
      await touch('touchEnd', [])
      await expect(page.locator('.image-composer')).toBeHidden()
      expect(await regions(page)).toHaveLength(0)
    }
    await page.locator('[data-image-action="fit"]').tap()
    const from = await point(page, 150, 200); const to = await point(page, 600, 420)
    await touch('touchStart', [{id: 3, ...from}]); await touch('touchMove', [{id: 3, ...to}]); await touch('touchEnd', [])
    await expect(page.locator('.image-composer')).toBeVisible()
    await saveRegion(page, 'Single finger drawing after pinch')
    const original = (await regions(page))[0]
    const move = await point(page, 350, 300)
    await touch('touchStart', [{id: 6, ...move}])
    await touch('touchMove', [{id: 6, x: move.x + 12, y: move.y + 8}]); await touch('touchEnd', [])
    await expect.poll(async () => (await regions(page))[0].x).toBeGreaterThan(original.x)
    expect((await regions(page))[0].width).toBe(original.width)
    const committed = await regions(page)
    // The first finger initially belongs to Konva's object drag, then the second
    // finger takes over the viewport. The pending object edit must roll back.
    const center = await point(page, 350, 300)
    await touch('touchStart', [{id: 4, ...center}])
    await touch('touchMove', [{id: 4, x: center.x + 10, y: center.y + 10}])
    await touch('touchStart', [{id: 4, x: center.x + 10, y: center.y + 10}, {id: 5, x: center.x + 70, y: center.y + 10}])
    const width = (await page.locator('#image-view img').boundingBox())!.width
    await touch('touchMove', [{id: 4, x: center.x - 10, y: center.y}, {id: 5, x: center.x + 90, y: center.y}])
    expect((await page.locator('#image-view img').boundingBox())!.width).toBeGreaterThan(width)
    await touch('touchCancel', [])
    expect(await regions(page)).toEqual(committed)
    await pastePicture(page, bytes, 'second.png')
    await expect(page.locator('#image-view img')).toHaveAttribute('alt', 'second.png')
    await expect(page.locator('.image-composer')).toBeHidden()
    expect((await workspace(page)).docs[0].annotations).toHaveLength(1)
    await expect.poll(async () => (await workspace(page)).docs.length).toBe(2)
    expect((await workspace(page)).docs[1].annotations).toHaveLength(0)
    await cdp.detach()
  })
})
