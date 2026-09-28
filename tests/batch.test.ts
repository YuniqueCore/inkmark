/** 搜索批量批注核心：findMatches 匹配语义 + buildBatchAnnotations 构造。 */

import { describe, expect, it } from 'vitest'
import { buildBatchAnnotations, findMatches, regexIssue } from '../src/core/batch'

describe('findMatches', () => {
  it('返回全部非重叠出现位置', () => {
    expect(findMatches('ab ab ab', 'ab')).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
      { start: 6, end: 8 },
    ])
  })

  it('拉丁字母大小写不敏感', () => {
    expect(findMatches('Foo foo FOO', 'foo')).toHaveLength(3)
  })

  it('正则元字符按字面匹配', () => {
    expect(findMatches('a(b a(b c', 'a(b')).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
    ])
    expect(findMatches('c++ c++', 'c++')).toHaveLength(2)
  })

  it('空白查询返回空；命中数随文本而定', () => {
    expect(findMatches('任意文本', '')).toEqual([])
    expect(findMatches('任意文本', '   ')).toEqual([])
    expect(findMatches('不含目标', '不存在')).toEqual([])
  })

  it('查询两端的空白被忽略', () => {
    expect(findMatches('ab ab', ' ab ')).toHaveLength(2)
  })
})

describe('findMatches · 匹配方式（Aa / .*）', () => {
  it('caseSensitive：区分大小写后只命中字面一致的片段', () => {
    expect(findMatches('Foo foo FOO', 'foo', {caseSensitive: true})).toEqual([{start: 4, end: 7}])
    expect(findMatches('Foo foo FOO', 'foo')).toHaveLength(3) // 缺省不区分
  })

  it('regex：查询按正则解析', () => {
    expect(findMatches('aXb a?b axb', 'a.b', {regex: true})).toEqual([
      {start: 0, end: 3},
      {start: 4, end: 7},
      {start: 8, end: 11},
    ])
  })

  it('regex 关闭时元字符按字面匹配', () => {
    expect(findMatches('aXb a?b', 'a?b', {regex: false})).toEqual([{start: 4, end: 7}])
  })

  it('无效正则返回空（不抛错）', () => {
    expect(findMatches('abc', 'a(', {regex: true})).toEqual([])
  })

  it('regex 模式跳过零长命中（批注区间必须非空）', () => {
    expect(findMatches('ab', 'x*', {regex: true})).toEqual([])
    expect(findMatches('ab', 'a*', {regex: true})).toEqual([{start: 0, end: 1}])
  })

  it('regexIssue：无效正则返回错误信息，有效返回 null', () => {
    expect(regexIssue('a(')).not.toBeNull()
    expect(regexIssue('a?b')).toBeNull()
    expect(regexIssue('  ')).toBeNull() // 空白串能构造正则，交给 findMatches 返回空
  })
})

describe('buildBatchAnnotations', () => {
  it('生成共享 groupId、逐条唯一 id 的一阶批注', () => {
    const anns = buildBatchAnnotations(
      [
        { start: 0, end: 2 },
        { start: 5, end: 7 },
      ],
      { kind: 'suggestion', comment: '表述含糊' },
      1234,
    )
    expect(anns).toHaveLength(2)
    expect(new Set(anns.map((a) => a.id)).size).toBe(2)
    expect(new Set(anns.map((a) => a.groupId)).size).toBe(1)
    expect(anns[0]).toMatchObject({
      id: 'batch-1234-0',
      start: 0,
      end: 2,
      kind: 'suggestion',
      comment: '表述含糊',
      status: 'open',
      source: 'manual',
      groupId: 'batch-1234',
    })
    expect(anns[1]).toMatchObject({ id: 'batch-1234-1', start: 5, end: 7 })
  })

  it('空匹配返回空数组', () => {
    expect(buildBatchAnnotations([], { kind: 'praise', comment: '' })).toEqual([])
  })
})

describe('buildBatchAnnotations · 替换词', () => {
  it('replacement 随组写入每条批注；缺省不携带', () => {
    const with_ = buildBatchAnnotations([{ start: 0, end: 2 }], { kind: 'suggestion', comment: 'c', replacement: '新词' })
    expect(with_[0]!.replacement).toBe('新词')
    const without = buildBatchAnnotations([{ start: 0, end: 2 }], { kind: 'suggestion', comment: 'c' })
    expect('replacement' in without[0]!).toBe(false)
  })
})
