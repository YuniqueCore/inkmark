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
