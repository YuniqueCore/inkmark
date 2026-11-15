import {workspaceAction} from '../screenplay/support/actions'
/** 业务旅程：从粘贴新建到双视图批注、重载、异常恢复与安全边界。 */
import { readFile } from 'node:fs/promises'
import { expect, test } from '../screenplay/fixtures/screenplay'
import { BrowseTheWorkbench } from '../screenplay/abilities/BrowseTheWorkbench'
import { Workbench } from '../screenplay/screens/Workbench'
import { SelectBlockText, ClickPinDot, TypeComment, SubmitAnnotation } from '../screenplay/interactions/composer'
import {ImportTextFile} from '../screenplay/interactions/workspace'
import {contrastRatio, hexToRgb} from '../../src/core/contrast'

import { createDoc, setStoredWorkspace, storedWorkspace, dragText, openNew, selectText, submitPreviewAnnotation, workspace } from '../screenplay/support/markdown'

test.describe.configure({timeout: 45_000})

test('Source syntax stays colored and readable across themes and custom paper without changing nested review anchors', async ({actor}) => {
  const page = BrowseTheWorkbench.as(actor).page
  await page.setViewportSize({width: 1440, height: 900})
  const source = '# 彩色源文 😀\r\n\r\n正文 **粗体 _斜体_** 与 [链接](https://example.test "标题")。`行内代码`\r\n\r\n- [x] 已完成\r\n- [ ] 待办\r\n\r\n> 引用\r\n\r\n---\r\n\r\n| 名称 | 状态 |\r\n| --- | --- |\r\n| 文档 | 完成 |\r\n\r\n```ts\r\nconst value = 42\r\n```\r\n\r\n转义 \\* 和 &amp; <!-- 注释 --> **对照文字**'
  await actor.attemptsTo(ImportTextFile('彩色源文.md', source))
  const palette = () => page.locator('#editor').evaluate(root => {
    const hex = (value: string) => '#' + value.match(/\d+/g)!.slice(0, 3).map(part => Number(part).toString(16).padStart(2, '0')).join('')
    return {
      background: hex(getComputedStyle(root).backgroundColor), foreground: hex(getComputedStyle(root).color),
      colors: ['heading', 'strong', 'mark', 'link', 'code', 'meta', 'comment'].map(role => ({
        role, color: hex(getComputedStyle([...root.querySelectorAll(`.md-syntax-${role}`)].find(node => !node.closest('.seg-hl,.seg-search') && (role === 'mark' || !node.classList.contains('md-syntax-mark')))!).color),
      })),
    }
  })
  const assertReadable = async (colored: boolean) => {
    const current = await palette()
    for (const {role, color} of current.colors) {
      expect(contrastRatio(color, current.background), `${role} on ${current.background}`).toBeGreaterThanOrEqual(4.5)
      if (colored) {
        const rgb = hexToRgb(color)!
        expect(Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b), `${role} must have an actual hue`).toBeGreaterThan(20)
        expect(color).not.toBe(current.foreground)
      }
    }
  }
  const previewColors = async () => {
    const surfaces = await page.locator('#markdown-preview').evaluate(pane => {
      const hex = (value: string) => '#' + value.match(/\d+/g)!.slice(0, 3).map(part => Number(part).toString(16).padStart(2, '0')).join('')
      return [
        {name: 'fenced code', text: 'pre code', background: 'pre'},
        {name: 'inline code', text: 'p > code', background: 'p > code'},
        {name: 'quote', text: 'blockquote', background: null},
      ].map(surface => ({
        name: surface.name,
        foreground: hex(getComputedStyle(pane.querySelector(surface.text)!).color),
        background: hex(getComputedStyle(surface.background ? pane.querySelector(surface.background)! : pane).backgroundColor),
      }))
    })
    for (const surface of surfaces) expect(contrastRatio(surface.foreground, surface.background), surface.name).toBeGreaterThanOrEqual(4.5)
    return surfaces
  }
  await test.step('Given real Markdown, punctuation and semantic content have actual colors in both light and dark Source views', async () => {
    await expect(page.locator('#markdown-preview')).toBeHidden()
    await assertReadable(true)
    await workspaceAction(page, 'settings')
    await Workbench.settingsDialog(page).locator('[data-set-theme="dark"]').click()
    await expect(Workbench.settingsDialog(page).locator('[data-set-theme="dark"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(Workbench.settingsDialog(page).locator('[data-set-theme="light"]')).toHaveAttribute('aria-pressed', 'false')
    await Workbench.settingsDialog(page).getByRole('button', {name: '完成'}).click()
    await assertReadable(true)
  })
  await test.step('When choosing custom paper, syntax contrast is corrected; resetting restores the theme palette', async () => {
    await page.getByRole('button', {name: '分栏', exact: true}).click()
    const darkDefault = await previewColors()
    const dark = await palette()
    await workspaceAction(page, 'settings')
    const dialog = Workbench.settingsDialog(page)
    await dialog.locator('[data-set-bg]').fill('#8658bf')
    expect((await palette()).background).toBe('#8658bf')
    await expect(dialog.locator('[data-clear-colors]')).toBeEnabled()
    await assertReadable(false)
    const darkPaper = await previewColors()
    await dialog.locator('[data-clear-colors]').click()
    expect(await palette()).toEqual(dark)
    expect(await previewColors()).toEqual(darkDefault)
    await dialog.locator('[data-set-theme="light"]').click()
    const lightDefault = await previewColors()
    await dialog.locator('[data-set-bg]').fill('#8658bf')
    expect((await palette()).background).toBe('#8658bf')
    await assertReadable(false)
    const lightPaper = await previewColors()
    expect(JSON.stringify({dark: darkPaper, light: lightPaper}, null, 2)).toMatchSnapshot('custom-paper-colors.json')
    await dialog.locator('[data-set-text]').fill('#047857')
    await assertReadable(false)
    expect((await previewColors())[0]!.foreground).toBe('#047857')
    await dialog.locator('[data-set-theme="dark"]').click()
    await assertReadable(false)
    await previewColors()
    await dialog.locator('[data-set-theme="light"]').click()
    await dialog.locator('[data-clear-colors]').click()
    await dialog.locator('[data-set-text]').fill('#047857')
    expect((await palette()).background).toBe(lightDefault[2]!.background)
    await previewColors()
    await dialog.locator('[data-clear-colors]').click()
    await expect(dialog.locator('[data-clear-colors]')).toBeDisabled()
    await assertReadable(true)
    expect(await previewColors()).toEqual(lightDefault)
    await dialog.getByRole('button', {name: '完成'}).click()
  })
  await test.step('Then selection across nested colored spans retains the original CRLF and emoji offsets through preview and reload', async () => {
    const text = '正文 **粗体 _斜体_** 与 [链接](https://example.test "标题")。'
    await actor.attemptsTo(SelectBlockText(1, text.indexOf('粗体'), text.indexOf('斜体') + 2), ClickPinDot(), TypeComment('跨语法范围的意见'), SubmitAnnotation())
    await expect(page.locator('#editor .seg-hl')).toContainText('粗体 _斜体')
    await expect.poll(async () => (await workspace(page)).docs[0].annotations.length).toBe(1)
    const saved = (await workspace(page)).docs[0]
    expect(saved.text).toBe(source)
    expect(saved.annotations[0].start).toBe(source.indexOf('粗体'))
    expect(source.slice(saved.annotations[0].start, saved.annotations[0].end)).toBe('粗体 _斜体')
    const annotatedColor = await page.locator('#editor .seg-hl .md-syntax-strong').first().evaluate(node => getComputedStyle(node).color)
    expect(annotatedColor).toBe(await page.locator('#editor').evaluate(node => getComputedStyle(node).color))
    await page.getByRole('button', {name: '分栏', exact: true}).click()
    await expect(page.locator('#markdown-preview h1')).toHaveText('彩色源文 😀')
    await expect(page.locator('#markdown-preview .md-syntax-mark')).toHaveCount(0)
    await expect(page.locator('#markdown-preview .seg-hl').first()).toContainText('粗体')
    await page.reload()
    await expect(page.locator('#sidebar')).toContainText('跨语法范围的意见')
    expect((await workspace(page)).docs[0].annotations).toEqual(saved.annotations)
    await assertReadable(true)
    await dragText(page, page.locator('#editor .md-syntax-code').filter({hasText: 'const value = 42'}), 'backward')
    expect(await page.evaluate(() => window.getSelection()!.anchorOffset > window.getSelection()!.focusOffset)).toBe(true)
    await submitPreviewAnnotation(page, '反向划选代码')
    await expect.poll(async () => (await workspace(page)).docs[0].annotations.length).toBe(2)
    const code = (await workspace(page)).docs[0].annotations[1]
    expect(source.slice(code.start, code.end)).toBe('const value = 42')
  })
})

test('审稿人从粘贴到源文与渲染预览互相批注，再重载和导出', async ({actor}) => {
  const page = BrowseTheWorkbench.as(actor).page
  await page.setViewportSize({width: 1440, height: 900})
  const source = '# 审阅标题\n\n开头 😀 **重点内容** 和普通文字。\n\n- 第一项\n- 第二项\n\n| 名称 | 状态 |\n| --- | --- |\n| 文档 | 完成 |\n\n```ts\nconst value = 42\n```'
  await test.step('Given：粘贴 Markdown，源文保留并显示语法层级', async () => {
    await createDoc(page, source, true)
    await expect(page.locator('#filetree')).toContainText('粘贴文档.md')
    await expect(page.locator('#editor .md-syntax-heading').first()).toBeVisible()
    await expect(page.locator('#editor .md-syntax-strong').first()).toBeVisible()
  })
  await test.step('When：分栏查看渲染结构，并用鼠标在预览划选批注', async () => {
    await page.getByRole('button', {name: '分栏', exact: true}).click()
    await expect(page.locator('#markdown-preview h1')).toHaveText('审阅标题')
    await expect(page.locator('#markdown-preview table')).toContainText('完成')
    expect(await page.locator('#markdown-preview .markdown-body').innerHTML()).toMatchSnapshot('rendered-markdown.html')
    await dragText(page, page.locator('#markdown-preview strong'))
    await submitPreviewAnnotation(page, '预览里的意见')
    await expect(page.locator('#markdown-preview .seg-hl')).toContainText('重点内容')
    await expect(page.locator('#editor .seg-hl')).toContainText('重点内容')
  })
  await test.step('Then：源文可继续划选，两个视图引用同一批注', async () => {
    const blockText = '开头 😀 **重点内容** 和普通文字。'
    const start = blockText.indexOf('普通文字')
    await actor.attemptsTo(SelectBlockText(1, start, start + '普通文字'.length), ClickPinDot(), TypeComment('源文里的意见'), SubmitAnnotation())
    await expect(page.locator('#sidebar')).toContainText('源文里的意见')
    await expect(page.locator('#markdown-preview .seg-hl')).toHaveCount(2)
    await expect.poll(async () => (await workspace(page))?.docs[0]?.annotations.length ?? 0).toBe(2)
    const saved = await workspace(page)
    expect(saved.docs[0].text).toBe(source)
    expect(saved.docs[0].annotations.map((a: {start: number; end: number}) => source.slice(a.start, a.end))).toEqual(['重点内容', '普通文字'])
  })
  await test.step('When：保护未保存批语，再保存并重新载入', async () => {
    await page.locator('#markdown-preview .seg-hl').first().click()
    await Workbench.popupInput(page).fill('未保存的修改')
    await page.getByRole('button', {name: '原文', exact: true}).click()
    await expect(Workbench.popupInput(page)).toHaveValue('未保存的修改')
    await expect(page.getByText('请先保存或取消批注编辑')).toBeVisible()
    await Workbench.popup(page).getByRole('button', {name: '保存', exact: true}).click()
    await expect.poll(async () => (await workspace(page)).docs[0].annotations[0].comment).toBe('未保存的修改')
    await page.reload()
    await expect(page.locator('#sidebar')).toContainText('未保存的修改')
    await page.locator('#btn-export').click()
    await page.locator('#export-modal [data-tab="w3c"]').click()
    const exported = JSON.parse(await page.locator('#export-preview').inputValue())
    const selector = exported[0].target.selector.find((s: {type: string}) => s.type === 'TextPositionSelector')
    expect(selector.start).toBe(Array.from(source.slice(0, source.indexOf('重点内容'))).length)
  })
})

test('重复粘贴、编辑草稿、删除与恢复组成完整文档生命周期', async ({actor}) => {
  const page = BrowseTheWorkbench.as(actor).page
  const text = '同一份原文 😀\n第二行内容。'
  await test.step('Given：空内容和超长内容被拒绝，弹层保留输入', async () => {
    await openNew(page, true)
    const dialog = page.getByRole('dialog', {name: '粘贴新建文档'})
    await dialog.getByRole('button', {name: '创建文档'}).click()
    await expect(dialog.getByRole('alert')).toContainText('请输入')
    await dialog.getByRole('textbox').fill('x'.repeat(400_001))
    await dialog.getByRole('button', {name: '创建文档'}).click()
    await expect(dialog.getByRole('alert')).toContainText('超过')
    await dialog.getByRole('textbox').fill(text)
    await dialog.getByRole('button', {name: '创建文档'}).click()
  })
  await test.step('When：相同内容再次显式创建，编辑草稿阻止切换', async () => {
    await createDoc(page, text)
    await expect(page.locator('#filetree [data-doc]')).toHaveCount(2)
    await expect(page.locator('#filetree')).toContainText('粘贴文档-1.md')
    await page.locator('#filetree [data-doc]').first().click()
    await workspaceAction(page, 'edit')
    await page.locator('#edit-source').fill('正在修改的草稿')
    await page.locator('#filetree [data-doc]').nth(1).click()
    await expect(page.locator('#edit-source')).toHaveValue('正在修改的草稿')
    await workspaceAction(page, 'search')
    await expect(page.getByText('请先完成或取消原文编辑').last()).toBeVisible()
    await page.getByRole('button', {name: '取消', exact: true}).click()
  })
  await test.step('Then：删除旧文档后创建同名文档，恢复时不覆盖且可重载', async () => {
    const first = page.locator('#filetree [data-doc]').filter({hasText: '粘贴文档.md'})
    await first.hover()
    await first.locator('[data-remove]').click()
    await page.getByRole('alertdialog').getByRole('button', {name: '移除', exact: true}).click()
    await createDoc(page, '新文档占用了原来的名称。')
    await workspaceAction(page, 'edit')
    await page.locator('#btn-trash').click()
    await page.locator('[data-entry] [data-op="restore"]').first().click()
    await page.getByRole('dialog', {name: '回收站'}).getByRole('button', {name: '关闭'}).click()
    await expect(page.locator('#filetree')).toContainText('粘贴文档-2.md')
    await expect.poll(async () => (await workspace(page)).docs.length).toBe(3)
    await page.getByRole('button', {name: '取消', exact: true}).click()
    await page.reload()
    await expect(page.locator('#filetree [data-doc]')).toHaveCount(3)
    const saved = await workspace(page)
    expect(saved.docs.filter((d: {text: string}) => d.text === text)).toHaveLength(2)
    expect(new Set(saved.docs.map((d: {id: string}) => d.id)).size).toBe(3)
  })
})

test('实体、隐藏链接和危险内容不会产生错误锚点或隐式网络请求', async ({page}) => {
  const requests: string[] = []
  await page.route('https://images.example.test/**', async (route) => {
    requests.push(route.request().url())
    await new Promise((resolve) => setTimeout(resolve, 350))
    await route.fulfill({status: 200, headers: {'cache-control': 'no-store'}, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')})
  })
  await page.goto('/')
  const source = '重复 重复 **粗体** &amp; &fjlig; \\* [链接](https://example.com/private) 后文 😀\n\n![示意图](https://images.example.test/pixel.png)\n\n<script>window.hacked=1</script>\n\n[坏链接](javascript:alert(1))'
  await createDoc(page, source, true)
  await page.getByRole('button', {name: '预览', exact: true}).click()
  await expect(page.locator('#markdown-preview script')).toHaveCount(0)
  expect(await page.evaluate(() => (window as Window & {hacked?: number}).hacked)).toBeUndefined()
  await expect(page.locator('#markdown-preview a[href^="javascript:"]')).toHaveCount(0)
  expect(requests).toEqual([])

  const entity = page.locator(`.md-source[data-source-start="${source.indexOf('&fjlig;')}"]`)
  await selectText(entity, 0, 1)
  await expect(page.getByText('此字符由一个 Markdown 实体或转义生成，请完整选中它。')).toBeVisible()
  await selectText(entity, 0, 2)
  await submitPreviewAnnotation(page, '实体批注')
  await expect.poll(async () => (await workspace(page))?.docs[0]?.annotations.length ?? 0).toBe(1)
  const saved = await workspace(page)
  const selected = saved.docs[0].annotations[0]
  expect(source.slice(selected.start, selected.end)).toBe('&fjlig;')

  const escaped = page.locator(`.md-source[data-source-start="${source.indexOf('\\*')}"]`)
  await selectText(escaped, 0, 1)
  await submitPreviewAnnotation(page, '转义字符批注')
  await expect.poll(async () => (await workspace(page))?.docs[0]?.annotations.length ?? 0).toBe(2)
  const second = (await workspace(page)).docs[0].annotations[1]
  expect(source.slice(second.start, second.end)).toBe('\\*')

  const link = page.locator('#markdown-preview a[href="https://example.com/private"]')
  await selectText(link, 0, 2)
  await submitPreviewAnnotation(page, '链接文字批注')
  let opened = 0
  page.on('popup', () => { opened++ })
  await link.locator('.seg-hl').click()
  await expect(Workbench.popupInput(page)).toBeVisible()
  await page.waitForTimeout(250)
  expect(opened).toBe(0)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')

  await page.evaluate(() => {
    const link = document.querySelector('#markdown-preview a[href="https://example.com/private"] .md-source')!
    const after = [...document.querySelectorAll('#markdown-preview .md-source')].find((el) => el.textContent?.includes('后文'))!
    const start = link.firstChild!; const finish = after.firstChild!
    const range = document.createRange(); range.setStart(start, 0); range.setEnd(finish, finish.textContent!.length)
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range)
    const rect = range.getBoundingClientRect()
    document.querySelector('#markdown-preview')!.dispatchEvent(new MouseEvent('mouseup', {bubbles: true, clientX: rect.right, clientY: rect.bottom}))
  })
  await expect(page.getByText('选区跨越未显示的 Markdown 内容，请在原文中选择。')).toBeVisible()
  await expect(page.locator('#sidebar .ann-card')).toHaveCount(3)

  await page.getByRole('button', {name: /图片：示意图/}).click()
  await workspaceAction(page, 'search')
  await page.locator('#sp-input').fill('重复')
  await page.locator('#sp-input').fill('粗体')
  await expect(page.locator('#markdown-preview img[alt="示意图"]')).toBeVisible()
  expect(requests).toHaveLength(1)
})

test('存储损坏时分别导出原始数据和新工作，并在用户确认后恢复自动保存', async ({page}) => {
  await page.goto('/')
  await expect.poll(async () => page.locator('#save-text').textContent()).toBe('已保存')
  const raw = '{"version":3,"docs":"corrupt","trash":[]}'
  await setStoredWorkspace(page, raw)
  await page.reload()
  await expect(page.locator('#save-error')).toBeVisible()
  await createDoc(page, '存储异常后仍须找回的新内容。', true)
  await expect(page.locator('#save-error')).toBeVisible()
  expect(await storedWorkspace(page)).toBe(raw)

  let downloads = 0
  page.on('download', () => { downloads++ })
  await workspaceAction(page, 'edit')
  await page.locator('#edit-source').fill('存储异常时还在编辑的内容。')
  await page.locator('#btn-recovery-backup').click()
  await expect(page.getByText('请先完成或取消原文编辑')).toBeVisible()
  await expect(page.locator('#edit-source')).toHaveValue('存储异常时还在编辑的内容。')
  expect(downloads).toBe(0)
  await page.getByRole('button', {name: '完成并重锚批注'}).click()

  const currentDownload = page.waitForEvent('download')
  await page.locator('#btn-recovery-backup').click()
  const current = JSON.parse(await readFile((await (await currentDownload).path())!, 'utf8'))
  expect(current.docs[0].text).toBe('存储异常时还在编辑的内容。')
  const rawDownload = page.waitForEvent('download')
  await page.locator('#btn-raw-backup').click()
  expect(await readFile((await (await rawDownload).path())!, 'utf8')).toBe(raw)
  await page.locator('#btn-reset-storage').click()
  await page.getByRole('alertdialog').getByRole('button', {name: '重置并保存'}).click()
  await expect(page.locator('#save-error')).toBeHidden()
  await expect.poll(async () => page.locator('#save-text').textContent()).toBe('已保存')
  await page.reload()
  await expect(page.locator('#editor')).toContainText('存储异常时还在编辑的内容。')
})

test('空工作台直接粘贴可建文档，输入框粘贴与恶意会话不会被误接管', async ({page}) => {
  await page.goto('/')
  const pasted = '# 直接粘贴\n\n保留 😀 与 **Markdown**。'
  await page.evaluate((text) => {
    const data = new DataTransfer()
    data.setData('text/plain', text)
    document.body.dispatchEvent(new ClipboardEvent('paste', {bubbles: true, clipboardData: data}))
  }, pasted)
  await expect(page.locator('#editor')).toContainText('直接粘贴')
  await expect.poll(async () => (await workspace(page))?.docs[0]?.text ?? '').toBe(pasted)
  await workspaceAction(page, 'edit')
  const intercepted = await page.locator('#edit-source').evaluate((textarea) => {
    const data = new DataTransfer(); data.setData('text/plain', '不应创建新文档')
    return !textarea.dispatchEvent(new ClipboardEvent('paste', {bubbles: true, cancelable: true, clipboardData: data}))
  })
  expect(intercepted).toBe(false)
  await page.getByRole('button', {name: '取消', exact: true}).click()

  const malicious = {
    version: 3, activeDocId: 'evil', trash: [], savedAt: 1,
    docs: [{id: 'evil" onmouseover="window.hacked=1', name: 'bad.md', path: '', text: '内容', addedAt: 1, annotations: []}],
  }
  await page.locator('#file-input').setInputFiles({name: 'hostile.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(malicious))})
  await expect(page.getByText(/没有可导入的文本文件/)).toBeVisible()
  await expect(page.locator('#filetree [data-doc]')).toHaveCount(1)
  expect(await page.evaluate(() => (window as Window & {hacked?: number}).hacked)).toBeUndefined()
})
