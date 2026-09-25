import { describe, expect, it } from 'vitest'
import { blockAt, snippet, splitBlocks, textQuoteSelector } from '../src/core/text'

describe('splitBlocks', () => {
  it('按空行分块，块偏移映射回原文无损', () => {
    const text = '第一段第一行\n第一段第二行\n\n第二段'
    const blocks = splitBlocks(text)
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toEqual({ start: 0, text: '第一段第一行\n第一段第二行' })
    expect(blocks[1]).toEqual({ start: 15, text: '第二段' })
    // 每个块切片回来必须等于原文本的对应区域
    for (const b of blocks) {
      expect(text.slice(b.start, b.start + b.text.length)).toBe(b.text)
    }
  })

  it('首尾空行与连续空行都安全', () => {
    const text = '\n\n开头\n\n\n\n结尾\n\n'
    const blocks = splitBlocks(text)
    expect(blocks.map((b) => b.text)).toEqual(['开头', '结尾'])
    expect(text.slice(blocks[1]!.start, blocks[1]!.start + blocks[1]!.text.length)).toBe('结尾')
  })

  it('空文本返回空数组', () => {
    expect(splitBlocks('')).toEqual([])
    expect(splitBlocks('\n\n\n')).toEqual([])
  })
})

describe('blockAt', () => {
  const blocks = splitBlocks('aaaa\n\nbbbb\n\ncccc')
  it('落在块内返回该块', () => {
    expect(blockAt(blocks, 0)?.text).toBe('aaaa')
    expect(blockAt(blocks, 6)?.text).toBe('bbbb')
  })
  it('落在空行分隔区时归前一个块', () => {
    expect(blockAt(blocks, 5)?.text).toBe('aaaa')
  })
  it('越界返回 undefined', () => {
    expect(blockAt(blocks, 999)).toBeUndefined()
  })
})

describe('snippet', () => {
  const text = '0123456789'.repeat(30)
  it('短文本原样返回', () => {
    expect(snippet(text, 0, 10)).toBe('0123456789')
  })
  it('长文本两端截断加省略号', () => {
    const s = snippet(text, 0, 300, 20)
    expect(s).toContain('……')
    expect(s.length).toBeLessThanOrEqual(23)
  })
})

describe('textQuoteSelector', () => {
  it('给出精确原文与前后文', () => {
    const text = '前'.repeat(40) + '目标内容' + '后'.repeat(40)
    const sel = textQuoteSelector(text, 40, 44)
    expect(sel.exact).toBe('目标内容')
    expect(sel.prefix).toBe('前'.repeat(32))
    expect(sel.suffix).toBe('后'.repeat(32))
  })
})
