import { describe, expect, it } from 'vitest'
import { buildSegments } from '../src/core/anchors'
import type { Annotation } from '../src/core/types'

function ann(id: string, start: number, end: number): Annotation {
  return {
    id, start, end, kind: 'issue', comment: '', status: 'open',
    source: 'manual', createdAt: 0, updatedAt: 0,
  }
}

describe('buildSegments', () => {
  const blockStart = 10
  const blockText = '人工智能正在改变写作方式'

  it('无批注时整段 plain', () => {
    expect(buildSegments(blockStart, blockText, [])).toEqual([
      { text: blockText, annIds: [] },
    ])
  })

  it('单个批注切成三段，id 正确', () => {
    const segs = buildSegments(blockStart, blockText, [ann('a', 12, 16)])
    expect(segs).toEqual([
      { text: '人工', annIds: [] },
      { text: '智能正在', annIds: ['a'] },
      { text: '改变写作方式', annIds: [] },
    ])
  })

  it('相邻不同批注产出独立段（id 集合不同不合并）', () => {
    const segs = buildSegments(blockStart, blockText, [ann('a', 10, 13), ann('b', 13, 16)])
    expect(segs).toEqual([
      { text: '人工智', annIds: ['a'] },
      { text: '能正在', annIds: ['b'] },
      { text: '改变写作方式', annIds: [] },
    ])
  })

  it('重叠区域同集合段合并', () => {
    const segs = buildSegments(blockStart, blockText, [ann('a', 10, 16), ann('b', 13, 18)])
    expect(segs).toEqual([
      { text: '人工智', annIds: ['a'] },
      { text: '能正在', annIds: ['a', 'b'] },
      { text: '改变', annIds: ['b'] },
      { text: '写作方式', annIds: [] },
    ])
  })

  it('范围越出块边界时裁剪', () => {
    const segs = buildSegments(blockStart, blockText, [ann('a', 0, 100)])
    expect(segs).toEqual([{ text: blockText, annIds: ['a'] }])
  })

  it('完全在块外的批注不产出段', () => {
    const segs = buildSegments(blockStart, blockText, [ann('a', 0, 5), ann('b', 50, 60)])
    expect(segs).toEqual([{ text: blockText, annIds: [] }])
  })
})
