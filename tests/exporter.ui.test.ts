// @vitest-environment happy-dom
/** UI 层回归测试：导出弹层的可见性生命周期。
 * 回归背景：render() 曾整写 modal.className（含 hidden），切 tab 会把弹层藏掉。
 * 断言锚点：hidden 类的显隐只归 open()/close() 管，任何重绘不得带回 hidden。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExporterView } from '../src/ui/exporter'
import type { Annotation, DocItem } from '../src/core/types'

const ann = (
  id: string,
  start: number,
  end: number,
  kind: Annotation['kind'] = 'issue',
  status: Annotation['status'] = 'open',
): Annotation => ({
  id,
  start,
  end,
  kind,
  comment: `批注 ${id}`,
  status,
  source: 'manual',
  createdAt: 1,
  updatedAt: 1,
})

const doc = (): DocItem => ({
  id: 'doc-ui',
  name: 'UI 测试文档',
  path: '',
  text: '第一行内容。\n第二行内容。',
  annotations: [ann('a1', 0, 5), ann('a2', 7, 13, 'praise'), ann('a3', 8, 13, 'highlight', 'resolved')],
  addedAt: 1,
})

let modal: HTMLElement
let overlay: HTMLElement
let exporter: ExporterView

beforeEach(() => {
  document.body.innerHTML = ''
  modal = document.createElement('div')
  modal.className = 'hidden'
  overlay = document.createElement('div')
  overlay.className = 'hidden'
  document.body.append(overlay, modal)
  exporter = new ExporterView(modal, overlay, {
    onCopy: () => {},
    onClose: () => {},
    onImportW3C: () => {},
  })
})

const isOpen = () => !modal.classList.contains('hidden')

describe('ExporterView 可见性生命周期', () => {
  it('open 显示弹层，close 隐藏，可再次打开', () => {
    exporter.open([doc()])
    expect(isOpen()).toBe(true)
    expect(overlay.classList.contains('hidden')).toBe(false)
    exporter.close()
    expect(isOpen()).toBe(false)
    expect(overlay.classList.contains('hidden')).toBe(true)
    exporter.open([doc()])
    expect(isOpen()).toBe(true)
  })

  it('回归：切换每个 tab 后弹层保持可见（不得带回 hidden）', () => {
    exporter.open([doc()])
    for (const tab of ['inline', 'snippets', 'review', 'w3c']) {
      const btn = modal.querySelector<HTMLButtonElement>(`[data-tab="${tab}"]`)!
      expect(btn, `tab 按钮 ${tab} 应存在`).toBeTruthy()
      btn.click()
      expect(isOpen(), `切到 ${tab} 后弹层应保持可见`).toBe(true)
      const preview = modal.querySelector<HTMLTextAreaElement>('#export-preview')!
      expect(preview.value.length).toBeGreaterThan(0)
    }
  })

  it('回归：切换「包含已解决」后弹层保持可见且内容更新', () => {
    exporter.open([doc()])
    const before = (modal.querySelector('#export-preview') as HTMLTextAreaElement).value
    const inc = modal.querySelector<HTMLInputElement>('#inc-resolved')!
    inc.click()
    expect(isOpen()).toBe(true)
    const after = (modal.querySelector('#export-preview') as HTMLTextAreaElement).value
    expect(after.length).toBeGreaterThan(before.length) // 已解决批注被纳入
  })

  it('「包含文件信息」开关：勾选后预览顶部标注文件名，取消后消失；W3C 页不提供该开关', () => {
    exporter.open([doc()])
    const preview = () => (modal.querySelector('#export-preview') as HTMLTextAreaElement).value
    expect(modal.querySelector('#inc-file-info')).toBeTruthy()
    expect(preview()).not.toContain('文件：')
    ;(modal.querySelector('#inc-file-info') as HTMLInputElement).click()
    ;(modal.querySelector('#inc-file-info') as HTMLInputElement).dispatchEvent(new Event('change'))
    expect(preview().startsWith('文件：UI 测试文档')).toBe(true)
    ;(modal.querySelector('#inc-file-info') as HTMLInputElement).click()
    ;(modal.querySelector('#inc-file-info') as HTMLInputElement).dispatchEvent(new Event('change'))
    expect(preview()).not.toContain('文件：')
    // 切到 W3C 页：交换格式不带自定义字段，开关隐藏
    ;(modal.querySelector('[data-tab="w3c"]') as HTMLButtonElement).click()
    expect(modal.querySelector('#inc-file-info')).toBeNull()
    expect(modal.querySelector('#inc-resolved')).toBeTruthy()
  })

  it('W3C 页存在导入入口与下载按钮，内容为合法 JSON', () => {
    exporter.open([doc()])
    ;(modal.querySelector('[data-tab="w3c"]') as HTMLButtonElement).click()
    expect(isOpen()).toBe(true)
    expect(modal.querySelector('[data-op="import"]')).toBeTruthy()
    const parsed = JSON.parse((modal.querySelector('#export-preview') as HTMLTextAreaElement).value)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed[0]['@context']).toBe('http://www.w3.org/ns/anno.jsonld')
  })
})

describe('ExporterView 多文档导出', () => {
  const secondDoc = (): DocItem => ({
    id: 'doc-ui-2',
    name: '第二章.md',
    path: '',
    text: '第二份文档的内容。',
    annotations: [ann('b1', 0, 5)],
    addedAt: 1,
  })

  it('多文档预览按文件分节，节首强制文件行，开关隐藏', () => {
    exporter.open([doc(), secondDoc()])
    expect(isOpen()).toBe(true)
    const preview = () => (modal.querySelector('#export-preview') as HTMLTextAreaElement).value
    expect(modal.querySelector('#inc-file-info')).toBeNull() // 合并输出强制文件行
    expect(preview()).toContain('文件：UI 测试文档')
    expect(preview()).toContain('文件：第二章.md')
    expect(preview()).toContain('\n\n---\n\n')
    expect(preview()).toContain('批注 a1')
  })

  it('多文档 W3C 合并为数组，target.source 保留来源文档', () => {
    exporter.open([doc(), secondDoc()])
    ;(modal.querySelector('[data-tab="w3c"]') as HTMLButtonElement).click()
    const parsed = JSON.parse((modal.querySelector('#export-preview') as HTMLTextAreaElement).value)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.length).toBe(3) // doc() 2 条 open + secondDoc 1 条（resolved 默认排除）
    const sources = new Set(parsed.map((x: {target: {source: string}}) => x.target.source))
    expect(sources.has('urn:inkmark:doc:doc-ui')).toBe(true)
    expect(sources.has('urn:inkmark:doc:doc-ui-2')).toBe(true)
  })

  it('多文档下载打包为 zip（每份文档一个文件）', async () => {
    exporter.open([doc(), secondDoc()])
    const created: Blob[] = []
    const spy = vi.spyOn(URL, 'createObjectURL').mockImplementation(((b: Blob) => {
      created.push(b)
      return 'blob:mock'
    }) as typeof URL.createObjectURL)
    ;(modal.querySelector('[data-op="download"]') as HTMLButtonElement).click()
    expect(created).toHaveLength(1)
    expect(created[0]!.type).toBe('application/zip')
    expect(created[0]!.size).toBeGreaterThan(0)
    // zip 头部魔数 PK
    const head = new Uint8Array(await created[0]!.arrayBuffer()).slice(0, 2)
    expect(String.fromCharCode(head[0]!, head[1]!)).toBe('PK')
    spy.mockRestore()
  })

  it('多文档复制走合并文本（copy 回调收到完整预览）', () => {
    const seen: string[] = []
    const exporter2 = new ExporterView(modal, overlay, {
      onCopy: (c) => seen.push(c),
      onClose: () => {},
      onImportW3C: () => {},
    })
    exporter2.open([doc(), secondDoc()])
    ;(modal.querySelector('[data-op="copy"]') as HTMLButtonElement).click()
    expect(seen[0]).toContain('文件：UI 测试文档')
    expect(seen[0]).toContain('文件：第二章.md')
  })
})
