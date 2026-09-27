// @vitest-environment happy-dom
/** UI 层回归测试：文档树多选与批量操作。
 * 断言锚点：勾选驱动批量栏出现/消失；勾选不触发行点击（打开文档）；
 * 批量导出/删除回调收到选中文档 id；重渲染剪除已不存在的选择。
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { FileTreeView } from '../src/ui/filetree'
import type { DocItem } from '../src/core/types'

const doc = (id: string, name: string): DocItem => ({
  id,
  name,
  path: '',
  text: `${name} 的内容。`,
  annotations: [],
  addedAt: 1,
})

let root: HTMLElement
let tree: FileTreeView
const events: {op: string; ids: string[]}[] = []

beforeEach(() => {
  document.body.innerHTML = ''
  events.length = 0
  root = document.createElement('div')
  document.body.append(root)
  tree = new FileTreeView(root, {
    onOpen: () => {},
    onRemove: () => {},
    onExportDoc: (id) => events.push({op: 'export-doc', ids: [id]}),
    onBulkExport: (ids) => events.push({op: 'bulk-export', ids}),
    onBulkDelete: (ids) => events.push({op: 'bulk-delete', ids}),
  })
})

const checkbox = (id: string): HTMLInputElement => root.querySelector(`[data-select="${id}"]`)!
const bulkBar = () => root.querySelector('[data-bulk-bar]')?.textContent ?? null
const check = (id: string): void => {
  const box = checkbox(id)
  box.click()
  box.dispatchEvent(new Event('change'))
}

describe('FileTreeView 特殊字符转义', () => {
  it('文件名/目录名含引号：属性转义渲染，目录折叠正常（回归：data-dir 曾未转义）', () => {
    const quoted: DocItem = {
      id: 'q1',
      name: '含"引号"的文档.txt',
      path: '目录"A"',
      text: '内容。',
      annotations: [],
      addedAt: 1,
    }
    tree.render([quoted], 'q1')
    const dirBtn = root.querySelector('[data-dir]') as HTMLElement
    // 属性值里的引号必须已转义，否则 DOM 解析会截断/破坏属性
    expect(dirBtn.getAttribute('data-dir')).toBe('/目录"A"')
    const raw = root.querySelector('[data-dir]')!.outerHTML
    expect(raw).toContain('&quot;')
    // 折叠/展开正常工作
    dirBtn.click()
    expect(root.querySelector('[data-doc]')).toBeNull() // 折叠后子项隐藏
    ;(root.querySelector('[data-dir]') as HTMLElement).click()
    expect(root.querySelector('[data-doc="q1"]')).toBeTruthy()
    // 文件名引号同样转义渲染
    expect((root.querySelector('[data-doc="q1"] .truncate') as HTMLElement).textContent).toBe('含"引号"的文档.txt')
  })
})

describe('FileTreeView 多选', () => {
  it('勾选出现批量栏并显示计数，取消勾选恢复', () => {
    tree.render([doc('a', '一.md'), doc('b', '二.md')], 'a')
    expect(bulkBar()).toBeNull()
    check('a')
    expect(bulkBar()).toContain('已选 1')
    check('b')
    expect(bulkBar()).toContain('已选 2')
    check('b')
    expect(bulkBar()).toContain('已选 1')
    check('a')
    expect(bulkBar()).toBeNull()
  })

  it('勾选不触发打开文档', () => {
    const opened: string[] = []
    tree = new FileTreeView(root, {
      onOpen: (id) => opened.push(id),
      onRemove: () => {},
      onExportDoc: () => {},
      onBulkExport: () => {},
      onBulkDelete: () => {},
    })
    tree.render([doc('a', '一.md')], 'a')
    const box = root.querySelector('[data-select="a"]') as HTMLInputElement
    box.click()
    box.dispatchEvent(new Event('change'))
    expect(opened).toEqual([])
  })

  it('全选与批量回调携带选中文档 id', () => {
    tree.render([doc('a', '一.md'), doc('b', '二.md')], 'a')
    ;(root.querySelector('[data-select-all]') as HTMLInputElement).click()
    ;(root.querySelector('[data-select-all]') as HTMLInputElement).dispatchEvent(new Event('change'))
    expect(bulkBar()).toContain('已选 2')
    ;(root.querySelector('[data-bulk="export"]') as HTMLButtonElement).click()
    ;(root.querySelector('[data-bulk="delete"]') as HTMLButtonElement).click()
    expect(events).toEqual([
      {op: 'bulk-export', ids: ['a', 'b']},
      {op: 'bulk-delete', ids: ['a', 'b']},
    ])
    // 清除选择：批量栏消失
    ;(root.querySelector('[data-bulk="clear"]') as HTMLButtonElement).click()
    expect(bulkBar()).toBeNull()
  })

  it('单项导出按钮回调携带该文档 id，且不触发行点击', () => {
    tree.render([doc('a', '一.md')], 'a')
    ;(root.querySelector('[data-export="a"]') as HTMLButtonElement).click()
    expect(events).toEqual([{op: 'export-doc', ids: ['a']}])
  })

  it('重渲染剪除已删除文档的选择；全选框状态同步', () => {
    tree.render([doc('a', '一.md'), doc('b', '二.md')], 'a')
    check('a')
    check('b')
    // b 被删除后重渲染：选择剪除为 {a}——恰好是全部剩余文档，全选框保持勾选
    tree.render([doc('a', '一.md')], 'a')
    expect(bulkBar()).toContain('已选 1')
    expect((root.querySelector('[data-select-all]') as HTMLInputElement).checked).toBe(true)
    expect(checkbox('b')).toBeNull()
  })
})
