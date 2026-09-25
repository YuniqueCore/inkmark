// @vitest-environment happy-dom
/** UI 层回归测试：导出弹层的可见性生命周期。
 * 回归背景：render() 曾整写 modal.className（含 hidden），切 tab 会把弹层藏掉。
 * 断言锚点：hidden 类的显隐只归 open()/close() 管，任何重绘不得带回 hidden。
 */

import { beforeEach, describe, expect, it } from 'vitest'
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
    exporter.open(doc())
    expect(isOpen()).toBe(true)
    expect(overlay.classList.contains('hidden')).toBe(false)
    exporter.close()
    expect(isOpen()).toBe(false)
    expect(overlay.classList.contains('hidden')).toBe(true)
    exporter.open(doc())
    expect(isOpen()).toBe(true)
  })

  it('回归：切换每个 tab 后弹层保持可见（不得带回 hidden）', () => {
    exporter.open(doc())
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
    exporter.open(doc())
    const before = (modal.querySelector('#export-preview') as HTMLTextAreaElement).value
    const inc = modal.querySelector<HTMLInputElement>('#inc-resolved')!
    inc.click()
    expect(isOpen()).toBe(true)
    const after = (modal.querySelector('#export-preview') as HTMLTextAreaElement).value
    expect(after.length).toBeGreaterThan(before.length) // 已解决批注被纳入
  })

  it('W3C 页存在导入入口与下载按钮，内容为合法 JSON', () => {
    exporter.open(doc())
    ;(modal.querySelector('[data-tab="w3c"]') as HTMLButtonElement).click()
    expect(isOpen()).toBe(true)
    expect(modal.querySelector('[data-op="import"]')).toBeTruthy()
    const parsed = JSON.parse((modal.querySelector('#export-preview') as HTMLTextAreaElement).value)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed[0]['@context']).toBe('http://www.w3.org/ns/anno.jsonld')
  })
})
