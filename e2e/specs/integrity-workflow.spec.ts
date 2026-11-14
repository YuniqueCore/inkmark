/** 改稿、W3C、删除恢复和界面快照的真实浏览器旅程。 */
import { expect, test } from '../screenplay/fixtures/screenplay'
import { BrowseTheWorkbench } from '../screenplay/abilities/BrowseTheWorkbench'
import { Workbench } from '../screenplay/screens/Workbench'
import { AnnotateFirstBlock } from '../screenplay/tasks/workbench'
import { createDoc, selectText, submitPreviewAnnotation, workspace } from '../screenplay/support/markdown'

test.describe.configure({timeout: 45_000})

test('改稿批注、原文编辑和搜索各自保持正确的文本坐标', async ({page}) => {
  await page.goto('/')
  const original = '原文关键句。\n共同结束。'
  const revised = '改稿关键句。\n共同结束。'
  await createDoc(page, original, true)
  await test.step('Given：改稿侧写一条批注，返回原文不应误高亮', async () => {
    await page.locator('#btn-diff').click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('textbox').fill(revised)
    await dialog.getByRole('button', {name: '生成对照'}).click()
    await selectText(page.locator('.diff-add .editor-blk').first(), 0, 4)
    await submitPreviewAnnotation(page, '改稿侧意见')
    await expect(page.locator('.diff-add .seg-hl')).toContainText('改稿关键')
    await page.locator('#btn-diff').click()
    await expect(page.locator('#editor .seg-hl')).toHaveCount(0)
  })
  await test.step('When：原文增加前缀并保存，改稿批注坐标不变', async () => {
    await page.locator('#btn-edit').click()
    await page.locator('#edit-source').fill(`新增前言。\n${original}`)
    await page.getByRole('button', {name: '完成并重锚批注'}).click()
    await expect.poll(async () => (await workspace(page))?.docs[0]?.text ?? '').toContain('新增前言')
    const saved = await workspace(page)
    expect(saved.docs[0].annotations[0]).toMatchObject({target: 'revised', start: 0, end: 4, comment: '改稿侧意见'})
    await page.locator('#btn-diff').click()
    await expect(page.locator('.diff-add .seg-hl')).toContainText('改稿关键')
  })
  await test.step('Then：跨原文与改稿的选区被拒绝，搜索回到原文并显示命中', async () => {
    await page.evaluate(() => {
      const source = document.querySelector('.diff-del .editor-blk')!
      const additions = document.querySelectorAll('.diff-add .editor-blk')
      const changed = additions[additions.length - 1]!
      const first = document.createTreeWalker(source, NodeFilter.SHOW_TEXT).nextNode()!
      const last = document.createTreeWalker(changed, NodeFilter.SHOW_TEXT).nextNode()!
      const range = document.createRange(); range.setStart(first, 0); range.setEnd(last, Math.min(2, last.textContent!.length))
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range)
      const rect = range.getBoundingClientRect()
      document.querySelector('#editor')!.dispatchEvent(new MouseEvent('mouseup', {bubbles: true, clientX: rect.right, clientY: rect.bottom}))
    })
    await expect(Workbench.pinDot(page)).toBeHidden()
    await page.locator('#btn-search').click()
    await page.locator('#sp-input').fill('原文关键')
    await expect(page.locator('#editor .seg-search')).toContainText('原文关键')
    await expect(page.locator('.diff-row')).toHaveCount(0)
  })
})

test('W3C 重复导入和回收站恢复不会合并两个独立批注', async ({actor}) => {
  const page = BrowseTheWorkbench.as(actor).page
  await createDoc(page, '这是一份足够长的原文，用于批注和导出。', true)
  await actor.attemptsTo(AnnotateFirstBlock({from: 0, to: 8, comment: '需要修改'}))
  await page.locator('#btn-export').click()
  await page.locator('#export-modal [data-tab="w3c"]').click()
  const exported = await page.locator('#export-preview').inputValue()
  await Workbench.exportModal(page).getByRole('button', {name: '关闭'}).click()
  await page.locator('#sidebar .ann-card [data-op="delete"]').first().click()
  await page.getByRole('alertdialog').getByRole('button', {name: '删除', exact: true}).click()
  const file = {name: 'annotations.json', mimeType: 'application/json', buffer: Buffer.from(exported)}
  await page.locator('#file-input').setInputFiles(file)
  await expect(page.locator('#sidebar .ann-card')).toHaveCount(1)
  await page.locator('#file-input').setInputFiles(file)
  await expect(page.getByText('这些批注已导入')).toBeVisible()
  await expect(page.locator('#sidebar .ann-card')).toHaveCount(1)
  await page.locator('#btn-trash').click()
  await page.locator('[data-entry] [data-op="restore"]').first().click()
  await page.getByRole('dialog', {name: '回收站'}).getByRole('button', {name: '关闭'}).click()
  await expect(page.locator('#sidebar .ann-card')).toHaveCount(2)
  await expect.poll(async () => (await workspace(page))?.docs[0]?.annotations.length ?? 0).toBe(2)
  const saved = await workspace(page)
  expect(new Set(saved.docs[0].annotations.map((a: {id: string}) => a.id)).size).toBe(2)
  await page.reload()
  await expect(page.locator('#sidebar .ann-card')).toHaveCount(2)
})

test('危险操作中键盘焦点在取消时，Enter 不会执行删除', async ({page}) => {
  await page.goto('/')
  await createDoc(page, '需要保护的文档。', true)
  const row = page.locator('#filetree [data-doc]').first()
  await row.hover(); await row.locator('[data-remove]').click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog.getByRole('button', {name: '移除', exact: true})).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('button', {name: '取消', exact: true})).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('#filetree [data-doc]')).toHaveCount(1)
})

test('编辑保留统一换行，混合换行的实际变更先提示', async ({page}) => {
  await page.goto('/')
  const windows = '第一行\r\n第二行\r\n'
  await page.locator('#file-input').setInputFiles({name: 'windows.md', mimeType: 'text/markdown', buffer: Buffer.from(windows)})
  await expect.poll(async () => (await workspace(page))?.docs[0]?.text).toBe(windows)
  await selectText(page.locator('#editor .editor-blk').first(), 4, 7)
  await submitPreviewAnnotation(page, '第二行批注')
  await expect.poll(async () => (await workspace(page))?.docs[0]?.annotations.length).toBe(1)
  const annotation = (await workspace(page)).docs[0].annotations[0]
  expect(windows.slice(annotation.start, annotation.end)).toBe('第二行')
  await page.locator('#btn-edit').click()
  await expect(page.locator('#edit-source')).toHaveValue('第一行\n第二行\n')
  expect(await page.evaluate(() => {
    const event = new Event('beforeunload', {cancelable: true})
    window.dispatchEvent(event)
    return event.defaultPrevented
  })).toBe(false)
  await page.getByRole('button', {name: '完成并重锚批注'}).click()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  expect((await workspace(page)).docs[0].text).toBe(windows)
  await page.locator('#btn-edit').click()
  await page.locator('#edit-source').fill('第一行已改\n第二行\n第三行\n')
  await page.getByRole('button', {name: '完成并重锚批注'}).click()
  await expect.poll(async () => (await workspace(page))?.docs[0]?.text).toBe('第一行已改\r\n第二行\r\n第三行\r\n')
  const edited = (await workspace(page)).docs[0]
  expect(edited.text.slice(edited.annotations[0].start, edited.annotations[0].end)).toBe('第二行')
  const cr = edited.text.indexOf('\r')
  const splitNewline = {
    id: 'https://annotations.example.test/cr-boundary', type: 'Annotation',
    body: [{type: 'TextualBody', purpose: 'describing', value: '换行边界'}],
    target: {source: `urn:inkmark:doc:${edited.id}`, selector: [
      {type: 'TextQuoteSelector', exact: '\r', prefix: edited.text.slice(Math.max(0, cr - 32), cr), suffix: edited.text.slice(cr + 1, cr + 33)},
      {type: 'TextPositionSelector', start: cr, end: cr + 1},
    ]},
  }
  await page.locator('#file-input').setInputFiles({name: 'newline.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(splitNewline))})
  await expect.poll(async () => (await workspace(page))?.docs[0]?.annotations.length).toBe(2)
  await expect(page.locator('#editor .editor-blk').first().locator('br')).toHaveCount(2)
  await selectText(page.locator('#editor .editor-blk').first(), 0, '第一行已改'.length + 1 + '第二行'.length)
  await submitPreviewAnnotation(page, '跨 CRLF 的批注')
  await expect.poll(async () => (await workspace(page))?.docs[0]?.annotations.length).toBe(3)
  const crossLine = (await workspace(page)).docs[0].annotations[2]
  expect((await workspace(page)).docs[0].text.slice(crossLine.start, crossLine.end)).toBe('第一行已改\r\n第二行')

  const mixed = '第一行\r\n第二行\n第三行\r'
  await page.locator('#file-input').setInputFiles({name: 'mixed.md', mimeType: 'text/markdown', buffer: Buffer.from(mixed)})
  await expect(page.locator('#filetree')).toContainText('mixed.md')
  await page.locator('#btn-edit').click()
  await page.getByRole('button', {name: '完成并重锚批注'}).click()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect.poll(async () => (await workspace(page))?.docs.find((d: {name: string}) => d.name === 'mixed.md')?.text).toBe(mixed)
  await page.locator('#btn-edit').click()
  await page.locator('#edit-source').fill('第一行已改\n第二行\n第三行\n')
  await page.getByRole('button', {name: '完成并重锚批注'}).click()
  const confirmation = page.getByRole('alertdialog', {name: '保存编辑？'})
  await expect(confirmation).toContainText('原文混用了不同换行格式；保存后换行将统一为 LF')
  await confirmation.getByRole('button', {name: '取消'}).click()
  await expect(page.locator('#edit-source')).toHaveValue('第一行已改\n第二行\n第三行\n')
  await page.getByRole('button', {name: '完成并重锚批注'}).click()
  await confirmation.getByRole('button', {name: '保存'}).click()
  await expect.poll(async () => (await workspace(page))?.docs.find((d: {name: string}) => d.name === 'mixed.md')?.text).toBe('第一行已改\n第二行\n第三行\n')

  const carriageReturns = '第一行\r第二行\r\r第三行'
  await page.locator('#file-input').setInputFiles({name: 'classic.md', mimeType: 'text/markdown', buffer: Buffer.from(carriageReturns)})
  await expect(page.locator('#editor .editor-blk')).toHaveCount(2)
  await expect(page.locator('#editor .editor-blk').first().locator('br')).toHaveCount(1)
  await selectText(page.locator('#editor .editor-blk').first(), 3, 6)
  await submitPreviewAnnotation(page, '经典换行的批注')
  await expect.poll(async () => (await workspace(page))?.docs.find((d: {name: string}) => d.name === 'classic.md')?.annotations.length).toBe(1)
  const classic = (await workspace(page)).docs.find((d: {name: string}) => d.name === 'classic.md')
  expect(classic.text.slice(classic.annotations[0].start, classic.annotations[0].end)).toBe('第二行')
  await page.getByRole('button', {name: '预览', exact: true}).click()
  await expect(page.locator('#markdown-preview .seg-hl')).toHaveText('第二行')
  await page.locator('#btn-diff').click()
  const revision = page.getByRole('dialog')
  await revision.getByRole('textbox').fill('第一行\n第二行已改\n\n第三行')
  await revision.getByRole('button', {name: '生成对照'}).click()
  await expect(page.locator('.diff-del .seg-hl')).toHaveText('第二行')
  await expect(page.locator('.diff-add')).toContainText('第二行已改')
})

test('草稿跨视图、覆盖和删除时保持归属，恢复后可继续批注', async ({page}) => {
  await page.goto('/')
  await createDoc(page, '第一份文档的内容。', true)
  await createDoc(page, '第二份文档的内容。')
  await page.getByRole('button', {name: '预览', exact: true}).click()
  await selectText(page.locator('#markdown-preview p').first(), 0, 4)
  await Workbench.pinDot(page).click()
  await Workbench.composerInput(page).fill('第二份文档的草稿')

  await page.setViewportSize({width: 390, height: 844})
  await page.locator('#btn-tree-drawer').click()
  await expect(page.locator('body')).toHaveClass(/tree-open/)
  await page.keyboard.press('Escape')
  await expect(page.locator('body')).not.toHaveClass(/tree-open/)
  await expect(Workbench.composerInput(page)).toHaveValue('第二份文档的草稿')
  await page.setViewportSize({width: 1440, height: 900})

  // 草稿尚未提交时，离开页面会提示；备份明确告知不含草稿。
  expect(await page.evaluate(() => {
    const event = new Event('beforeunload', {cancelable: true})
    window.dispatchEvent(event)
    return event.defaultPrevented
  })).toBe(true)
  const download = page.waitForEvent('download')
  await page.locator('#btn-more').click()
  await page.getByRole('menuitem', {name: /下载文档与批注备份/}).click()
  await download
  await expect(page.getByText('备份已下载，未提交的划词草稿不包含在内')).toBeVisible()

  await page.locator('#btn-edit').click()
  await page.locator('#edit-source').fill('这次编辑还没有保存。')
  await page.getByRole('button', {name: '完成并重锚批注'}).click()
  const saveEdit = page.getByRole('alertdialog', {name: '保存编辑？'})
  await expect(saveEdit).toContainText('保存会放弃此原文上未提交的划词草稿')
  await saveEdit.getByRole('button', {name: '取消'}).click()
  await expect(page.locator('#edit-source')).toHaveValue('这次编辑还没有保存。')
  await page.getByRole('button', {name: '取消', exact: true}).click()
  await selectText(page.locator('#markdown-preview p').first(), 0, 4)
  await Workbench.pinDot(page).click()
  await expect(Workbench.composerInput(page)).toHaveValue('第二份文档的草稿')

  const replacement = {name: '粘贴文档-1.md', mimeType: 'text/markdown', buffer: Buffer.from('新的版本与旧的内容不同。')}
  await page.locator('#file-input').setInputFiles(replacement)
  const conflict = page.getByRole('dialog', {name: '导入冲突诊断'})
  await conflict.locator('[data-action="overwrite"]').click()
  await conflict.getByRole('button', {name: '确认导入'}).click()
  const abandon = page.getByRole('alertdialog', {name: '放弃未提交的划词草稿？'})
  await expect(abandon).toBeVisible()
  await abandon.getByRole('button', {name: '取消'}).click()
  await expect(page.locator('#markdown-preview')).toContainText('第二份文档的内容')
  await expect(Workbench.composerInput(page)).toHaveValue('第二份文档的草稿')

  // 两种阅读视图共享同一草稿，隐藏后按 Esc 不应丢弃它。
  await page.getByRole('button', {name: '分栏', exact: true}).click()
  await page.keyboard.press('Escape')
  await selectText(page.locator('#editor .editor-blk').first(), 0, 4)
  await Workbench.pinDot(page).click()
  await expect(Workbench.composerInput(page)).toHaveValue('第二份文档的草稿')
  await page.getByRole('button', {name: '预览', exact: true}).click()
  await selectText(page.locator('#markdown-preview p').first(), 0, 4)
  await Workbench.pinDot(page).click()
  await expect(Workbench.composerInput(page)).toHaveValue('第二份文档的草稿')

  const second = page.locator('#filetree [data-doc]').filter({hasText: '粘贴文档-1.md'})
  await second.hover()
  await second.locator('[data-remove]').click()
  await expect(page.getByRole('alertdialog')).toContainText('未提交的划词草稿仅保留在当前页面')
  await page.getByRole('alertdialog').getByRole('button', {name: '移除', exact: true}).click()
  await expect(Workbench.composerCard(page)).toBeHidden()
  await expect(page.locator('#markdown-preview')).toContainText('第一份文档的内容')
  await expect.poll(async () => (await workspace(page))?.docs.length).toBe(1)
  expect((await workspace(page)).docs[0].annotations).toHaveLength(0)

  // 在另一份文档中关闭界面不应取消已隐藏的旧草稿。
  await page.keyboard.press('Escape')
  await page.evaluate(() => {
    const now = Date.now
    ;(window as Window & {restoreTestClock?: () => void}).restoreTestClock = () => { Date.now = now }
    Date.now = () => now() + 8 * 24 * 60 * 60 * 1000
  })
  await page.locator('#btn-trash').click()
  await expect(page.getByText('有未提交草稿的过期文档暂保留在回收站')).toBeVisible()
  await page.locator('[data-entry] [data-op="restore"]').first().click()
  await page.getByRole('dialog', {name: '回收站'}).getByRole('button', {name: '关闭'}).click()
  await page.evaluate(() => (window as Window & {restoreTestClock?: () => void}).restoreTestClock?.())
  await page.locator('#filetree [data-doc]').filter({hasText: '粘贴文档-1.md'}).click()
  await selectText(page.locator('#markdown-preview p').first(), 0, 4)
  await Workbench.pinDot(page).click()
  await expect(Workbench.composerInput(page)).toHaveValue('第二份文档的草稿')
  await Workbench.submitButton(page).click()
  await expect.poll(async () => (await workspace(page))?.docs.find((d: {name: string}) => d.name === '粘贴文档-1.md')?.annotations.length).toBe(1)
  const saved = await workspace(page)
  expect(saved.docs.find((d: {name: string}) => d.name === '粘贴文档.md').annotations).toHaveLength(0)
  expect(saved.docs.find((d: {name: string}) => d.name === '粘贴文档-1.md').annotations[0].comment).toBe('第二份文档的草稿')

  // 用户也可以明确放弃草稿并继续覆盖；旧草稿不能套到同偏移的新文字。
  await selectText(page.locator('#markdown-preview p').first(), 4, 8)
  await Workbench.pinDot(page).click()
  await Workbench.composerInput(page).fill('针对旧版本的草稿')
  await page.locator('#file-input').setInputFiles(replacement)
  await conflict.locator('[data-action="overwrite"]').click()
  await conflict.getByRole('button', {name: '确认导入'}).click()
  await abandon.getByRole('button', {name: '放弃草稿并继续'}).click()
  await expect(page.locator('#markdown-preview')).toContainText('新的版本与旧的内容不同')
  await selectText(page.locator('#markdown-preview p').first(), 4, 8)
  await Workbench.pinDot(page).click()
  await expect(Workbench.composerInput(page)).toBeEmpty()

  // 尚未输入的卡片在文本覆盖后也必须失效。
  await page.locator('#file-input').setInputFiles({name: replacement.name, mimeType: replacement.mimeType, buffer: Buffer.from('最后一版文档内容。')})
  await conflict.locator('[data-action="overwrite"]').click()
  await conflict.getByRole('button', {name: '确认导入'}).click()
  await expect(Workbench.composerCard(page)).toBeHidden()
  await expect(page.locator('#markdown-preview')).toContainText('最后一版文档内容')

  // 永久删除前明确说明草稿会丢弃；确认后不再留下无法恢复的草稿。
  await selectText(page.locator('#markdown-preview p').first(), 0, 4)
  await Workbench.pinDot(page).click()
  await Workbench.composerInput(page).fill('需要明确丢弃的草稿')
  await second.hover()
  await second.locator('[data-remove]').click()
  await page.getByRole('alertdialog').getByRole('button', {name: '移除', exact: true}).click()
  await page.locator('#btn-trash').click()
  await page.locator('[data-entry] [data-op="purge"]').first().click()
  const purge = page.getByRole('alertdialog', {name: '彻底删除此项？'})
  await expect(purge).toContainText('未提交的划词草稿也会被放弃')
  await purge.getByRole('button', {name: '取消'}).click()
  await page.locator('[data-entry] [data-op="purge"]').first().click()
  await purge.getByRole('button', {name: '彻底删除', exact: true}).click()
  await page.getByRole('dialog', {name: '回收站'}).getByRole('button', {name: '关闭'}).click()
  expect(await page.evaluate(() => {
    const event = new Event('beforeunload', {cancelable: true})
    window.dispatchEvent(event)
    return event.defaultPrevented
  })).toBe(false)
})

test('桌面和手机分栏的视觉快照', async ({page}) => {
  test.skip(process.platform !== 'darwin', '视觉基线使用 macOS 系统 Chrome；结构快照在所有平台运行。')
  await page.setViewportSize({width: 1440, height: 900})
  await page.goto('/')
  await createDoc(page, '# 阅读与批注\n\n这是一段 **需要关注** 的内容。\n\n- 一份清晰的文档\n- 一条可追踪的意见\n\n> 保留文字与上下文。', true)
  await page.getByRole('button', {name: '分栏', exact: true}).click()
  await selectText(page.locator('#markdown-preview strong'), 0, 4)
  await submitPreviewAnnotation(page, '保留这段重点')
  await expect(page.locator('.toast')).not.toHaveClass(/opacity-95/)
  await expect(page.locator('#editor-wrap')).toHaveScreenshot('markdown-split-desktop.png', {animations: 'disabled', maxDiffPixelRatio: 0.02})
  await page.setViewportSize({width: 390, height: 844})
  await page.locator('#btn-theme').click()
  await expect(page.locator('#editor-wrap')).toHaveScreenshot('markdown-split-mobile-dark.png', {animations: 'disabled', maxDiffPixelRatio: 0.02})
})

test('混合导入先合并批注再重锚；异步解析期间切文档会安全取消', async ({page}) => {
  await page.goto('/')
  const original = '这是目标短语所在的原文，后面还有内容。'
  const updated = `新增前言。\n${original}`
  await page.locator('#file-input').setInputFiles({name: 'review.md', mimeType: 'text/plain', buffer: Buffer.from(original)})
  await expect(page.locator('#editor')).toContainText('目标短语')
  await expect.poll(async () => (await workspace(page))?.docs.length ?? 0).toBe(1)
  const docId = (await workspace(page)).docs[0].id
  const annotation = {
    id: 'https://annotations.example.test/review-1', type: 'Annotation', motivation: 'commenting',
    body: [{type: 'TextualBody', purpose: 'describing', value: '导入时保留的意见'}],
    target: {source: `urn:inkmark:doc:${docId}`, selector: [{type: 'TextQuoteSelector', exact: '目标短语'}]},
  }
  await page.locator('#file-input').setInputFiles([
    {name: 'review.md', mimeType: 'text/plain', buffer: Buffer.from(updated)},
    {name: 'annotations.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify([annotation]))},
  ])
  const conflict = page.getByRole('dialog', {name: '导入冲突诊断'})
  await conflict.locator('[data-action="overwrite"]').click()
  await conflict.getByRole('button', {name: '确认导入'}).click()
  await expect(page.locator('#sidebar')).toContainText('导入时保留的意见')
  await expect.poll(async () => (await workspace(page))?.docs[0]?.text ?? '').toBe(updated)
  let saved = await workspace(page)
  const imported = saved.docs[0].annotations[0]
  expect(updated.slice(imported.start, imported.end)).toBe('目标短语')

  await createDoc(page, '另一份文档也有目标短语，但不能接收旧文档的批注。')
  await page.locator('#filetree [data-doc]').filter({hasText: 'review.md'}).click()
  await page.evaluate(() => {
    const read = File.prototype.text
    File.prototype.text = async function () {
      await new Promise((resolve) => setTimeout(resolve, 500))
      return read.call(this)
    }
  })
  const unknownSource = {...annotation, id: 'https://annotations.example.test/review-2', target: {...annotation.target, source: 'unknown-source'}}
  await page.locator('#file-input').setInputFiles({name: 'delayed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify([unknownSource]))})
  await page.locator('#filetree [data-doc]').filter({hasText: '粘贴文档.md'}).click()
  await expect(page.getByText('工作区在导入期间发生变化，请重新导入')).toBeVisible()
  await expect.poll(async () => (await workspace(page))?.activeDocId ?? '').not.toBe(docId)
  saved = await workspace(page)
  expect(saved.docs.find((d: {id: string}) => d.id === docId).annotations).toHaveLength(1)
  expect(saved.docs.find((d: {id: string}) => d.id !== docId).annotations).toHaveLength(0)
  await page.evaluate(() => {
    File.prototype.text = async function () { throw new Error('simulated read failure') }
  })
  await page.locator('#file-input').setInputFiles({name: 'unreadable.md', mimeType: 'text/plain', buffer: Buffer.from('内容')})
  await expect(page.getByText('读取文件失败，请检查文件后重试')).toBeVisible()
  await expect(page.locator('#filetree [data-doc]')).toHaveCount(2)
})

test('只覆盖部分实体的源文批注不会在预览中伪装为完整字符', async ({actor}) => {
  const page = BrowseTheWorkbench.as(actor).page
  const text = '文本 &amp; 后续文字。'
  await createDoc(page, text, true)
  await actor.attemptsTo(AnnotateFirstBlock({from: text.indexOf('&amp;') + 1, to: text.indexOf('后续') + 2, comment: '源文局部实体'}))
  await page.getByRole('button', {name: '预览', exact: true}).click()
  await expect(page.locator('#markdown-preview .seg-hl')).toHaveCount(0)
  await page.locator('#sidebar .ann-card').getByRole('button', {name: '定位'}).click()
  await expect(page.getByRole('button', {name: '分栏', exact: true})).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('#editor .seg-hl')).toContainText('amp; 后续')
  await expect(page.getByText('该批注无法在预览中完整显示，已切换分栏定位原文')).toBeVisible()
})
