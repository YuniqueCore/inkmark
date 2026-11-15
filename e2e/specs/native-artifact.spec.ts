import {nativeCommand, nativeFiles, nativeView, openNativeCanvas, transfer} from '../screenplay/support/native'
import {test, expect} from '@playwright/test'
import {sealNativeDocument} from '../../scripts/native-document.ts'
import {clipboardBitmap} from '../../native/tests/fixtures'
import {selectText, workspace} from '../screenplay/support/markdown'

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

test('canvas-only native contract: CRLF, deep paths, retained drafts, grouped review, restore lock and clipboard recovery', async ({page}) => {
  test.setTimeout(60000)
  await openNativeCanvas(page)
  await expect(page.locator('button,input,textarea,select,[role="dialog"],header,aside')).toHaveCount(0)
  const source = '# Native review\r\n\r\nA **stable primitive** composes. A stable primitive lasts.\r\n'
  await test.step('A file imported through the host keeps exact line endings through an unchanged native edit', async () => {
    await nativeFiles(page, [transfer('review.md', source)])
    await expect(page.locator('#editor')).toContainText('Native review')
    await nativeCommand(page, {type: 'workspace', action: 'edit'})
    const edit = (await nativeView(page)).interactions.find(item => item.type === 'text')!
    expect(edit.type === 'text' && edit.value).toBe(source.replaceAll('\r\n', '\n'))
    await nativeCommand(page, {type: 'text', id: edit.id, action: 'submit', value: source})
    await expect.poll(async () => (await nativeView(page)).save.status).toBe('saved')
    expect((await workspace(page)).docs[0].text).toBe(source)
  })
  await test.step('Deep native folder keys remain usable after import and reload', async () => {
    const path = Array.from({length: 4}, (_, i) => `${i}${'文'.repeat(129)}`).join('/') + '/deep.md'
    await nativeFiles(page, [transfer('deep.md', 'Deep review', path)], 'folder')
    await expect.poll(async () => (await nativeView(page)).documents.total).toBe(2)
    expect((await nativeView(page)).documents.rows.some(row => row.key.length > 512)).toBe(true)
    await expect.poll(async () => (await nativeView(page)).save.status).toBe('saved')
    await page.reload()
    await expect.poll(async () => (await nativeView(page))?.documents.total).toBe(2)
    const review = (await nativeView(page)).documents.rows.find(row => row.doc?.name === 'review.md')!
    await nativeCommand(page, {type: 'document', action: 'open', id: review.doc!.id})
  })
  await test.step('Preview selection keeps a dismissed draft and shares one anchor with source; search groups use shared selection', async () => {
    await nativeCommand(page, {type: 'reading', mode: 'split'})
    await selectText(page.locator('#markdown-preview strong'), 0, 6)
    await expect.poll(async () => (await nativeView(page)).selection?.excerpt).toBe('stable')
    await nativeCommand(page, {type: 'selection', action: 'annotate'})
    const form = (await nativeView(page)).interactions[0]!
    const value = {kind: 'suggestion' as const, comment: 'Native review draft', replacement: ''}
    await nativeCommand(page, {type: 'annotation', id: form.id, action: 'change', value})
    await nativeCommand(page, {type: 'annotation', id: form.id, action: 'dismiss'})
    await selectText(page.locator('#markdown-preview strong'), 0, 6)
    await nativeCommand(page, {type: 'selection', action: 'annotate'})
    const resumed = (await nativeView(page)).interactions[0]!
    expect(resumed.type === 'annotation' && resumed.value).toEqual(value)
    await nativeCommand(page, {type: 'annotation', id: resumed.id, action: 'submit', value})
    await expect(page.locator('#editor .seg-hl')).toHaveCount(1)
    await expect(page.locator('#markdown-preview .seg-hl')).toHaveCount(1)
    await nativeCommand(page, {type: 'workspace', action: 'search'})
    const search = (await nativeView(page)).interactions[0]!
    const batch = {type: 'search' as const, id: search.id, query: 'stable', caseSensitive: false, regex: false, crossDoc: false, value: {...value, comment: 'One grouped review'}}
    await nativeCommand(page, {...batch, action: 'change'})
    await nativeCommand(page, {...batch, action: 'submit'})
    const group = (await nativeView(page)).reviews.rows.find(row => row.rowType === 'group')!
    expect(group.count).toBe(2)
    await nativeCommand(page, {type: 'review-group', id: group.id, action: 'expand'})
    expect((await nativeView(page)).reviews.rows).toHaveLength(4)
    await nativeCommand(page, {type: 'review-group', id: group.id, action: 'select'})
    expect((await nativeView(page)).reviews.selected).toHaveLength(2)
    await nativeCommand(page, {type: 'review-group', id: group.id, action: 'resolve'})
    await nativeCommand(page, {type: 'filter', status: 'open', kinds: [], highlightFiltered: false})
    expect((await nativeView(page)).reviews.selected).toHaveLength(0)
    await nativeCommand(page, {type: 'review-quick', selection: 'open'})
    expect((await nativeView(page)).reviews.selected).toHaveLength(1)
  })
  await test.step('A rejected close cannot release the independent restore lock', async () => {
    await expect.poll(async () => (await nativeView(page)).save.status).toBe('saved')
    const backup = await workspace(page)
    backup.docs[0].text += '\nRestored review'
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put
      IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
        const result = put.apply(this, args)
        Object.assign(window, {holdWrite: true})
        const keepAlive = () => { if ((window as unknown as {holdWrite: boolean}).holdWrite) this.get('workspace').onsuccess = keepAlive }
        this.get('workspace').onsuccess = keepAlive
        return result
      }
    })
    await nativeFiles(page, [transfer('backup.json', JSON.stringify(backup))], 'restore')
    await expect.poll(async () => (await nativeView(page)).interactions.at(-1)?.type).toBe('choice')
    await nativeCommand(page, {type: 'choice', id: (await nativeView(page)).interactions.at(-1)!.id, choice: 'confirm'})
    await page.waitForFunction(() => document.body.inert && (window as unknown as {holdWrite: boolean}).holdWrite)
    await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', {data: 'inkmark:prepare-close:501'})))
    await expect.poll(() => page.evaluate(() => window.nativeHarness.messages)).toContain('inkmark:close-cancelled:501')
    expect(await page.evaluate(() => document.body.inert)).toBe(true)
    await page.evaluate(() => Object.assign(window, {holdWrite: false}))
    await expect(page.locator('#editor')).toContainText('Restored review')
    await expect.poll(() => page.evaluate(() => document.body.inert)).toBe(false)
    await page.reload()
    await expect.poll(async () => (await nativeView(page))?.chrome?.ready).toBe(true)
  })
  await test.step('Clipboard bitmap validation rejects damaged pixels then recovers with a valid paste', async () => {
    await page.evaluate(file => { window.nativeHarness.clipboard = [file] }, {...clipboardBitmap, base64: 'Qk0='})
    await nativeCommand(page, {type: 'workspace', action: 'paste-image'})
    await expect.poll(async () => (await nativeView(page)).notice).toContain('读取剪贴板位图')
    expect((await nativeView(page)).documents.total).toBe(2)
    await page.evaluate(file => { window.nativeHarness.clipboard = [file] }, clipboardBitmap)
    await nativeCommand(page, {type: 'workspace', action: 'paste-image'})
    await expect(page.locator('#image-view img')).toBeVisible()
    await expect.poll(async () => (await nativeView(page)).save.status).toBe('saved')
    const image = (await workspace(page)).docs.find((doc: {kind?: string}) => doc.kind === 'image').image
    expect(image).toMatchObject({width: 1, height: 1, dataUrl: expect.stringMatching(/^data:image\/png;/)})
    await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', {data: 'inkmark:prepare-close:502'})))
    await expect.poll(() => page.evaluate(() => window.nativeHarness.messages)).toContain('inkmark:close-ready:502')
    await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', {data: 'inkmark:resume:502'})))
    await page.reload()
    await expect(page.locator('#image-view img')).toBeVisible()
    expect((await workspace(page)).docs).toHaveLength(3)
  })
  await test.step('Valid large backup fields cannot poison native summaries or leave an invisible image draft', async () => {
    const backup = await workspace(page)
    const image = backup.docs.find((doc: {kind?: string}) => doc.kind === 'image')
    image.name = '图'.repeat(5000) + '.png'
    image.annotations = [{id: 'large-review', kind: 'suggestion', comment: 'x'.repeat(8 * 1024 * 1024 + 1), status: 'open', source: 'manual',
      selector: {type: 'rectangle', x: 0, y: 0, width: 1, height: 1}, createdAt: 1, updatedAt: 1}]
    await nativeFiles(page, [transfer('large-review.json', JSON.stringify(backup))], 'restore')
    await expect.poll(async () => (await nativeView(page)).interactions.some(item => item.type === 'choice')).toBe(true)
    const confirm = (await nativeView(page)).interactions.find(item => item.type === 'choice')!
    await nativeCommand(page, {type: 'choice', id: confirm.id, choice: 'confirm'})
    await expect.poll(async () => (await nativeView(page)).image?.name.length).toBe(4000)
    await expect.poll(async () => (await nativeView(page)).save.status).toBe('saved')
    await page.reload()
    await expect.poll(async () => (await nativeView(page))?.image?.name.length).toBe(4000)
    await nativeCommand(page, {type: 'review', id: 'large-review', action: 'edit'})
    await expect.poll(async () => (await nativeView(page)).notice).toContain('无法打开编辑窗口')
    expect((await nativeView(page)).interactions).toHaveLength(0)
    await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', {data: 'inkmark:prepare-close:503'})))
    await expect.poll(() => page.evaluate(() => window.nativeHarness.messages)).toContain('inkmark:close-ready:503')
    await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', {data: 'inkmark:resume:503'})))
    const text = (await nativeView(page)).documents.rows.find(row => row.doc?.kind === 'text')!
    await nativeCommand(page, {type: 'document', id: text.doc!.id, action: 'open'})
    await expect(page.locator('#editor')).toBeVisible()
  })
})
