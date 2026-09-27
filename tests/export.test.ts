import { describe, expect, it } from 'vitest'
import { exportFileName, exportInline, exportReview, exportSnippets, numberAnnotations, zipEntryNames } from '../src/core/export'
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
    expect(out).toContain('第一段：随着技术的不断发展。【批注①·问题 @4-14】起手壳')
    expect(out).toContain('\n\n')
  })
  it('resolved 默认不导出', () => {
    const out = exportInline(TEXT, [ann('a', 4, 14, '已处理', 'resolved')])
    expect(out).not.toContain('批注')
    expect(out).toContain('随着技术的不断发展')
  })
  it('includeResolved=true 时导出', () => {
    const out = exportInline(TEXT, [ann('a', 4, 14, '已处理', 'resolved')], { includeResolved: true })
    expect(out).toContain('批注①·问题 @4-14】已处理')
  })
  it('无批注时返回原文', () => {
    expect(exportInline(TEXT, [])).toBe(TEXT)
  })
})

describe('exportSnippets', () => {
  it('每条 = 片段 + 批注，编号一致', () => {
    const out = exportSnippets(TEXT, [ann('a', 4, 14, '起手壳')])
    expect(out).toBe('【片段① @4-14】随着技术的不断发展。\n【批注①·问题】起手壳')
  })
})

describe('exportReview', () => {
  it('输出 Markdown 引用块，问题带 [!] 文本标记（不用 emoji）', () => {
    const out = exportReview(TEXT, [ann('a', 4, 14, '起手壳')])
    expect(out).toContain('批注反馈（共 1 条）：')
    expect(out).toContain('> 原文 @4-14：随着技术的不断发展。')
    expect(out).toContain('> [!] 批注①（问题）：起手壳')
  })

  it('认可批注带 [+] 标记', () => {
    const praise = { ...ann('p', 4, 14, '这段讲清楚了取舍'), kind: 'praise' as const }
    const out = exportReview(TEXT, [praise])
    expect(out).toContain('> [+] 批注①（认可）：这段讲清楚了取舍')
  })
  it('多行锚点在引用里压成单行', () => {
    const out = exportReview('AAA\n\nBBB'.replace('AAA', '行一\n行二'), [ann('a', 0, 6, 'c')])
    expect(out).toContain('> 原文 @0-6：行一 行二')
  })
})

describe('文件信息（fileName 选项）', () => {
  const opts = { fileName: 'chapter-3.md' }

  it('三种格式顶部标注「文件：{name}」', () => {
    expect(exportInline(TEXT, [ann('a', 4, 14, '起手壳')], opts).startsWith('文件：chapter-3.md\n\n第一段：')).toBe(true)
    expect(exportSnippets(TEXT, [ann('a', 4, 14, '起手壳')], opts).startsWith('文件：chapter-3.md\n\n【片段① @4-14】')).toBe(true)
    expect(exportReview(TEXT, [ann('a', 4, 14, '起手壳')], opts).startsWith('文件：chapter-3.md\n\n批注反馈（共 1 条）：')).toBe(true)
  })

  it('缺省不输出文件行，现有导出不受影响', () => {
    expect(exportSnippets(TEXT, [ann('a', 4, 14, '起手壳')])).not.toContain('文件：')
    expect(exportReview(TEXT, [ann('a', 4, 14, '起手壳')])).not.toContain('文件：')
    expect(exportInline(TEXT, [])).toBe(TEXT)
  })

  it('无批注时同样标注文件信息', () => {
    expect(exportSnippets(TEXT, [], opts)).toBe('文件：chapter-3.md')
    expect(exportInline(TEXT, [], opts).startsWith('文件：chapter-3.md\n\n第一段：')).toBe(true)
    expect(exportReview(TEXT, [], opts).startsWith('文件：chapter-3.md\n\n批注反馈（共 0 条）：')).toBe(true)
  })
})

describe('偏移标注（@start-end，0-based 右端开区间）', () => {
  it('片段与评审引用都带偏移，改稿侧注明相对改稿', () => {
    const out = exportSnippets(TEXT, [ann('a', 4, 14, '起手壳')])
    expect(out).toContain('@4-14')
    const rev = exportReview(TEXT, [ann('a', 4, 14, '起手壳')])
    expect(rev).toContain('> 原文 @4-14：')
  })
})

describe('失锚批注的导出标记', () => {
  const lost = { ...ann('a', 4, 14, '起手壳'), anchorLost: true as const }

  it('三种格式在偏移槽统一追加 ·失锚', () => {
    expect(exportInline(TEXT, [lost])).toContain('【批注①·问题 @4-14·失锚】起手壳')
    expect(exportSnippets(TEXT, [lost])).toContain('【片段① @4-14·失锚】')
    expect(exportReview(TEXT, [lost])).toContain('> 原文 @4-14·失锚：')
  })

  it('正常批注不带失锚标记', () => {
    expect(exportInline(TEXT, [ann('a', 4, 14, '起手壳')])).not.toContain('失锚')
    expect(exportReview(TEXT, [ann('a', 4, 14, '起手壳')])).not.toContain('失锚')
  })
})

describe('exportFileName', () => {
  it('来源文件名打头，去扩展名，带格式与日期', () => {
    const d = new Date('2026-09-28T00:00:00Z')
    expect(exportFileName('chapter-3.md', 'snippets', d)).toBe('chapter-3-批注-snippets-2026-09-28.md')
    expect(exportFileName('chapter-3.md', 'w3c', d)).toBe('chapter-3-批注-w3c-2026-09-28.json')
  })
  it('清洗非法字符；无扩展名原样保留；空名退回 untitled', () => {
    const d = new Date('2026-09-28T00:00:00Z')
    expect(exportFileName('a/b:c*.md', 'review', d)).toBe('a-b-c--批注-review-2026-09-28.md')
    expect(exportFileName('示例：AI 味产品文', 'inline', d)).toBe('示例：AI 味产品文-批注-inline-2026-09-28.md')
    expect(exportFileName('.md', 'inline', d)).toBe('untitled-批注-inline-2026-09-28.md')
  })
})

describe('zipEntryNames（多文档 zip 条目名）', () => {
  const d = new Date('2026-09-28T00:00:00Z')
  it('同名文档加 -2/-3 序号，不互相覆盖', () => {
    expect(zipEntryNames(['a.md', 'a.md', 'a.md', 'b.md'], 'snippets', d)).toEqual([
      'a-批注-snippets-2026-09-28.md',
      'a-批注-snippets-2026-09-28-2.md',
      'a-批注-snippets-2026-09-28-3.md',
      'b-批注-snippets-2026-09-28.md',
    ])
  })
  it('W3C 格式同样适用，无重名时原样返回', () => {
    expect(zipEntryNames(['x.md', 'y.md'], 'w3c', d)).toEqual([
      'x-批注-w3c-2026-09-28.json',
      'y-批注-w3c-2026-09-28.json',
    ])
  })
})
