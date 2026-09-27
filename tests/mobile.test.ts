// @vitest-environment happy-dom
/** 移动端响应式逻辑测试：在不同视口宽度下驱动 main 的抽屉切换。
 * <lg：树/批注栏为覆盖式抽屉（body 的 tree-open / sidebar-open 类，互斥）；
 * ≥lg：保持桌面三栏的 .hidden 切换。背板点击与 Esc 关闭抽屉。
 */

import { beforeAll, describe, expect, it } from 'vitest'

function buildSkeleton(): void {
  document.body.innerHTML = `
    <header>
      <button id="btn-tree"></button>
      <button id="btn-import-files"></button><button id="btn-import-folder"></button>
      <input id="file-input" /><input id="folder-input" />
      <span id="save-status"><span id="save-dot"></span><span id="save-text"></span></span>
      <button id="btn-sample"></button><button id="btn-scan"></button>
      <button id="btn-edit"></button><button id="btn-diff"></button>
      <span id="diff-stats"></span><button id="btn-diff-clear"></button>
      <button id="btn-export"></button><button id="btn-theme"></button>
      <button id="btn-sidebar"></button><button id="btn-clear"></button>
    </header>
    <main id="layout">
      <aside id="filetree"></aside><div id="handle-left" class="resize-handle"></div>
      <section id="editor"></section>
      <div id="handle-right" class="resize-handle"></div>
      <aside id="sidebar"></aside>
    </main>
    <div id="drawer-backdrop" class="hidden"></div>
    <div id="overlay" class="hidden"></div>
    <div id="export-modal" class="hidden"></div>`
}

beforeAll(async () => {
  buildSkeleton()
  await import('../src/main')
})

const setViewport = (width: number): void => {
  ;(window as unknown as { happyDOM: { setViewport: (v: {width: number; height: number}) => void } })
    .happyDOM.setViewport({ width, height: 844 })
}

describe('移动端抽屉（<lg）', () => {
  it('390 视口：文档树抽屉开合，body 类驱动', () => {
    setViewport(390)
    document.querySelector('#btn-tree')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(document.body.classList.contains('tree-open')).toBe(true)
    document.querySelector('#btn-tree')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(document.body.classList.contains('tree-open')).toBe(false)
  })

  it('文档树与批注栏抽屉互斥', () => {
    setViewport(390)
    document.querySelector('#btn-tree')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    document.querySelector('#btn-sidebar')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(document.body.classList.contains('sidebar-open')).toBe(true)
    expect(document.body.classList.contains('tree-open')).toBe(false)
  })

  it('背板点击与 Esc 关闭抽屉', () => {
    setViewport(390)
    document.querySelector('#btn-sidebar')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    document.querySelector('#drawer-backdrop')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(document.body.classList.contains('sidebar-open')).toBe(false)
    document.querySelector('#btn-sidebar')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(document.body.classList.contains('sidebar-open')).toBe(false)
  })
})

describe('桌面三栏（≥lg）', () => {
  it('1280 视口：树切换走 .hidden，抽屉类不出现', () => {
    setViewport(1280)
    const ft = document.querySelector('#filetree') as HTMLElement
    document.querySelector('#btn-tree')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(ft.classList.contains('hidden')).toBe(true)
    expect(document.body.classList.contains('tree-open')).toBe(false)
    document.querySelector('#btn-tree')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(ft.classList.contains('hidden')).toBe(false)
  })

  it('跨断点时抽屉状态被清理', () => {
    setViewport(390)
    document.querySelector('#btn-tree')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(document.body.classList.contains('tree-open')).toBe(true)
    setViewport(1280) // 触发 change 监听 → closeDrawers
    expect(document.body.classList.contains('tree-open')).toBe(false)
  })
})
