/** 文件导入管线测试：分类（文本 / 会话 / W3C）、截断、跳过与聚合结果。
 * 管线为纯数据函数——给定文件列表与当前文档，断言聚合结果，不触 DOM 与状态。
 */

import { describe, expect, it } from 'vitest'
import { importFileList } from '../src/core/import'
import { toW3C } from '../src/core/w3c'
import type { DocItem } from '../src/core/types'

const doc = (): DocItem => ({
  id: 'doc-cur',
  name: 'current.md',
  path: '',
  text: '当前文档的正文内容。',
  annotations: [],
  addedAt: 1,
})

const docWithAnn = (id: string, text: string): DocItem => ({
  ...doc(),
  id,
  text,
  annotations: [{
    id: 'w1', start: 0, end: 4, kind: 'issue', comment: '问题',
    status: 'open', source: 'manual', createdAt: 1, updatedAt: 1,
  }],
})

const file = (name: string, content: string): File =>
  new File([content], name, { type: 'text/plain' })

describe('importFileList · 文本文件', () => {
  it('txt/md 构建新文档；路径取自 webkitRelativePath；json 与未知扩展跳过', async () => {
    const root = file('a.txt', '第一份内容。')
    Object.defineProperty(root, 'webkitRelativePath', { value: 'docs/sub/a.txt' })
    const r = await importFileList(
      [root, file('b.md', '第二份。'), file('c.json', '{}'), file('d.pdf', '二进制')],
      { docs: [doc()], currentDoc: doc() },
    )
    expect(r.textDocs).toHaveLength(2)
    expect(r.textDocs[0]).toMatchObject({ name: 'a.txt', path: 'docs/sub', text: '第一份内容。', annotations: [] })
    expect(r.textDocs[1]).toMatchObject({ name: 'b.md', path: '' })
    expect(r.skipped).toBe(2)
  })

  it('空内容跳过；超限文本截断并计数', async () => {
    const huge = file('huge.txt', 'x'.repeat(400_001))
    const r = await importFileList([huge, file('empty.txt', '   ')], { docs: [doc()], currentDoc: doc() })
    expect(r.truncated).toBe(1)
    expect(r.skipped).toBe(1)
    expect(r.textDocs[0]!.text).toHaveLength(400_000)
  })
})

describe('importFileList · 会话与 W3C JSON', () => {
  it('version 2 会话 JSON → sessionDocs；坏 JSON 跳过', async () => {
    const session = file('s.json', JSON.stringify({ version: 2, docs: [doc()], activeDocId: 'doc-cur', savedAt: 1 }))
    const broken = file('bad.json', '{not json')
    const r = await importFileList([session, broken], { docs: [doc()], currentDoc: doc() })
    expect(r.sessionDocs).toHaveLength(1)
    expect(r.sessionDocs[0]!.name).toBe('current.md')
    expect(r.skipped).toBe(1)
  })

  it('多文档导出的合并数组：条目按 source 分发回各自文档重锚', async () => {
    const docWith = (id: string, name: string, text: string): DocItem => ({
      id, name, path: '', text,
      annotations: [{
        id: 'w1', start: 0, end: 4, kind: 'issue', comment: `${name} 的问题`,
        status: 'open', source: 'manual', createdAt: 1, updatedAt: 1,
      }],
      addedAt: 1,
    })
    const a = docWith('doc-a', 'A.md', '甲文档的正文。')
    const b = docWith('doc-b', 'B.md', '乙文档的正文。')
    const combined = JSON.stringify([...toW3C(a), ...toW3C(b)])
    const r = await importFileList([file('mix.json', combined)], { docs: [a, b], currentDoc: a })
    expect(r.w3cFiles).toBe(1)
    expect(r.w3cRouted).toHaveLength(2)
    const ga = r.w3cRouted.find((g) => g.docId === 'doc-a')!
    const gb = r.w3cRouted.find((g) => g.docId === 'doc-b')!
    expect(ga.annotations[0]!.comment).toBe('A.md 的问题')
    expect(gb.annotations[0]!.comment).toBe('B.md 的问题')
    expect(ga.unmatched).toBe(0)
    expect(gb.unmatched).toBe(0)
  })

  it('来源文档不在工作区 → 回落当前文档重锚', async () => {
    const cur = docWithAnn('doc-cur', '当前文档的正文内容。')
    const gone = docWithAnn('doc-gone', cur.text) // 引文与当前文档一致，回落可锚上
    const items = JSON.parse(JSON.stringify(toW3C(gone))) as Array<{
      target: { source: string }
    }>
    for (const it of items) it.target.source = 'urn:inkmark:doc:doc-gone'
    const r = await importFileList([file('x.json', JSON.stringify(items))], { docs: [cur], currentDoc: cur })
    const fallback = r.w3cRouted.find((g) => g.docId === null)!
    expect(fallback.annotations).toHaveLength(1)
  })

  it('无当前文档且来源未知 → 计入未匹配', async () => {
    const r = await importFileList([file('x.json', JSON.stringify(toW3C(docWithAnn('doc-cur', 'x'))))], {
      docs: [],
      currentDoc: undefined,
    })
    expect(r.w3cFiles).toBe(1)
    expect(r.w3cRouted[0]!.annotations).toHaveLength(0)
    expect(r.w3cRouted[0]!.unmatched).toBe(1)
  })

  it('引文锚不上目标文档 → 该组 unmatched 计数，skipped 不变', async () => {
    const other = docWithAnn('doc-x', '完全不同的另一篇文章。')
    const r = await importFileList([file('x.json', JSON.stringify(toW3C(other)))], { docs: [doc()], currentDoc: doc() })
    // doc-x 不在工作区 → 回落当前文档；引文对不上 → unmatched
    expect(r.w3cRouted[0]!.docId).toBeNull()
    expect(r.w3cRouted[0]!.annotations).toHaveLength(0)
    expect(r.w3cRouted[0]!.unmatched).toBe(1)
    expect(r.skipped).toBe(0)
  })
})
