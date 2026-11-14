import {test, expect} from '@playwright/test'
import {sealNativeDocument} from '../../scripts/native-document.ts'
import {readFile} from 'node:fs/promises'
import {clipboardBitmap} from '../../native/tests/fixtures'
import {createDoc, workspace} from '../screenplay/support/markdown'

test('native document: Windows newlines execute trusted scripts while injected scripts stay blocked', async ({page}) => {
  const source = '<!doctype html><html><head></head><body><script>\r\n' +
    'document.documentElement.dataset.ready = "审阅";\r\n</script></body></html>'
  const sealed = sealNativeDocument(source)
  // Test artifacts add their journey to a document already sealed for production.
  await page.setContent(sealNativeDocument(sealed))
  await expect(page.locator('html')).toHaveAttribute('data-ready', '审阅')
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1)
  await page.evaluate(() => {
    const script = document.createElement('script')
    script.textContent = 'document.documentElement.dataset.untrusted = "executed"'
    document.body.appendChild(script)
  })
  await expect(page.locator('html')).not.toHaveAttribute('data-untrusted')
  expect(() => sealNativeDocument('<script src="https://example.org/remote.js"></script>')).toThrow('inline')
})

test('offline native document keeps restoration locked through close refusal and normalizes clipboard bitmaps', async ({page}) => {
  const html = await readFile('.local-build/native-web/index.html', 'utf8')
  await page.route('https://inkmark.localhost/', route => route.fulfill({contentType: 'text/html', body: html}))
  await page.addInitScript(bitmap => {
    Object.assign(window, {hostMessages: [] as string[], clipboardFile: bitmap})
    window.inkmarkHost = {directories: true}
    window.nsh = {postMessage: message => {
      const state = window as unknown as {hostMessages: string[]; clipboardFile: typeof bitmap}
      state.hostMessages.push(message)
      if (!message.startsWith('{')) return
      const request = JSON.parse(message)
      if (request.operation === 'clipboard.image') queueMicrotask(() => window.dispatchEvent(new MessageEvent('message', {
        data: JSON.stringify({id: request.id, status: 'ok', value: [state.clipboardFile]}),
      })))
    }}
  }, clipboardBitmap)
  await page.goto('https://inkmark.localhost/')
  await createDoc(page, 'Original review', true)
  await expect(page.locator('#save-text')).toHaveText('已保存')
  const backup = await workspace(page)
  backup.docs[0].text = 'Restored review'
  let convertedPng: string
  await test.step('A rejected close releases only its own lock while the real restore transaction remains pending', async () => {
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put
      IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
        const result = put.apply(this, args)
        Object.assign(window, {holdWrite: true})
        const keepAlive = () => { if ((window as unknown as {holdWrite: boolean}).holdWrite) this.get('workspace').onsuccess = keepAlive }
        keepAlive()
        IDBObjectStore.prototype.put = put
        return result
      }
    })
    await page.locator('#workspace-input').setInputFiles({name: 'restore.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup))})
    await page.getByRole('alertdialog').getByRole('button', {name: '恢复工作区', exact: true}).click()
    await page.waitForFunction(() => document.body.inert && (window as unknown as {holdWrite: boolean}).holdWrite)
    await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', {data: 'inkmark:prepare-close:501'})))
    await expect.poll(() => page.evaluate(() => (window as unknown as {hostMessages: string[]}).hostMessages)).toContain('inkmark:close-cancelled:501')
    expect(await page.evaluate(() => document.body.inert)).toBe(true)
    await page.locator('#btn-diff').focus()
    await expect(page.locator('#btn-diff')).not.toBeFocused()
    await page.evaluate(() => Object.assign(window, {holdWrite: false}))
    await expect(page.locator('#editor')).toContainText('Restored review')
    await expect.poll(() => page.evaluate(() => document.body.inert)).toBe(false)
  })
  await test.step('BMP clipboard pixels become PNG; ordinary BMP files remain unsupported', async () => {
    await page.locator('#file-input').setInputFiles({name: clipboardBitmap.name, mimeType: clipboardBitmap.type, buffer: Buffer.from(clipboardBitmap.base64, 'base64')})
    await expect(page.locator('.toast')).toContainText('仅支持 PNG')
    await page.locator('#btn-import').click()
    await page.locator('[data-menu-id="image-paste"]').click()
    await expect(page.locator('#image-view img')).toBeVisible()
    await expect(page.locator('#save-text')).toHaveText('已保存')
    const image = (await workspace(page)).docs.find((doc: {kind?: string}) => doc.kind === 'image').image
    convertedPng = image.dataUrl
    expect(image).toMatchObject({width: 1, height: 1, dataUrl: expect.stringMatching(/^data:image\/png;/)})
    const pixel = await page.locator('#image-view img').evaluate((element: HTMLImageElement) => {
      const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1
      const context = canvas.getContext('2d')!; context.drawImage(element, 0, 0)
      return Array.from(context.getImageData(0, 0, 1, 1).data)
    })
    expect(pixel).toEqual([255, 0, 0, 255])
  })
  await test.step('Oversized and damaged bitmaps fail without importing; a subsequent valid paste recovers', async () => {
    const oversized = Buffer.from(clipboardBitmap.base64, 'base64'); oversized.writeInt32LE(16385, 18)
    for (const [base64, message] of [[oversized.toString('base64'), '尺寸超过限制'], ['Qk0=', '读取剪贴板位图']] as const) {
      await page.evaluate(file => Object.assign(window, {clipboardFile: file}), {...clipboardBitmap, base64})
      await page.locator('#btn-import').click(); await page.locator('[data-menu-id="image-paste"]').click()
      await expect(page.locator('.toast')).toContainText(message)
      await expect(page.locator('#filetree [data-doc]')).toHaveCount(2)
    }
    await page.evaluate(file => Object.assign(window, {clipboardFile: file}), {name: 'unchanged.png', type: 'image/png', base64: convertedPng.split(',')[1]!})
    await page.locator('#btn-import').click(); await page.locator('[data-menu-id="image-paste"]').click()
    await expect(page.locator('#filetree [data-doc]')).toHaveCount(3)
    await expect(page.locator('#save-text')).toHaveText('已保存')
    expect((await workspace(page)).docs[2].image.dataUrl).toBe(convertedPng)
    await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', {data: 'inkmark:prepare-close:502'})))
    await expect.poll(() => page.evaluate(() => (window as unknown as {hostMessages: string[]}).hostMessages)).toContain('inkmark:close-ready:502')
    await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', {data: 'inkmark:resume:502'})))
    expect(await page.evaluate(() => document.body.inert)).toBe(false)
    await page.reload()
    await expect(page.locator('#image-view img')).toBeVisible()
    expect((await workspace(page)).docs).toHaveLength(3)
  })
})
