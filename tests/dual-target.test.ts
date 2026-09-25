import { describe, expect, it } from 'vitest'
import { exportInline, exportReview, exportSnippets } from '../src/core/export'
import { fromW3C, toW3C } from '../src/core/w3c'
import type { DocItem } from '../src/core/types'

const doc: DocItem = {
  id: 'doc-dt',
  name: '双文档锚定',
  path: '',
  text: '原文第一行。\n原文第二行。',
  revised: '改稿唯一行。',
  annotations: [
    {
      id: 'ann-a',
      start: 0,
      end: 6,
      kind: 'issue',
      comment: '原文侧批注',
      status: 'open',
      source: 'manual',
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 'ann-b',
      start: 0,
      end: 6,
      kind: 'praise',
      comment: '改稿侧批注',
      status: 'open',
      source: 'manual',
      target: 'revised',
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  addedAt: 1,
}

describe('双文档锚定的导出', () => {
  it('inline：改稿侧批注单独列在文末，不插入原文', () => {
    const out = exportInline(doc.text, doc.annotations, { revisedText: doc.revised })
    // 原文侧批注以行内标记插入锚点后
    expect(out.startsWith('原文第一行。【批注①·问题】原文侧批注\n原文第二行。')).toBe(true)
    expect(out).toContain('针对 AI 改稿')
    expect(out).toContain('【批注②·认可】改稿侧批注')
  })

  it('snippets：改稿侧摘录来自改稿文本并带（改稿）标记', () => {
    const out = exportSnippets(doc.text, doc.annotations, { revisedText: doc.revised })
    expect(out).toContain('【片段①】原文第一行。')
    expect(out).toContain('【片段②】（改稿）改稿唯一行。')
  })

  it('review：改稿侧前缀为「改稿：」', () => {
    const out = exportReview(doc.text, doc.annotations, { revisedText: doc.revised })
    expect(out).toContain('> 原文：原文第一行。')
    expect(out).toContain('> 改稿：改稿唯一行。')
  })

  it('无改稿文本兜底：改稿侧批注回退到原文摘录（不崩溃）', () => {
    const out = exportReview(doc.text, doc.annotations)
    expect(out).toContain('> 改稿：')
  })
})

describe('W3C 改稿侧 roundtrip', () => {
  it('toW3C 标记 #revised source；fromW3C 按 source 路由到改稿文本重锚', () => {
    const exported = toW3C(doc, { includeResolved: true })
    expect(exported).toHaveLength(2)
    const revisedAnn = exported.find((a) => a.target.source.includes('#revised'))!
    expect(revisedAnn.target.selector[0]).toMatchObject({ type: 'TextQuoteSelector', exact: '改稿唯一行。' })

    // 改稿文本有位移时：换一篇更长的改稿，quote 重锚
    const longerRevised = '开头一句。\n改稿唯一行。\n结尾。'
    const r = fromW3C(exported, doc.text, { revisedText: longerRevised })
    expect(r.unmatched).toBe(0)
    const back = r.annotations.find((a) => a.target === 'revised')!
    expect(longerRevised.slice(back.start, back.end)).toBe('改稿唯一行。')
    const original = r.annotations.find((a) => a.target !== 'revised')!
    expect(doc.text.slice(original.start, original.end)).toBe('原文第一行。')
  })

  it('无改稿文本时 #revised 条目计为 unmatched', () => {
    const r = fromW3C(toW3C(doc, { includeResolved: true }), doc.text)
    expect(r.total).toBe(2)
    expect(r.unmatched).toBe(1)
    expect(r.annotations.some((a) => a.target === 'revised')).toBe(false)
  })
})
