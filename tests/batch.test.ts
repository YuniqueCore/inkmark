/** 搜索批量批注核心：findMatches 匹配语义 + buildBatchAnnotations 构造。 */

import { describe, expect, it } from 'vitest'
import { buildBatchAnnotations, findMatches } from '../src/core/batch'

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
