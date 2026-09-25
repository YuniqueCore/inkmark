import { describe, expect, it } from 'vitest'
import { hitsToAnnotations, maskProtected, scanSlop } from '../src/core/slop'
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

  it('cluster 跨段不累计', () => {
    const hits = scanSlop('我们要赋能业务。\n\n下一步找抓手。', [lex])
    expect(hits).toHaveLength(0)
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

  it('去重先于阈值升级：被吞掉的命中不计入 density（对齐 slop_check.py）', () => {
    const packs: SlopLexicon = {
      meta: { lang: 'zh', version: 't' },
      categories: [
        { id: 'plain', label: 'P', entries: [{ p: '总结总结总' }] },
        { id: 'den', label: 'D', entries: [{ p: '总结', mode: 'density', density_min: 3 }] },
      ],
    }
    // 「总结」出现 3 次，但全部落在更长 plain 命中的阴影里被去重吞掉 → density 计数 0，静默
    expect(scanSlop('总结总结总结', [packs])).toHaveLength(1)
    expect(scanSlop('总结总结总结', [packs])[0]!.matched).toBe('总结总结总')
  })

  it('flags：IGNORECASE 与 MULTILINE 生效（slop_check.py 同语义）', () => {
    const packs: SlopLexicon = {
      meta: { lang: 'en', version: 't' },
      categories: [
        { id: 'case', label: 'C', entries: [{ p: '\\bdelve into\\b', flags: ['IGNORECASE'] }] },
        { id: 'head', label: 'H', entries: [{ p: '^#+ ', flags: ['MULTILINE'] }] },
      ],
    }
    const hits = scanSlop('please Delve Into this\n\n## 标题行', [packs])
    expect(hits.map((h) => h.categoryId).sort()).toEqual(['case', 'head'])
  })

  it('URL 与邮箱保护区（含地址里的套话词）', () => {
    const text = '见 https://example.com/众所周知 和 admin@example.com，正文众所周知。'
    const hits = scanSlop(text, [lex])
    expect(hits).toHaveLength(1)
    expect(hits[0]!.start).toBe(text.indexOf('正文众所周知') + 2)
  })

  it('未闭合代码围栏保护到文末（编辑中文本不误报）', () => {
    const hits = scanSlop('```\n众所周知', [lex])
    expect(hits).toHaveLength(0)
  })

  it('多词库独立走管线，同类命中合并输出', () => {
    const en: SlopLexicon = {
      meta: { lang: 'en', version: 't' },
      categories: [{ id: 'en-x', label: 'EN', entries: [{ p: '\\bdelve\\b' }] }],
    }
    const hits = scanSlop('众所周知 we delve into 赋能抓手', [lex, en])
    expect(hits.map((h) => h.categoryId)).toContain('en-x')
    expect(hits.filter((h) => h.categoryId === 'jargon')).toHaveLength(2)
  })

  it('代码块、行内代码、URL 内的命中被忽略', () => {
    const text = '```\n众所周知\n```\n正文里提到 `众所周知` 这个词，然后 url https://example.com/众所周知。'
    expect(scanSlop(text, [lex])).toHaveLength(0)
  })

  it('正文里的命中照常报告', () => {
    expect(scanSlop('正文众所周知。', [lex])).toHaveLength(1)
  })
})

describe('maskProtected', () => {
  it('掩码等长且保留换行，围栏内容被占位', () => {
    const text = 'a\n```\n众所周知\n```\nb `众所周知` https://e.com/众所周知'
    const masked = maskProtected(text)
    expect(masked.length).toBe(text.length)
    expect(masked.split('\n').length).toBe(text.split('\n').length)
    const fenceAt = text.indexOf('```')
    expect(masked.slice(fenceAt, fenceAt + 3)).toBe('···')
    expect(masked[0]).toBe('a')
    expect(masked).not.toContain('众所周')
  })

  it('邮箱被掩码（slop_check.py 的 URL 段含邮箱分支）', () => {
    const masked = maskProtected('写邮件到 a.b-team@x.co 完')
    expect(masked.includes('a.b-team@x.co')).toBe(false)
    expect(masked.startsWith('写邮件到 ')).toBe(true)
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
