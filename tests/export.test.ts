import { describe, expect, it } from 'vitest'
import { exportInline, exportReview, exportSnippets, numberAnnotations } from '../src/core/export'
import type { Annotation } from '../src/core/types'

function ann(id: string, start: number, end: number, comment: string, status: 'open' | 'resolved' = 'open'): Annotation {
  return {
    id, start, end, kind: 'issue', comment,
    status, source: 'manual', createdAt: 0, updatedAt: 0,
  }
}

const TEXT = '第一段：随着技术的不断发展。\n\n第二段：综上所述，未来可期。'

describe('numberAnnotations', () => {
  it('按文档位置排序编号', () => {
    const map = numberAnnotations([ann('b', 20, 25, 'x'), ann('a', 0, 5, 'y')])
    expect(map.get('a')).toBe('①')
    expect(map.get('b')).toBe('②')
  })
})

describe('exportInline', () => {
  it('批注标记插在锚点结束处，原文分段保留', () => {
    const out = exportInline(TEXT, [ann('a', 4, 14, '起手壳')])
    expect(out).toContain('第一段：随着技术的不断发展。【批注①·问题】起手壳')
    expect(out).toContain('\n\n')
  })
  it('resolved 默认不导出', () => {
    const out = exportInline(TEXT, [ann('a', 4, 14, '已处理', 'resolved')])
    expect(out).not.toContain('批注')
    expect(out).toContain('随着技术的不断发展')
  })
  it('includeResolved=true 时导出', () => {
    const out = exportInline(TEXT, [ann('a', 4, 14, '已处理', 'resolved')], { includeResolved: true })
    expect(out).toContain('批注①·问题】已处理')
  })
  it('无批注时返回原文', () => {
    expect(exportInline(TEXT, [])).toBe(TEXT)
  })
})

describe('exportSnippets', () => {
  it('每条 = 片段 + 批注，编号一致', () => {
    const out = exportSnippets(TEXT, [ann('a', 4, 14, '起手壳')])
    expect(out).toBe('【片段①】随着技术的不断发展。\n【批注①·问题】起手壳')
  })
})

describe('exportReview', () => {
  it('输出 Markdown 引用块，问题带 [!] 文本标记（不用 emoji）', () => {
    const out = exportReview(TEXT, [ann('a', 4, 14, '起手壳')])
    expect(out).toContain('批注反馈（共 1 条）：')
    expect(out).toContain('> 原文：随着技术的不断发展。')
    expect(out).toContain('> [!] 批注①（问题）：起手壳')
  })

  it('认可批注带 [+] 标记', () => {
    const praise = { ...ann('p', 4, 14, '这段讲清楚了取舍'), kind: 'praise' as const }
    const out = exportReview(TEXT, [praise])
    expect(out).toContain('> [+] 批注①（认可）：这段讲清楚了取舍')
  })
  it('多行锚点在引用里压成单行', () => {
    const out = exportReview('AAA\n\nBBB'.replace('AAA', '行一\n行二'), [ann('a', 0, 6, 'c')])
    expect(out).toContain('> 原文：行一 行二')
  })
})
