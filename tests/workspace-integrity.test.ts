import { targetIdentity } from '../src/core/image'
import { describe, expect, it } from 'vitest'
import { buildBatchAnnotations } from '../src/core/batch'
import { prepareSessionDocs } from '../src/core/import'
import { reanchorAnnotations } from '../src/core/reanchor'
import { parseWorkspace } from '../src/core/session'
import { entryKey, purgeForever, restoreFromTrash } from '../src/core/trash'
import { fromW3C, toW3C } from '../src/core/w3c'
import type { Annotation, DocItem, TrashEntry } from '../src/core/types'

const ann = (id: string, overrides: Partial<Annotation> = {}): Annotation => ({
  id, start: 2, end: 3, kind: 'suggestion', comment: '保留这个批注', status: 'open',
  source: 'manual', createdAt: 1, updatedAt: 1, ...overrides,
})
const doc = (id = 'doc-a'): DocItem => ({
  id, name: '文档.md', path: '', text: '🙂A 原文', revised: '改稿内容', annotations: [ann('a')], addedAt: 1,
})

describe('工作区跨边界的数据契约', () => {
  it('原文改变只重锚原文批注，改稿侧坐标和状态不变', () => {
    const revised = ann('b', {target: 'revised', start: 0, end: 2})
    const result = reanchorAnnotations('🙂A 原文', '新增 🙂A 原文', [ann('a'), revised])
    expect(result.annotations[0]!.start).toBeGreaterThan(2)
    expect(result.annotations[1]).toEqual(revised)
  })

  it('W3C 边界在 Unicode code point 与内部 UTF-16 偏移之间往返', () => {
    const original = doc()
    const exported = toW3C(original)[0]!
    expect(exported.target.selector[1]).toMatchObject({start: 1, end: 2})
    expect(fromW3C([exported], original.text).annotations[0]).toMatchObject({start: 2, end: 3})
  })

  it('拒绝危险 ID、非法时间戳、越界、重复身份，避免不可信会话进入 UI', () => {
    const workspace = (d: DocItem) => JSON.stringify({version: 3, docs: [d], activeDocId: d.id, trash: [], savedAt: 1})
    expect(parseWorkspace(workspace(doc()))).not.toBeNull()
    expect(parseWorkspace(workspace({...doc(), id: 'x" onmouseover="alert(1)'}))).toBeNull()
    expect(parseWorkspace(workspace({...doc(), annotations: [ann('a', {createdAt: 1e30})]}))).toBeNull()
    expect(parseWorkspace(workspace({...doc(), annotations: [ann('a', {end: 100})]}))).toBeNull()
    expect(parseWorkspace(workspace({...doc(), annotations: [ann('a'), ann('a')]}))).toBeNull()
  })

  it('不可信 W3C 字段不会注入 ID 或让同批有效批注崩溃；重复导入有稳定身份', () => {
    const malicious = {
      id: 'https://example.test/#ann=x" onmouseover="alert(1)', motivation: {toString: null},
      body: [null, {purpose: 'tagging', value: {toString: null}}, {purpose: 'describing', value: '真实意见'}],
      target: {selector: [{type: 'TextQuoteSelector', exact: 'A', prefix: '🙂', suffix: ' 原文'}, {type: 'TextPositionSelector', start: 1, end: 2}]},
    }
    const first = fromW3C([malicious], doc().text, {now: 1, identityScope: 'doc-a'})
    const again = fromW3C([malicious], doc().text, {now: 2, identityScope: 'doc-a'})
    const otherDoc = fromW3C([malicious], doc().text, {now: 1, identityScope: 'doc-b'})
    expect(first.annotations[0]).toMatchObject({kind: 'highlight', comment: '真实意见'})
    expect(first.annotations[0]!.id).toMatch(/^w3c-[a-f0-9]+$/)
    expect(again.annotations[0]!.id).toBe(first.annotations[0]!.id)
    expect(otherDoc.annotations[0]!.id).not.toBe(first.annotations[0]!.id)
  })

  it('同名会话合并和回收站恢复保留双方内容，ID 与类型键互不混淆', () => {
    const existing = doc()
    const imported = prepareSessionDocs([doc()], [existing], [])
    expect(imported[0]!.id).not.toBe(existing.id)
    expect(imported[0]!.name).toBe('文档-1.md')
    expect(imported[0]!.annotations[0]!.id).not.toBe(existing.annotations[0]!.id)

    const trashedDoc: TrashEntry = {type: 'doc', doc: {...doc('same'), annotations: []}, deletedAt: 1}
    const trashedAnn: TrashEntry = {type: 'annotation', targetIdentity: targetIdentity(existing, ann('same'))! , annotation: ann('same'), docId: existing.id, docName: existing.name, deletedAt: 1}
    expect(purgeForever([trashedDoc, trashedAnn], new Set([entryKey(trashedDoc)]))).toEqual([trashedAnn])
    const restored = restoreFromTrash([trashedAnn], [{...existing, annotations: [ann('same')]}], new Set([entryKey(trashedAnn)]))
    expect(restored.docs[0]!.annotations.map((a) => a.id)).toEqual(['same', 'same-1'])
  })

  it('跨文档同一时刻的批量批注也各自拥有独立 ID', () => {
    const args = [{start: 0, end: 2}]
    const first = buildBatchAnnotations(args, {kind: 'suggestion', comment: '意见'}, 42)
    const second = buildBatchAnnotations(args, {kind: 'suggestion', comment: '意见'}, 42)
    expect(first[0]!.id).not.toBe(second[0]!.id)
  })
})
