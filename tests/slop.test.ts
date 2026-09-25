import { describe, expect, it } from 'vitest'
import { hitsToAnnotations, protectedRanges, scanSlop } from '../src/core/slop'
import type { SlopLexicon } from '../src/core/types'

const lex: SlopLexicon = {
  meta: { lang: 'zh', version: 'test' },
  categories: [
    {
      id: 'openers',
      label: '万能开场',
      entries: [
        { p: '随着[^，。]{0,8}的(?:不断|飞速)发展' },
        { p: '众所周知' },
      ],
    },
    {
      id: 'jargon',
      label: '黑话',
      entries: [
        { p: '赋能', mode: 'cluster', cluster_min: 2 },
        { p: '抓手', mode: 'cluster', cluster_min: 2 },
        { p: '闭环', mode: 'cluster', cluster_min: 2 },
      ],
    },
    {
      id: 'hedges',
      label: '安全垫',
      entries: [{ p: '可能', mode: 'density', density_min: 3 }],
    },
  ],
}

describe('scanSlop', () => {
  it('plain 词条逐个命中', () => {
    const hits = scanSlop('众所周知，这个产品很好。', [lex])
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ matched: '众所周知', categoryId: 'openers' })
  })

  it('cluster 单个黑话不报，同段两个才报', () => {
    const single = scanSlop('我们要赋能业务。', [lex])
    expect(single).toHaveLength(0)
    const double = scanSlop('我们要赋能业务，找到抓手。', [lex])
    expect(double.map((h) => h.matched).sort()).toEqual(['抓手', '赋能'])
  })

  it('density 低频静默，达阈值才报', () => {
    const few = scanSlop('可能一。可能二。', [lex])
    expect(few).toHaveLength(0)
    const many = scanSlop('可能一。可能二。可能三。', [lex])
    expect(many).toHaveLength(3)
  })

  it('重叠命中保留更长匹配', () => {
    const rich: SlopLexicon = {
      meta: { lang: 'zh', version: 't' },
      categories: [{
        id: 'x', label: 'X',
        entries: [{ p: '非常' }, { p: '非常快速地发展' }],
      }],
    }
    const hits = scanSlop('它在非常快速地发展。', [rich])
    expect(hits).toHaveLength(1)
    expect(hits[0]!.matched).toBe('非常快速地发展')
  })

  it('代码块与行内代码内的命中被忽略', () => {
    const text = '```\n众所周知\n```\n正文里提到 `众所周知` 这个词，然后 url https://example.com/众所周知。'
    expect(scanSlop(text, [lex])).toHaveLength(0)
  })

  it('正文里的命中照常报告', () => {
    expect(scanSlop('正文众所周知。', [lex])).toHaveLength(1)
  })
})

describe('protectedRanges', () => {
  it('标记围栏与行内代码区间', () => {
    const text = 'ab\n```\nx\n```\ncd `e` f'
    const ranges = protectedRanges(text)
    expect(ranges.length).toBeGreaterThanOrEqual(2)
  })
})

describe('hitsToAnnotations', () => {
  it('组合类别与建议为批注内容', () => {
    const anns = hitsToAnnotations(scanSlop('众所周知，赋能抓手。', [lex]), 123)
    expect(anns).toHaveLength(3)
    expect(anns[0]!.kind).toBe('slop')
    expect(anns[0]!.source).toBe('slop')
    expect(anns[0]!.meta?.label).toBe('万能开场')
  })
})
