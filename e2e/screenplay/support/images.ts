import {expect, type Page} from '@playwright/test'

export async function picture(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 900; canvas.height = 600
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#eff1f5'; ctx.fillRect(0, 0, 900, 600)
    ctx.fillStyle = '#15243e'; ctx.font = 'bold 36px sans-serif'; ctx.fillText('A place for your ideas', 48, 84)
    ctx.font = '20px sans-serif'; ctx.fillStyle = '#52617c'; ctx.fillText('Read. Reflect. Make it better.', 48, 128)
    ctx.fillStyle = '#3755c8'; ctx.fillRect(48, 200, 350, 180)
    ctx.fillStyle = '#fff'; ctx.font = 'bold 26px sans-serif'; ctx.fillText('Start a review', 80, 270)
    ctx.font = '18px sans-serif'; ctx.fillText('Bring the details into focus.', 80, 315)
    ctx.fillStyle = '#d7dfef'; ctx.fillRect(440, 200, 410, 180)
    ctx.fillStyle = '#15243e'; ctx.font = '24px sans-serif'; ctx.fillText('Your latest notes', 470, 265)
    return canvas.toDataURL('image/png').split(',')[1]!
  })
  return Buffer.from(base64, 'base64')
}

export async function pastePicture(page: Page, bytes: Buffer, name = 'design.png', selector = 'body', mime = 'image/png'): Promise<void> {
  await page.locator(selector).evaluate((target, data) => {
    const transfer = new DataTransfer()
    transfer.setData('text/plain', 'Clipboard alt text must not become a text document')
    transfer.items.add(new File([Uint8Array.from(atob(data.base64), c => c.charCodeAt(0))], data.name, {type: data.mime}))
    target.dispatchEvent(new ClipboardEvent('paste', {bubbles: true, cancelable: true, clipboardData: transfer}))
  }, {base64: bytes.toString('base64'), name, mime})
}

export async function drawRegion(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const box = (await page.locator('#image-view img').boundingBox())!
  const point = ([x, y]: [number, number]) => ({x: box.x + x * box.width / 900, y: box.y + y * box.height / 600})
  const start = point(from); const end = point(to)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, {steps: 12})
  await page.mouse.up()
  await expect(page.locator('.image-composer')).toBeVisible()
}

export async function saveRegion(page: Page, comment: string): Promise<void> {
  await page.locator('[data-image-form] textarea').fill(comment)
  await page.locator('[data-image-save]').click()
  await expect(page.locator('.image-composer')).toBeHidden()
  await expect(page.locator('#save-text')).toHaveText('已保存')
}
