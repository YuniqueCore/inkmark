import {documentAction} from './actions'
/** Markdown 业务旅程共享的浏览器交互。 */
import type { Locator, Page } from '@playwright/test'
import { Workbench } from '../screens/Workbench'

export const workspace = async (page: Page) => JSON.parse(await storedWorkspace(page) ?? 'null')

export function storedWorkspace(page: Page): Promise<string | undefined> {
  return page.evaluate(() => new Promise<string | undefined>((resolve, reject) => {
    const request = indexedDB.open('inkmark-workspace')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction('snapshots', 'readonly')
      const read = tx.objectStore('snapshots').get('workspace')
      read.onsuccess = () => resolve(read.result)
      tx.oncomplete = () => db.close()
    }
  }))
}

export function setStoredWorkspace(page: Page, raw: string): Promise<void> {
  return page.evaluate((value) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('inkmark-workspace')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction('snapshots', 'readwrite')
      tx.objectStore('snapshots').put(value, 'workspace')
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => reject(tx.error)
    }
  }), raw)
}


export async function openNew(page: Page, empty = false): Promise<void> {
  if (empty) await page.locator('#btn-empty-paste').click()
  else await documentAction(page, 'new')
}

export async function createDoc(page: Page, text: string, empty = false): Promise<void> {
  await openNew(page, empty)
  await page.getByRole('textbox', {name: '新文档内容'}).fill(text)
  await page.getByRole('dialog', {name: '粘贴新建文档'}).getByRole('button', {name: '创建文档'}).click()
}

/** 通过 DOM Range 选择真实渲染文本；坐标期望由测试的源文计算。 */
export async function selectText(locator: Locator, from: number, to: number): Promise<void> {
  await locator.evaluate((root, bounds) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    while (walker.nextNode()) nodes.push(walker.currentNode as Text)
    let offset = 0
    let start: {node: Text; offset: number} | undefined
    let end: {node: Text; offset: number} | undefined
    for (const node of nodes) {
      if (!start && offset + node.length > bounds.from) start = {node, offset: bounds.from - offset}
      if (!end && offset + node.length >= bounds.to) end = {node, offset: bounds.to - offset}
      offset += node.length
    }
    if (!start || !end) throw new Error('无法在渲染文本中建立选区')
    const range = document.createRange()
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset)
    const selected = window.getSelection()!
    selected.removeAllRanges()
    selected.addRange(range)
    const rect = range.getBoundingClientRect()
    root.dispatchEvent(new MouseEvent('mouseup', {bubbles: true, clientX: rect.right, clientY: rect.bottom}))
  }, {from, to})
}

export async function dragText(page: Page, locator: Locator): Promise<void> {
  const points = await locator.evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const text = walker.nextNode() as Text
    const first = document.createRange()
    first.setStart(text, 0); first.setEnd(text, 1)
    const last = document.createRange()
    last.setStart(text, text.length - 1); last.setEnd(text, text.length)
    const a = first.getBoundingClientRect(); const b = last.getBoundingClientRect()
    return {x1: a.left + 1, y1: a.top + a.height / 2, x2: b.right - 1, y2: b.top + b.height / 2}
  })
  await page.mouse.move(points.x1, points.y1)
  await page.mouse.down()
  await page.mouse.move(points.x2, points.y2, {steps: 8})
  await page.mouse.up()
}

export async function submitPreviewAnnotation(page: Page, comment: string): Promise<void> {
  await Workbench.pinDot(page).click()
  await Workbench.composerInput(page).fill(comment)
  await Workbench.submitButton(page).click()
}

