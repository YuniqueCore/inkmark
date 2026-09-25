import { describe, expect, it } from 'vitest'
import { fromW3C, toW3C } from '../src/core/w3c'
import type { DocItem } from '../src/core/types'

const doc: DocItem = {
  id: 'doc-x',
  name: '测试文档',
  path: '',
  text: '第一段是开头。\n\n这里是【目标短语】所在的一句。\n\n目标短语 还出现了第二次。',
  annotations: [
    {
      id: 'ann-1',
      start: 12,
      end: 18,
      kind: 'issue',
      comment: '这句太啰嗦',
      status: 'open',
      source: 'manual',
      createdAt: 1700000000000,
      updatedAt: 1700000100000,
    },
    {
      id: 'ann-2',
      start: 26,
      end: 30,
      kind: 'highlight',
      comment: '好句子',
      status: 'resolved',
      source: 'manual',
      createdAt: 1700000000000,
      updatedAt: 1700000200000,
    },
  ],
  addedAt: 1700000000000,
}

describe('toW3C', () => {
  it('导出双选择器与 tagging body，默认不含已解决', () => {
    const out = toW3C(doc)
    expect(out).toHaveLength(1)
    const a = out[0]!
    expect(a['@context']).toBe('http://www.w3.org/ns/anno.jsonld')
    expect(a.motivation).toBe('commenting')
    const [quote, position] = a.target.selector
    expect(quote?.type).toBe('TextQuoteSelector')
    if (quote?.type !== 'TextQuoteSelector') return
    expect(quote.exact).toBe('【目标短语】')
    expect(position).toMatchObject({ type: 'TextPositionSelector', start: 12, end: 18 })
    expect(a.body).toContainEqual({ type: 'TextualBody', value: 'issue', purpose: 'tagging' })
    expect(a.id).toContain('ann=ann-1')
  })

  it('includeResolved 导出已解决批注并带 resolved 标签', () => {
    const out = toW3C(doc, { includeResolved: true })
    expect(out).toHaveLength(2)
    const resolved = out.find((a) => a.body.some((b) => b.value === 'resolved'))!
    expect(resolved.motivation).toBe('highlighting')
  })
})

describe('fromW3C', () => {
  it('roundtrip：导出再导入还原批注（位置校验通过）', () => {
    const exported = toW3C(doc, { includeResolved: true })
    const { annotations, unmatched, total } = fromW3C(exported, doc.text)
    expect(unmatched).toBe(0)
    expect(total).toBe(2)
    expect(annotations).toHaveLength(2)
    const first = annotations.find((a) => a.id === 'ann-1')!
    expect(first).toMatchObject({ start: 12, end: 18, kind: 'issue', status: 'open', comment: '这句太啰嗦' })
  })

  it('位置失配时按 exact 全文重锚，prefix/suffix 消歧选对出现位置', () => {
    const exported = toW3C(doc, { includeResolved: true })
    const ann = exported.find((a) => a.body.some((b) => b.value === 'highlight'))!
    // 文本改过：目标短语现在只在后段出现一次，原位置已经对不上
    const changed = '完全不同的开头。\n\n目标短语 在这里。'
    const { annotations, unmatched } = fromW3C([ann], changed)
    expect(unmatched).toBe(0)
    expect(annotations[0]).toMatchObject({ start: changed.indexOf('目标短语'), kind: 'highlight', status: 'resolved' })
  })

  it('exact 不在目标文本中 → 跳过并计数', () => {
    const { annotations, unmatched } = fromW3C(toW3C(doc, { includeResolved: true }), '完全无关的文本')
    expect(annotations).toHaveLength(0)
    expect(unmatched).toBe(2)
  })

  it('接受 {items} 包装与单对象，坏条目计入 unmatched', () => {
    const exported = toW3C(doc)
    const page = { '@context': 'http://www.w3.org/ns/anno.jsonld', type: 'AnnotationPage', items: exported }
    expect(fromW3C(page, doc.text).annotations).toHaveLength(1)
    expect(fromW3C(exported[0], doc.text).annotations).toHaveLength(1)
    expect(fromW3C([{ nope: true }, null, exported[0]], doc.text)).toMatchObject({ unmatched: 2, total: 3 })
  })

  it('未知 kind 的 tagging 回退到 motivation，再回退到 highlight', () => {
    const weird = [
      {
        type: 'Annotation',
        motivation: 'assessing',
        body: [{ type: 'TextualBody', value: '写得好', purpose: 'describing' }],
        target: { selector: [{ type: 'TextQuoteSelector', exact: '第一段是开头。' }] },
      },
    ]
    const { annotations } = fromW3C(weird, doc.text)
    expect(annotations[0]).toMatchObject({ kind: 'praise', status: 'open' })
  })
})
