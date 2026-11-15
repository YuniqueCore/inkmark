import {workspaceAction} from '../screenplay/support/actions'
import {test, expect, type Page} from '@playwright/test'
import {readFile} from 'node:fs/promises'
import {unzipSync} from 'fflate'
import {toW3C} from '../../src/core/w3c'
import type {ImageDocument, DocItem, Workspace} from '../../src/core/types'
import {picture} from '../screenplay/support/images'
import {workspace} from '../screenplay/support/markdown'

test.describe.configure({timeout: 60_000})
const jsonFile = (name: string, value: unknown) => ({name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value))})
const saved = (page: Page) => expect(page.locator('#save-text')).toHaveText('已保存')
const closeExport = (page: Page) => page.locator('#export-modal [data-op="close"]').click()

function review(bytes: Buffer): Workspace {
  const body = {kind: 'suggestion' as const, status: 'open' as const, source: 'manual' as const, createdAt: 1, updatedAt: 1}
  const text: DocItem = {id: 'copy', name: 'Release.md', path: '', addedAt: 1, text: 'Alpha shared phrase.', annotations: [{...body, id: 'copy-note', start: 0, end: 5, comment: 'Explain the release'}]}
  const image: ImageDocument = {kind: 'image', id: 'screen', name: 'Design.png', path: '', addedAt: 1, image: {dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, width: 900, height: 600}, annotations: [
    {...body, id: 'public', comment: 'Increase button contrast', selector: {type: 'rectangle', x: 48, y: 200, width: 350, height: 180}},
    {...body, id: 'private', comment: 'Internal opinion', selector: {type: 'rectangle', x: 440, y: 200, width: 350, height: 180}},
    {...body, id: 'resolved', status: 'resolved', comment: 'Already addressed', selector: {type: 'rectangle', x: 40, y: 40, width: 400, height: 100}},
  ]}
  return {version: 3, docs: [text, image], activeDocId: image.id, trash: [], savedAt: 1}
}

test('mixed workspace: route a backup and W3C together, select reviews, export, delete and recover', async ({page, context}) => {
  await page.setViewportSize({width: 1440, height: 1000})
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {if (message.type() === 'warning') errors.push(message.text())})
  await page.goto('/')
  const bytes = await picture(page)
  const original = review(bytes)
  const w3c = original.docs.flatMap((doc) => toW3C(doc, {includeResolved: true}))
  await test.step('Given mixed documents and annotations in either file order, identities determine their destination', async () => {
    await page.locator('#file-input').setInputFiles([
      jsonFile('annotations.json', w3c),
      jsonFile('documents.json', {...original, docs: original.docs.map((doc) => ({...doc, annotations: []}))}),
    ])
    await saved(page)
    expect((await workspace(page)).docs.map((doc: {annotations: unknown[]}) => doc.annotations.length)).toEqual([1, 3])
    await page.locator('#filetree [data-doc="screen"]').click()
    await expect(page.locator('.a9s-annotationlayer')).toBeVisible()
  })
  await test.step('When filtering and selecting by keyboard, export only visible selected opinions', async () => {
    await page.locator('#sidebar [data-filter="open"]').click()
    await page.locator('#sidebar [data-select-all]').check()
    await expect(page.locator('#sidebar [data-bulk-actions]')).toContainText('已选 2')
    const privateCheck = page.locator('#sidebar [data-select="private"]')
    await privateCheck.focus(); await page.keyboard.press('Space')
    await expect(privateCheck).toBeFocused()
    await page.locator('#sidebar [data-bulk="export"]').click()
    await expect(page.locator('#export-preview')).toHaveValue(/Increase button contrast/)
    expect(await page.locator('#export-preview').inputValue()).not.toMatch(/Internal opinion|Already addressed/)
    const download = page.waitForEvent('download')
    await page.locator('#export-modal [data-op="download"]').click()
    const entries = unzipSync(await readFile((await (await download).path())!))
    expect(Buffer.from(entries['image-1.png']!)).toEqual(bytes)
    expect(JSON.parse(Buffer.from(entries['inkmark-documents.json']!).toString()).docs[0].annotations.map((a: {id: string}) => a.id)).toEqual(['public'])
    await closeExport(page)
    await page.locator('#sidebar [data-filter="resolved"]').click()
    await expect(page.locator('#sidebar [data-bulk-actions]')).toHaveCount(0)
    await page.locator('#sidebar [data-select-all]').check()
    await page.locator('#sidebar [data-bulk="export"]').click()
    await expect(page.locator('#export-preview')).toHaveValue(/Already addressed/)
    await closeExport(page)
    await page.locator('#btn-export').click()
    await expect(page.locator('#inc-resolved')).not.toBeChecked()
    expect(await page.locator('#export-preview').inputValue()).not.toContain('Already addressed')
    await closeExport(page)
  })
  await test.step('Then bulk deletion excludes hidden resolved opinions and trash restores both selected regions', async () => {
    await page.locator('#sidebar [data-filter="open"]').click()
    await page.locator('#sidebar [data-select-all]').check()
    await page.setViewportSize({width: 390, height: 844})
    await page.locator('#btn-sidebar-drawer').click()
    const actions = page.locator('#sidebar [data-bulk-actions]')
    await expect(actions.getByRole('button', {name: '导出', exact: true})).toBeInViewport()
    expect(await actions.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await expect(page.locator('.toast')).not.toHaveClass(/opacity-95/)
    if (process.platform === 'darwin') await expect(page.locator('#sidebar')).toHaveScreenshot('mixed-selection-sidebar.png', {animations: 'disabled'})
    await page.setViewportSize({width: 1440, height: 1000})
    await page.locator('#sidebar [data-bulk="delete"]').click()
    await page.getByRole('alertdialog').getByRole('button', {name: '删除', exact: true}).click()
    await saved(page)
    expect((await workspace(page)).docs[1].annotations.map((a: {id: string}) => a.id)).toEqual(['resolved'])
    await page.locator('#btn-trash').click()
    await page.locator('[data-entry] [data-op="restore"]').first().click()
    await page.locator('[data-entry] [data-op="restore"]').first().click()
    await page.getByRole('dialog', {name: '回收站'}).getByRole('button', {name: '关闭'}).click()
    await page.locator('#sidebar [data-filter="all"]').click()
  })
  await test.step('File-tree keyboard actions preserve focus and W3C downloads match their merged preview', async () => {
    for (const id of ['copy', 'screen']) {
      const check = page.locator(`#filetree [data-select="${id}"]`)
      await check.focus(); await page.keyboard.press('Space'); await expect(check).toBeFocused()
    }
    await page.locator('#filetree [data-bulk="export"]').click()
    await expect(page.locator('#export-preview')).toHaveValue(/Explain the release/)
    await page.locator('#export-modal [data-tab="w3c"]').click()
    const preview = JSON.parse(await page.locator('#export-preview').inputValue())
    const download = page.waitForEvent('download')
    await page.locator('#export-modal [data-op="download"]').click()
    const result = await download
    expect(result.suggestedFilename()).toMatch(/\.json$/)
    expect(JSON.parse((await readFile((await result.path())!)).toString())).toEqual(preview)
    await closeExport(page)
    const button = page.locator('#filetree [data-export="copy"]')
    await button.focus(); await page.keyboard.press('Enter')
    await expect(page.locator('#export-modal')).toBeVisible()
    expect((await workspace(page)).activeDocId).toBe('screen')
    const external = {...w3c[0], id: 'urn:external:review', body: [{type: 'TextualBody', value: 'External release feedback', purpose: 'commenting'}], target: {...w3c[0]!.target, source: 'https://example.invalid/release'}}
    const chooser = page.waitForEvent('filechooser')
    await page.locator('#export-modal [data-op="import"]').click()
    await (await chooser).setFiles(jsonFile('external.json', [external]))
    await expect(page.locator('#export-modal')).toBeHidden()
    await saved(page)
    expect((await workspace(page)).docs[0].annotations).toHaveLength(2)
    expect((await workspace(page)).docs[1].annotations).toHaveLength(3)
  })
  await test.step('Whole-document deletion survives reload and a complete backup retains recoverable originals', async () => {
    await page.locator('#filetree [data-bulk="delete"]').click()
    await page.getByRole('alertdialog').getByRole('button', {name: '移除', exact: true}).click()
    await saved(page); await page.reload()
    expect((await workspace(page)).docs).toHaveLength(0)
    expect((await workspace(page)).trash).toHaveLength(2)
    await page.locator('#btn-more').click()
    const downloading = page.waitForEvent('download')
    await page.getByRole('menuitem', {name: '下载完整工作区备份'}).click()
    const backup = await readFile((await (await downloading).path())!)
    const other = await context.newPage(); await other.goto('/')
    await other.locator('#file-input').setInputFiles({name: 'workspace.json', mimeType: 'application/json', buffer: backup})
    await expect(other.locator('.toast')).toContainText('2 项回收站记录未合并')
    await other.close()
    await page.locator('#btn-trash').click()
    for (let i = 0; i < 2; i++) await page.locator('[data-entry] [data-op="restore"]').first().click()
    await page.getByRole('dialog', {name: '回收站'}).getByRole('button', {name: '关闭'}).click()
    await saved(page); await page.reload()
    expect((await workspace(page)).docs.find((doc: {id: string}) => doc.id === 'screen').image).toEqual(original.docs[1]!.kind === 'image' ? original.docs[1]!.image : null)
    expect(errors).toEqual([])
  })
})

test('legacy recovery preserves both versions and remains readable when IndexedDB is unavailable', async ({page, context}) => {
  const initial = review(await picture(page))
  const legacy = {...initial, docs: initial.docs.slice(0, 1), activeDocId: 'copy'}
  await page.addInitScript(raw => {
    if (!localStorage.getItem('inkmark:session:v1')) localStorage.setItem('inkmark:session:v1', raw)
  }, JSON.stringify(legacy))
  await page.goto('/')
  await expect(page.locator('#editor')).toContainText('Alpha shared phrase.')
  const oldTab = await context.newPage(); await oldTab.goto('/')
  const updated = {...legacy, docs: [...legacy.docs, {...legacy.docs[0], id: 'later', name: 'Later.md', text: 'Written by the old tab', annotations: []}]}
  await oldTab.evaluate(raw => localStorage.setItem('inkmark:session:v1', raw), JSON.stringify(updated))
  await saved(page)
  await page.reload()
  await expect(page.locator('#legacy-recovery')).toBeVisible()
  const downloading = page.waitForEvent('download')
  await page.locator('#btn-legacy-backup').click()
  const raw = JSON.parse((await readFile((await (await downloading).path())!)).toString())
  expect(raw.docs).toHaveLength(2)
  expect((await workspace(page)).docs).toHaveLength(1)
  await oldTab.close()
  await page.addInitScript(() => {indexedDB.open = () => {throw new DOMException('Blocked database', 'SecurityError')}})
  await page.reload()
  await expect(page.locator('#editor')).toContainText('Alpha shared phrase.')
  await expect(page.locator('#save-error')).toBeVisible()
  await expect(page.locator('#filetree [data-doc]')).toHaveCount(2)
  const failedBackup = page.waitForEvent('download')
  await page.locator('#btn-recovery-backup').click()
  expect(JSON.parse((await readFile((await (await failedBackup).path())!)).toString()).docs).toHaveLength(2)
})

test('replacement rejects stale deletion confirmations and in-flight image imports', async ({page}) => {
  await page.goto('/')
  const bytes = await picture(page)
  const original = review(bytes)
  const source = {...original, docs: original.docs.slice(0, 1), activeDocId: 'copy'}
  await page.locator('#file-input').setInputFiles(jsonFile('source.json', source))
  await saved(page)
  const changed = {...source, docs: [{...source.docs[0], name: 'Restored.md', text: 'Fresh release text.', annotations: [{...source.docs[0]!.annotations[0], comment: 'Restored feedback'}]}]}
  await test.step('A confirmation opened before restoration cannot mutate a replacement with the same ID', async () => {
    await page.evaluate(() => {
      const read = File.prototype.text
      File.prototype.text = async function () {
        if (this.name === 'restore.json') await new Promise<void>(resolve => {Object.assign(window, {releaseBackup: resolve})})
        return read.call(this)
      }
    })
    await page.locator('#workspace-input').setInputFiles(jsonFile('restore.json', changed))
    await page.locator('#sidebar [data-op="delete"]').click()
    await page.evaluate(() => (window as unknown as {releaseBackup: () => void}).releaseBackup())
    await page.getByRole('alertdialog', {name: '恢复完整工作区？'}).getByRole('button', {name: '恢复工作区', exact: true}).click()
    await expect(page.getByText('完整工作区已恢复')).toBeVisible()
    await page.getByRole('alertdialog', {name: '删除这条批注？'}).getByRole('button', {name: '删除', exact: true}).click()
    await expect(page.locator('.toast')).toContainText('文档在操作期间发生变化')
    expect((await workspace(page)).docs[0]).toMatchObject({text: 'Fresh release text.', annotations: [{comment: 'Restored feedback'}]})
    expect((await workspace(page)).trash).toHaveLength(0)
  })
  await test.step('An image decoded during replacement is explicitly rejected, never reported saved then discarded', async () => {
    await page.evaluate(() => {
      const decode = HTMLImageElement.prototype.decode
      HTMLImageElement.prototype.decode = async function () {
        await new Promise<void>(resolve => {Object.assign(window, {releaseImage: resolve})})
        return decode.call(this)
      }
      const put = IDBObjectStore.prototype.put
      IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
        const result = put.apply(this, args)
        Object.assign(window, {holdWrite: true})
        const keepAlive = () => {if ((window as unknown as {holdWrite: boolean}).holdWrite) this.get('workspace').onsuccess = keepAlive}
        keepAlive()
        return result
      }
    })
    await page.locator('#file-input').setInputFiles({name: 'pending.png', mimeType: 'image/png', buffer: bytes})
    await expect.poll(() => page.evaluate(() => typeof (window as unknown as {releaseImage?: unknown}).releaseImage)).toBe('function')
    await page.locator('#workspace-input').setInputFiles(jsonFile('another.json', source))
    await page.getByRole('alertdialog').getByRole('button', {name: '恢复工作区', exact: true}).click()
    await expect.poll(() => page.evaluate(() => document.body.inert)).toBe(true)
    await expect.poll(() => page.evaluate(() => (window as unknown as {holdWrite: boolean}).holdWrite)).toBe(true)
    await page.evaluate(() => (window as unknown as {releaseImage: () => void}).releaseImage())
    await expect(page.locator('.toast')).toContainText('正在恢复工作区')
    await page.evaluate(() => Object.assign(window, {holdWrite: false}))
    await expect(page.getByText('完整工作区已恢复')).toBeVisible()
    expect((await workspace(page)).docs).toHaveLength(1)
    await page.reload()
    await expect(page.locator('#editor')).toContainText('Alpha shared phrase.')
    await expect(page.locator('#filetree [data-doc]')).toHaveCount(1)
  })
})
test('backup plus W3C replay shares remapped annotation identity and reports ambiguous sources', async ({page}) => {
  await page.goto('/')
  const data = review(await picture(page))
  const text = data.docs[0]!
  await page.locator('#file-input').setInputFiles(jsonFile('existing.json', {...data, docs: [text], activeDocId: text.id}))
  await saved(page)
  const image = {...data.docs[1] as ImageDocument, annotations: [{...(data.docs[1] as ImageDocument).annotations[0]!, id: text.annotations[0]!.id}]}
  const w3c = jsonFile('annotations.json', toW3C(image))
  await page.locator('#file-input').setInputFiles([jsonFile('image.json', {...data, docs: [image], activeDocId: image.id}), w3c])
  await expect.poll(async () => (await workspace(page)).docs.length).toBe(2)
  const imported = (await workspace(page)).docs[1]
  expect(imported.annotations).toHaveLength(1)
  expect(imported.annotations[0].id).not.toBe(text.annotations[0]!.id)
  await page.locator('#file-input').setInputFiles(w3c)
  await expect(page.locator('.toast')).toContainText('这些批注已导入')
  expect((await workspace(page)).docs[1].annotations).toHaveLength(1)
  await page.locator('#filetree [data-remove="copy"]').click()
  await page.getByRole('alertdialog').getByRole('button', {name: '移除', exact: true}).click()
  await page.locator('#btn-trash').click()
  await page.getByRole('dialog', {name: '回收站'}).getByRole('button', {name: '清空回收站'}).click()
  await page.getByRole('alertdialog').getByRole('button', {name: '清空', exact: true}).click()
  await page.getByRole('dialog', {name: '回收站'}).getByRole('button', {name: '关闭'}).click()
  await saved(page)
  await page.locator('#file-input').setInputFiles(w3c)
  await expect(page.locator('.toast')).toContainText('这些批注已导入')
  expect((await workspace(page)).docs[0].annotations.map((a: {id: string}) => a.id)).toEqual([imported.annotations[0].id])
  await page.locator('#file-input').setInputFiles([jsonFile('copy.json', {...data, docs: [{...image, annotations: []}], activeDocId: image.id}), w3c])
  await expect(page.locator('.toast')).toContainText('1 条无法匹配目标已跳过')
  await saved(page)
  expect((await workspace(page)).docs.map((doc: {annotations: unknown[]}) => doc.annotations.length)).toEqual([1, 0])
})

test('a delayed import cannot steal the document owned by a revision input session', async ({page}) => {
  await page.goto('/')
  await page.locator('#file-input').setInputFiles({name: 'A.md', mimeType: 'text/markdown', buffer: Buffer.from('Original document A')})
  await saved(page)
  await page.evaluate(() => {
    const read = File.prototype.text
    File.prototype.text = async function () {
      if (this.name === 'B.md') await new Promise<void>(resolve => Object.assign(window, {releaseImport: () => {File.prototype.text = read; resolve()}}))
      return read.call(this)
    }
  })
  await page.locator('#file-input').setInputFiles({name: 'B.md', mimeType: 'text/markdown', buffer: Buffer.from('Original document B')})
  await page.waitForFunction(() => 'releaseImport' in window)
  await workspaceAction(page, 'diff')
  const dialog = page.getByRole('dialog', {name: '贴入「A.md」的 AI 改稿'})
  await dialog.locator('textarea').fill('Revision intended for document A')
  await page.evaluate(() => (window as unknown as {releaseImport: () => void}).releaseImport())
  await expect(page.locator('.toast')).toContainText('请先提交或取消当前文本输入')
  await expect(dialog.locator('textarea')).toHaveValue('Revision intended for document A')
  await expect(page.locator('#editor')).toContainText('Original document A')
  await expect(page.locator('#filetree [data-doc]')).toHaveCount(1)

  await dialog.locator('textarea').fill(' ')
  await dialog.getByRole('button', {name: '生成对照', exact: true}).click()
  await expect(dialog.getByRole('alert')).toContainText('请输入或粘贴文本')
  await expect(dialog.locator('textarea')).toHaveValue(' ')
  await dialog.locator('textarea').fill('Revision intended for document A')
  await dialog.getByRole('button', {name: '生成对照', exact: true}).click()
  await saved(page)
  expect((await workspace(page)).docs).toMatchObject([{name: 'A.md', revised: 'Revision intended for document A'}])
  await page.locator('#file-input').setInputFiles({name: 'B.md', mimeType: 'text/markdown', buffer: Buffer.from('Original document B')})
  await expect(page.locator('#filetree [data-doc]')).toHaveCount(2)
  await saved(page)
  await page.reload()
  const result = await workspace(page)
  expect(result.docs.find((doc: {name: string}) => doc.name === 'A.md').revised).toBe('Revision intended for document A')
  expect(result.docs.find((doc: {name: string}) => doc.name === 'B.md')).not.toHaveProperty('revised')
})
