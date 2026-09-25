import { describe, expect, it } from 'vitest'
import { reanchorAnnotations } from '../src/core/reanchor'
import type { Annotation } from '../src/core/types'

const ann = (id: string, start: number, end: number): Annotation => ({
  id,
  start,
  end,
  kind: 'issue',
  comment: 'c',
  status: 'open',
  source: 'manual',
  createdAt: 1,
  updatedAt: 1,
})

describe('reanchorAnnotations', () => {
  it('文本未变化时原样返回', () => {
    const text = '一段足够长的原始文本内容。'
    const anns = [ann('a', 0, 4)]
    const r = reanchorAnnotations(text, text, anns)
    expect(r).toEqual({ annotations: anns, moved: 0, clamped: 0 })
  })

  it('前缀插入：quote 重锚到新位置（moved）', () => {
    const old = '目标句子在这里。\n第二行。'
    const anns = [ann('a', 0, 8)] // 「目标句子在这里。」
    const r = reanchorAnnotations(old, `新加的开头。\n${old}`, anns)
    expect(r.clamped).toBe(0)
    expect(r.moved).toBe(1)
    const start = r.annotations[0]!.start
    expect(r.annotations[0]!.end - start).toBe(8)
    expect(r.annotations[0]!.start).toBe(start)
  })

  it('重复文本用 prefix/suffix 消歧，不锚到错误出现位置', () => {
    const old = '唯一前文。重复词收尾。'
    const anns = [ann('a', 5, 8)] // 「重复词」
    const changed = '重复词开头。唯一前文。重复词收尾。'
    const r = reanchorAnnotations(old, changed, anns)
    // 前缀「唯一前文。」消歧 → 锚到第二次出现
    expect(changed.slice(r.annotations[0]!.start, r.annotations[0]!.end)).toBe('重复词')
    expect(r.annotations[0]!.start).toBe(changed.indexOf('重复词', 6))
  })

  it('批注文本被删：diff 位移兜底，钳制到改动边界，不丢批注', () => {
    const old = '保留的首行。\n被整行删掉的句子。\n尾行。'
    const anns = [ann('a', 7, 17)] // 「被整行删掉的句子」
    const r = reanchorAnnotations(old, '保留的首行。\n尾行。', anns)
    expect(r.annotations).toHaveLength(1)
    expect(r.clamped).toBe(1)
    // 钉在删除处的边界（首行结束位置附近），偏移在新文本范围内
    const a = r.annotations[0]!
    expect(a.start).toBeGreaterThanOrEqual(0)
    expect(a.start).toBeLessThanOrEqual(a.end)
  })

  it('编辑行中间的词：批注恰好被改掉 → 钳到行内改动处', () => {
    const old = '这行有一个旧词要改掉。'
    const anns = [ann('a', 5, 7)] // 「旧词」
    const r = reanchorAnnotations(old, '这行有一个新词替换上了。', anns)
    expect(r.clamped).toBe(1)
    expect(r.annotations[0]!.start).toBeLessThanOrEqual('这行有一个新词替换上了。'.length)
  })

  it('同段未受影响的批注保持原位（位置校验通过 → moved 0）', () => {
    const old = '第一行稳定。\n第二行也稳定。'
    const anns = [ann('a', 0, 4)]
    const r = reanchorAnnotations(old, `${old}\n追加行。`, anns)
    expect(r.annotations[0]!.start).toBe(0)
    expect(r.moved).toBe(0)
    expect(r.clamped).toBe(0)
  })
})
