// @vitest-environment happy-dom
/** 回收站弹层：列表渲染、动作派发、空态、Esc 关闭。 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TrashDialog } from '../src/ui/trash-dialog'
import type { Annotation, TrashEntry, TrashedAnnotation } from '../src/core/types'

const ann = (id: string, overrides: Partial<Annotation> = {}): Annotation => ({
  id,
  start: 0,
  end: 3,
  kind: 'suggestion',
  comment: `批注 ${id}`,
  status: 'open',
  source: 'manual',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
})

const entry = (id: string, overrides: Partial<TrashedAnnotation> = {}): TrashedAnnotation => ({
  type: 'annotation',
  annotation: ann(id),
  docId: 'doc-1',
  docName: '文档一',
  deletedAt: 1_000,
  ...overrides,
})

const docEntry = (): TrashEntry => ({
  type: 'doc',
  doc: { id: 'doc-9', name: '被删文档', path: '', text: '正文', annotations: [ann('x1'), ann('x2')], addedAt: 1 },
  deletedAt: 2_000,
})

const NOW = 3_600_000 // 开机 1 小时：距 7 天保留期满还剩约 7 天

let callbacks: { restore: ReturnType<typeof vi.fn>; purge: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }
let dialog: TrashDialog

beforeEach(() => {
  document.body.innerHTML = ''
  callbacks = { restore: vi.fn(), purge: vi.fn(), clear: vi.fn(), close: vi.fn() }
  dialog = new TrashDialog({
    onRestore: callbacks.restore,
    onPurge: callbacks.purge,
    onClearAll: callbacks.clear,
    // 与 main 接线一致：onClose 回调负责真正收起弹层（组件只派发意图）
    onClose: () => {
      callbacks.close()
      dialog.close()
    },
  })
})

describe('TrashDialog', () => {
  it('open 渲染条目：批语、出处、剩余天数徽标', () => {
    dialog.open([entry('a1'), entry('a2', { docName: '文档二' })], NOW)
    const panel = document.body.querySelectorAll('[role="dialog"]')
    expect(panel).toHaveLength(1)
    expect(document.body.textContent).toContain('批注 a1')
    expect(document.body.textContent).toContain('文档二')
    expect(document.body.querySelectorAll('[data-op="restore"]')).toHaveLength(2)
    expect(document.body.querySelectorAll('[data-op="purge"]')).toHaveLength(2)
    expect(document.body.textContent).toContain('7 天后清理')
  })

  it('无批语条目显示占位（不渲染空字符串）', () => {
    dialog.open([entry('a1', { annotation: ann('a1', { comment: '' }) })], NOW)
    expect(document.body.textContent).toContain('（无批语）')
  })

  it('恢复 / 彻底删除按 id 派发回调', () => {
    dialog.open([entry('a1')], NOW)
    ;(document.querySelector('[data-op="restore"]') as HTMLButtonElement).click()
    ;(document.querySelector('[data-op="purge"]') as HTMLButtonElement).click()
    expect(callbacks.restore).toHaveBeenCalledWith(['a1'])
    expect(callbacks.purge).toHaveBeenCalledWith(['a1'])
  })

  it('清空按钮派发回调；空态时禁用且渲染空态文案', () => {
    dialog.open([], NOW)
    const clear = document.querySelector('[data-op="clear-all"]') as HTMLButtonElement
    expect(clear.disabled).toBe(true)
    expect(document.body.textContent).toContain('回收站是空的')
    dialog.update([entry('a1')], NOW)
    ;(document.querySelector('[data-op="clear-all"]') as HTMLButtonElement).click()
    expect(callbacks.clear).toHaveBeenCalled()
  })

  it('文档条目展示类型徽标、批注数与整份找回说明', () => {
    dialog.open([docEntry()], NOW)
    expect(document.body.textContent).toContain('文档')
    expect(document.body.textContent).toContain('被删文档')
    expect(document.body.textContent).toContain('2 条批注')
    expect(document.body.textContent).toContain('批注一并找回')
  })

  it('混排按删除时间倒序，头部计数区分文档与批注', () => {
    dialog.open([entry('a1'), docEntry()], NOW)
    const keys = Array.from(document.body.querySelectorAll('[data-entry]')).map((el) => el.getAttribute('data-entry'))
    expect(keys).toEqual(['doc-9', 'a1'])
    expect(document.body.textContent).toContain('1 文档')
    expect(document.body.textContent).toContain('1 批注')
  })

  it('失锚与已解决徽标照常展示', () => {
    dialog.open([entry('a1', { annotation: ann('a1', { anchorLost: true, status: 'resolved' }) })], NOW)
    expect(document.body.textContent).toContain('失锚')
    expect(document.body.textContent).toContain('已解决')
  })

  it('关闭按钮与 update 刷新', () => {
    dialog.open([entry('a1')], NOW)
    ;(document.querySelector('[data-op="close"]') as HTMLButtonElement).click()
    expect(callbacks.close).toHaveBeenCalled()
    expect(dialog.isOpen).toBe(false)
    dialog.update([entry('a2')], NOW) // 弹层未开时 update 是安全空操作
    expect(dialog.isOpen).toBe(false)
  })
})

describe('TrashDialog · 搜索与批量', () => {
  const openThree = (): void => {
    dialog.open(
      [
        entry('a1'), // 批语含 "批注 a1"，出处 文档一
        entry('a2', { annotation: ann('a2', { kind: 'question', comment: '依据是什么？' }) }),
        entry('a3', { docName: '会议记录', annotation: ann('a3', { comment: '金句摘录待跟进' }) }),
      ],
      NOW,
    )
  }

  it('搜索按批语/出处/类型过滤，无结果显示空态', () => {
    openThree()
    const input = document.querySelector('[data-role="search"]') as HTMLInputElement
    input.value = '会议'
    input.dispatchEvent(new Event('input'))
    expect(document.body.querySelectorAll('[data-entry]')).toHaveLength(1)
    expect(document.body.textContent).toContain('会议记录')

    input.value = '不存在的词'
    input.dispatchEvent(new Event('input'))
    expect(document.body.querySelectorAll('[data-entry]')).toHaveLength(0)
    expect(document.body.textContent).toContain('没有匹配')

    input.value = '疑问'
    input.dispatchEvent(new Event('input'))
    expect(document.body.querySelectorAll('[data-entry]')).toHaveLength(1)
  })

  it('清除搜索按钮与 Esc：有词先清词不清空列表，词为空后 Esc 走关闭回调', () => {
    openThree()
    const input = document.querySelector('[data-role="search"]') as HTMLInputElement
    input.value = '会议'
    input.dispatchEvent(new Event('input'))
    ;(document.querySelector('[data-op="clear-search"]') as HTMLButtonElement).click()
    expect(input.value).toBe('')
    expect(document.body.querySelectorAll('[data-entry]')).toHaveLength(3)

    input.value = '会议'
    input.dispatchEvent(new Event('input'))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(input.value).toBe('')
    expect(callbacks.close).not.toHaveBeenCalled()
  })

  it('全选仅作用于当前筛选结果；批量恢复按选中 key 派发', () => {
    openThree()
    const input = document.querySelector('[data-role="search"]') as HTMLInputElement
    input.value = '会议'
    input.dispatchEvent(new Event('input'))
    ;(document.querySelector('[data-select-all]') as HTMLInputElement).click()
    ;(document.querySelector('[data-bulk-op="restore"]') as HTMLButtonElement).click()
    expect(callbacks.restore).toHaveBeenCalledWith(['a3'])
  })

  it('逐条勾选进批量条，批量彻底删除派发全部选中 key', () => {
    openThree()
    const box = (k: string): HTMLInputElement => document.querySelector(`[data-select-key="${k}"]`) as HTMLInputElement
    box('a1').click()
    box('a2').click()
    expect(document.body.textContent).toContain('已选 2 项')
    ;(document.querySelector('[data-bulk-op="purge"]') as HTMLButtonElement).click()
    expect(callbacks.purge).toHaveBeenCalledWith(['a1', 'a2'])
  })

  it('update 后剪除已消失的选中项，剩余选中仍可批量操作', () => {
    openThree()
    ;(document.querySelector('[data-select-key="a1"]') as HTMLInputElement).click()
    ;(document.querySelector('[data-select-key="a2"]') as HTMLInputElement).click()
    dialog.update([entry('a2'), entry('a3')], NOW) // a1 已被恢复
    expect(document.body.textContent).toContain('已选 1 项')
    ;(document.querySelector('[data-bulk-op="purge"]') as HTMLButtonElement).click()
    expect(callbacks.purge).toHaveBeenCalledWith(['a2'])
  })
})
