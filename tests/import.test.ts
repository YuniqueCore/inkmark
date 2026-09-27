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

const file = (name: string, content: string): File =>
  new File([content], name, { type: 'text/plain' })

describe('importFileList · 文本文件', () => {
  it('txt/md 构建新文档；路径取自 webkitRelativePath；json 与未知扩展跳过', async () => {
    const root = file('a.txt', '第一份内容。')
    Object.defineProperty(root, 'webkitRelativePath', { value: 'docs/sub/a.txt' })
    const r = await importFileList(
      [root, file('b.md', '第二份。'), file('c.json', '{}'), file('d.pdf', '二进制')],
      doc(),
    )
    expect(r.textDocs).toHaveLength(2)
    expect(r.textDocs[0]).toMatchObject({ name: 'a.txt', path: 'docs/sub', text: '第一份内容。', annotations: [] })
    expect(r.textDocs[1]).toMatchObject({ name: 'b.md', path: '' })
    expect(r.skipped).toBe(2)
  })

  it('空内容跳过；超限文本截断并计数', async () => {
    const huge = file('huge.txt', 'x'.repeat(400_001))
    const r = await importFileList([huge, file('empty.txt', '   ')], doc())
    expect(r.truncated).toBe(1)
    expect(r.skipped).toBe(1)
    expect(r.textDocs[0]!.text).toHaveLength(400_000)
  })
})

describe('importFileList · 会话与 W3C JSON', () => {
  it('version 2 会话 JSON → sessionDocs；坏 JSON 跳过', async () => {
    const session = file('s.json', JSON.stringify({ version: 2, docs: [doc()], activeDocId: 'doc-cur', savedAt: 1 }))
    const broken = file('bad.json', '{not json')
    const r = await importFileList([session, broken], doc())
    expect(r.sessionDocs).toHaveLength(1)
    expect(r.sessionDocs[0]!.name).toBe('current.md')
    expect(r.skipped).toBe(1)
  })

  it('W3C JSON 且锚得上当前文档 → w3cAnnotations；无当前文档则跳过', async () => {
    const target = doc()
    target.annotations = [{
      id: 'w1', start: 0, end: 4, kind: 'issue', comment: '问题',
      status: 'open', source: 'manual', createdAt: 1, updatedAt: 1,
    }]
    const w3cFile = file('a.json', JSON.stringify(toW3C(target)))
    const withDoc = await importFileList([w3cFile], target)
    expect(withDoc.w3cAnnotations).toHaveLength(1)
    expect(withDoc.w3cAnnotations[0]!.start).toBe(0)
    const withoutDoc = await importFileList([file('a.json', JSON.stringify(toW3C(target)))], undefined)
    expect(withoutDoc.w3cAnnotations).toHaveLength(0)
    expect(withoutDoc.skipped).toBe(1)
  })

  it('W3C 引文锚不上当前文档 → 0 条且计入跳过', async () => {
    const other = doc()
    other.text = '完全不同的另一篇文章。'
    other.annotations = [{
      id: 'w1', start: 0, end: 4, kind: 'issue', comment: '问题',
      status: 'open', source: 'manual', createdAt: 1, updatedAt: 1,
    }]
    const r = await importFileList([file('a.json', JSON.stringify(toW3C(other)))], doc())
    expect(r.w3cFiles).toBe(1) // 合法 W3C 文件，只是条目锚不上
    expect(r.w3cAnnotations).toHaveLength(0)
    expect(r.w3cUnmatched).toBe(1)
    expect(r.skipped).toBe(0)
  })
})
