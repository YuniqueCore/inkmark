/** 引文锚定匹配回归：置信度门控、模糊回锚、边界语义。
 * 关键场景来自真实误锚案例：单字引文「调」在「调→调节」编辑后
 * 旧算法照常锚到别处，新算法按门控判失锚（钉在改动处）。
 */

import { describe, expect, it } from 'vitest'
import { anchorQuote } from '../src/core/quote-match'
import { reanchorAnnotations } from '../src/core/reanchor'
import { textQuoteSelector } from '../src/core/text'
import type { Annotation } from '../src/core/types'

const ann = (start: number, end: number, over: Partial<Annotation> = {}): Annotation => ({
  id: 'a1',
  start,
  end,
  kind: 'suggestion',
  comment: '批注',
  status: 'open',
  source: 'manual',
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

describe('anchorQuote · 置信度门控', () => {
  const OLD = '两个阈值都能在 0-200MB 之间调'
  const NEW = '两个阈值都能在 0-200MB 之间调节'

  it('单字引文「调」在 调→调节 后：上下文已变 → 否决锚点（用户误锚案例回归）', () => {
    const q = textQuoteSelector(OLD, OLD.length - 1, OLD.length)
    expect(q.exact).toBe('调')
    // 引文仍能在新文本找到（调节 里的 调），但后文从边界/原后文变成了「节」
    expect(NEW.includes(q.exact)).toBe(true)
    expect(anchorQuote(NEW, q, {start: q.exact.length && OLD.length - 1, end: OLD.length})).toBeNull()
  })

  it('单字引文上下文完好 → 正常锚定（不误伤）', () => {
    const text = '调节两个阈值：调 low，再调 high。'
    const q = {exact: '调', prefix: '调节两个阈值：', suffix: ' low，再调 high。'}
    const hit = anchorQuote(text, q, {start: 7, end: 8})
    expect(hit).toMatchObject({start: 7, end: 8, via: 'exact'})
    expect(hit!.similarity).toBe(1)
  })

  it('多处命中：两侧上下文全吻合的候选胜出（不取最早）', () => {
    const hit = anchorQuote('调字重复：调、调', {exact: '调', prefix: '：', suffix: '、'}, undefined)
    expect(hit?.start).toBe(5)
  })

  it('单字引文仅一侧上下文吻合（多处命中）→ 门控否决', () => {
    // 三处「调」各只有前缀或后缀吻合：单字引文区分度不足，宁失锚不错锚
    expect(anchorQuote('一调二调三调', {exact: '调', prefix: '一', suffix: '三'}, undefined)).toBeNull()
  })

  it('长引文（≥8 字）自证：上下文已变仍可锚定', () => {
    const text = '结论变了。这是一段足够长的关键结论文本。'
    const hit = anchorQuote(text, {exact: '这是一段足够长的关键结论文本', prefix: '旧前文旧前文旧前文'}, undefined)
    expect(hit?.via).toBe('exact')
    expect(hit?.start).toBe(5)
  })

  it('容错模糊回锚：引文内部小改（插入标点）→ via fuzzy', () => {
    const text = '系统采用微服务架构，以提升弹性。'
    const hit = anchorQuote(text, {exact: '微服务架构以提升弹性', prefix: '系统采用', suffix: '。'}, undefined)
    expect(hit?.via).toBe('fuzzy')
    expect(text.slice(hit!.start, hit!.end)).toBe('微服务架构，以提升弹性')
  })

  it('引文彻底不存在且模糊无解 → null', () => {
    expect(anchorQuote('完全无关的文本', {exact: '微服务架构以提升弹性', prefix: '', suffix: ''}, undefined)).toBeNull()
  })

  it('空引文 → null', () => {
    expect(anchorQuote('任意文本', {exact: ''}, undefined)).toBeNull()
  })
})

describe('reanchorAnnotations · 与门控联动', () => {
  it('单字引文被改掉：不再错锚到别处，而是钳到改动处标失锚', () => {
    const oldText = '两个阈值都能在 0-200MB 之间调'
    const newText = '两个阈值都能在 0-200MB 之间调节'
    const result = reanchorAnnotations(oldText, newText, [ann(oldText.length - 1, oldText.length)])
    expect(result.clamped).toBe(1)
    expect(result.moved).toBe(0)
    expect(result.annotations[0]!.anchorLost).toBe(true)
    // 钉在改动边界（原 调 的位置），不再跳到文内其他「调」
    expect(result.annotations[0]!.start).toBe(oldText.length - 1)
  })

  it('引文完好且仅位移 → moved 且清除失锚标记', () => {
    const result = reanchorAnnotations(
      '第一段。目标句子在这里。第二段。',
      '开头新增。第一段。目标句子在这里。第二段。',
      [ann(5, 12, {anchorLost: true})],
    )
    expect(result.moved).toBe(1)
    expect(result.clamped).toBe(0)
    expect(result.annotations[0]!.anchorLost).toBeUndefined()
    expect(result.annotations[0]!.start).toBe(10)
  })
})
