/** 会话迁移：v1 → v3、v2 → v3、v3 直通、非法输入拒绝。 */

import { describe, expect, it } from 'vitest'
import { parseWorkspace } from '../src/core/session'
import { SESSION_VERSION } from '../src/core/types'

const v1 = {
  version: 1,
  text: '第一行\n第二行',
  annotations: [
    { id: 'a1', start: 0, end: 3, kind: 'highlight', comment: '', status: 'open', source: 'manual', createdAt: 1, updatedAt: 1 },
  ],
  savedAt: 42,
}

const v2 = {
  version: 2,
  docs: [
    { id: 'doc-1', name: '文档', path: '', text: '正文', annotations: [], addedAt: 7 },
  ],
  activeDocId: 'doc-1',
  savedAt: 7,
}

describe('parseWorkspace', () => {
  it('v3 直通：docs 与 trash 齐全', () => {
    const ws = { ...v2, version: SESSION_VERSION, trash: [] }
    const parsed = parseWorkspace(JSON.stringify(ws))
    expect(parsed).not.toBeNull()
    expect(parsed!.version).toBe(SESSION_VERSION)
    expect(parsed!.trash).toEqual([])
  })

  it('v2 → v3：补空回收站', () => {
    const parsed = parseWorkspace(JSON.stringify(v2))
    expect(parsed).not.toBeNull()
    expect(parsed!.version).toBe(SESSION_VERSION)
    expect(parsed!.trash).toEqual([])
    expect(parsed!.docs).toHaveLength(1)
    expect(parsed!.activeDocId).toBe('doc-1')
  })

  it('v1 → v3：单文档迁移并补空回收站', () => {
    const parsed = parseWorkspace(JSON.stringify(v1))
    expect(parsed).not.toBeNull()
    expect(parsed!.version).toBe(SESSION_VERSION)
    expect(parsed!.trash).toEqual([])
    expect(parsed!.docs).toHaveLength(1)
    expect(parsed!.docs[0]!.text).toBe('第一行\n第二行')
    expect(parsed!.docs[0]!.annotations[0]!.id).toBe('a1')
  })

  it('非法输入返回 null', () => {
    expect(parseWorkspace('not json')).toBeNull()
    expect(parseWorkspace(JSON.stringify({ version: 2, docs: 'nope' }))).toBeNull()
    expect(parseWorkspace(JSON.stringify({ version: 99, docs: [] }))).toBeNull()
  })
})
