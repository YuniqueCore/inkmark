/** 快捷批注语：词表完整性 + 切换纯函数的行为。 */

import { describe, expect, it } from 'vitest'
import { hasQuickPhrase, MANUAL_KINDS, QUICK_PHRASES, toggleQuickPhrase } from '../src/core/types'
import type { AnnotationKind } from '../src/core/types'

describe('QUICK_PHRASES 词表', () => {
  it('只覆盖人工可写的四类；每类 4-16 条，短语互不重复', () => {
    const kinds = Object.keys(QUICK_PHRASES) as AnnotationKind[]
    expect([...kinds].sort()).toEqual([...MANUAL_KINDS].sort())
    for (const k of MANUAL_KINDS) {
      const phrases = QUICK_PHRASES[k]!
      expect(phrases.length).toBeGreaterThanOrEqual(4)
      expect(phrases.length).toBeLessThanOrEqual(16)
      expect(new Set(phrases).size).toBe(phrases.length)
      for (const p of phrases) expect(p.trim()).toBe(p)
    }
  })

  it('原「问题 / AI 味」词表并入建议类，代表短语不丢失', () => {
    const s = QUICK_PHRASES.suggestion!
    for (const p of ['表述含糊，建议给出明确结论', '逻辑跳跃，缺少过渡', '用词过于华丽', '句式空洞', '套话空话'])
      expect(s).toContain(p)
  })
})

describe('toggleQuickPhrase / hasQuickPhrase', () => {
  it('空批注语追加短语', () => {
    expect(toggleQuickPhrase('', '用词过于华丽')).toBe('用词过于华丽')
    expect(hasQuickPhrase('用词过于华丽', '用词过于华丽')).toBe(true)
  })
  it('多条以「；」连接；再次切换移除', () => {
    let c = toggleQuickPhrase('', '用词过于华丽')
    c = toggleQuickPhrase(c, '句式空洞')
    expect(c).toBe('用词过于华丽；句式空洞')
    c = toggleQuickPhrase(c, '用词过于华丽')
    expect(c).toBe('句式空洞')
    expect(hasQuickPhrase(c, '用词过于华丽')).toBe(false)
  })
  it('移除中间短语不影响其余', () => {
    const c = '论证有力；结构严谨'
    expect(toggleQuickPhrase(c, '结构严谨')).toBe('论证有力')
  })
  it('重复内容去空白后判定', () => {
    expect(hasQuickPhrase(' 论证有力 ； 表达清晰 ', '论证有力')).toBe(true)
  })
})
