/** 回收站纯函数：trashFromDoc / purgeExpired / restoreFromTrash / purgeForever。 */

import { describe, expect, it } from 'vitest'
import {
  entryKey,
  purgeExpired,
  purgeForever,
  restoreFromTrash,
  TRASH_RETENTION_MS,
  trashDocs,
  trashFromDoc,
} from '../src/core/trash'
import type { Annotation, DocItem, TrashEntry, TrashedAnnotation } from '../src/core/types'

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

const doc = (): DocItem => ({
  id: 'doc-1',
  name: '文档一',
  path: '',
  text: '正文内容',
  annotations: [ann('a1'), ann('a2'), ann('a3')],
  addedAt: 1,
})

describe('trashFromDoc', () => {
  it('移除指定批注并包装回收站条目（保持原顺序）', () => {
    const d = doc()
    const { doc: next, trashed } = trashFromDoc(d, new Set(['a1', 'a3']), 1000)
    expect(next.annotations.map((a) => a.id)).toEqual(['a2'])
    expect(trashed.map((t) => t.annotation.id)).toEqual(['a1', 'a3'])
    expect(trashed[0]).toMatchObject({ docId: 'doc-1', docName: '文档一', deletedAt: 1000 })
  })

  it('原 doc 不可变： annotations 是新数组，其余字段沿用', () => {
    const d = doc()
    const { doc: next } = trashFromDoc(d, new Set(['a1']), 1)
    expect(next).not.toBe(d)
    expect(next.annotations[0]).toBe(d.annotations[1])
    expect(next.text).toBe(d.text)
  })

  it('目标 id 都不存在时返回等价文档与空回收站', () => {
    const { doc: next, trashed } = trashFromDoc(doc(), new Set(['missing']), 1)
    expect(next.annotations).toHaveLength(3)
    expect(trashed).toEqual([])
  })
})

describe('purgeExpired', () => {
  const entry = (id: string, deletedAt: number): TrashedAnnotation => ({
    type: 'annotation',
    annotation: ann(id),
    docId: 'doc-1',
    docName: '文档一',
    deletedAt,
  })

  it('达到 7 天整即判过期（now - deletedAt >= retention）', () => {
    const now = 10_000
    const trash = [entry('fresh', now - TRASH_RETENTION_MS + 1), entry('stale', now - TRASH_RETENTION_MS)]
    const { keep, purged } = purgeExpired(trash, now)
    expect(keep.map(entryKey)).toEqual(['fresh'])
    expect(purged.map(entryKey)).toEqual(['stale'])
  })

  it('自定义保留期用于测试', () => {
    const { keep, purged } = purgeExpired([entry('a', 0), entry('b', 500)], 1000, 1000)
    expect(purged.map(entryKey)).toEqual(['a'])
    expect(keep.map(entryKey)).toEqual(['b'])
  })
})

describe('restoreFromTrash', () => {
  const trashed = (id: string, docId = 'doc-1'): TrashedAnnotation => ({
    type: 'annotation',
    annotation: ann(id),
    docId,
    docName: docId,
    deletedAt: 1,
  })

  it('按 docId 追加回原文档并从回收站移除', () => {
    // a1/a2 已从文档删除（真实流程），文档只剩 a3
    const docs: DocItem[] = [{ ...doc(), annotations: [ann('a3')] }]
    const r = restoreFromTrash([trashed('a1'), trashed('a2')], docs, new Set(['a1', 'a2']))
    expect(r.restored).toBe(2)
    expect(r.stranded).toBe(0)
    expect(r.trash).toEqual([])
    expect(r.docs[0]!.annotations.map((a) => a.id)).toEqual(['a3', 'a1', 'a2'])
  })

  it('原文档已删除的条目留在回收站（stranded），其余照常恢复', () => {
    const docs: DocItem[] = [{ ...doc(), annotations: [ann('a3')] }]
    const r = restoreFromTrash(
      [trashed('a1', 'doc-1'), trashed('a9', 'doc-gone')],
      docs,
      new Set(['a1', 'a9']),
    )
    expect(r.restored).toBe(1)
    expect(r.stranded).toBe(1)
    expect(r.trash.map(entryKey)).toEqual(['a9'])
    expect(r.docs[0]!.annotations.map((a) => a.id)).toEqual(['a3', 'a1'])
  })

  it('恢复只动目标文档，其他文档引用不变', () => {
    const docs = [doc(), { ...doc(), id: 'doc-2', name: '文档二' }]
    const r = restoreFromTrash([trashed('a1')], docs, new Set(['a1']))
    expect(r.docs[1]).toBe(docs[1])
  })

  it('空命中：原样返回', () => {
    const trash = [trashed('a1')]
    const docs = [doc()]
    const r = restoreFromTrash(trash, docs, new Set(['nope']))
    expect(r).toEqual({ trash, docs, restored: 0, stranded: 0 })
  })
})

describe('purgeForever', () => {
  it('彻底删除指定条目', () => {
    const trash: TrashedAnnotation[] = [
      { type: 'annotation', annotation: ann('a1'), docId: 'doc-1', docName: 'x', deletedAt: 1 },
      { type: 'annotation', annotation: ann('a2'), docId: 'doc-1', docName: 'x', deletedAt: 1 },
    ]
    const trashDoc: TrashEntry = { type: 'doc', doc: doc(), deletedAt: 1 }
    expect(purgeForever([...trash, trashDoc], new Set([entryKey(trashDoc)]))).toEqual(trash)
    expect(purgeForever(trash, new Set(['a1'])).map(entryKey)).toEqual(['a2'])
  })
})

describe('trashDocs', () => {
  it('整文档移除并入站，条目携带完整 DocItem', () => {
    const docs = [doc(), { ...doc(), id: 'doc-2', name: '文档二' }]
    const { docs: next, trashed } = trashDocs(docs, new Set(['doc-2']), 500)
    expect(next.map((d) => d.id)).toEqual(['doc-1'])
    expect(trashed).toEqual([{ type: 'doc', doc: docs[1], deletedAt: 500 }])
  })
})

describe('restoreFromTrash · 文档条目', () => {
  it('文档条目整份回 docs（含批注），并从回收站移除', () => {
    const trashedDoc: TrashEntry = { type: 'doc', doc: doc(), deletedAt: 1 }
    const r = restoreFromTrash([trashedDoc], [], new Set([entryKey(trashedDoc)]))
    expect(r.restored).toBe(1)
    expect(r.stranded).toBe(0)
    expect(r.trash).toEqual([])
    expect(r.docs.map((d) => d.id)).toEqual(['doc-1'])
    expect(r.docs[0]!.annotations).toHaveLength(3)
  })

  it('批注条目与文档条目可同批恢复：文档先回位，批注落回原文档', () => {
    // 场景：先删了 a1（doc-1 还在），再删了 doc-2；一次恢复两者
    const docs: DocItem[] = [{ ...doc(), annotations: [ann('a2'), ann('a3')] }]
    const entries: TrashEntry[] = [
      { type: 'annotation', annotation: ann('a1'), docId: 'doc-1', docName: '文档一', deletedAt: 1 },
      { type: 'doc', doc: { ...doc(), id: 'doc-2', name: '文档二' }, deletedAt: 2 },
    ]
    const r = restoreFromTrash(entries, docs, new Set(['a1', 'doc-2']))
    expect(r.restored).toBe(2)
    expect(r.stranded).toBe(0)
    expect(r.trash).toEqual([])
    expect(r.docs.map((d) => d.id)).toEqual(['doc-1', 'doc-2'])
    expect(r.docs[0]!.annotations.map((a) => a.id)).toEqual(['a2', 'a3', 'a1'])
  })

  it('entryKey：批注条目取批注 id，文档条目取文档 id', () => {
    expect(entryKey({ type: 'annotation', annotation: ann('a1'), docId: 'd', docName: 'n', deletedAt: 0 })).toBe('a1')
    expect(entryKey({ type: 'doc', doc: doc(), deletedAt: 0 })).toBe('doc-1')
  })
})
