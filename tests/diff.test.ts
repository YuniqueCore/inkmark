import { describe, expect, it } from 'vitest'
import { diffLines, diffStats } from '../src/core/diff'

const rowsOf = (rows: ReturnType<typeof diffLines>) => rows.map((r) => `${r.type[0]}:${r.text}`)

describe('diffLines', () => {
  it('完全相同的文本全部等值，且双侧偏移一致', () => {
    const rows = diffLines('第一行\n第二行', '第一行\n第二行')
    expect(rowsOf(rows)).toEqual(['e:第一行', 'e:第二行'])
    expect(rows.every((r) => r.aStart !== null && r.bStart !== null)).toBe(true)
  })

  it('插入、删除、替换的混合', () => {
    const a = 'a\nb\nc\nd'
    const b = 'a\nX\nc\nd\ne'
    const rows = diffLines(a, b)
    // 等值/删除/新增各自的相对顺序确定；del 与相邻 add 的先后由 Myers 选路决定，不指定
    expect(rows.filter((r) => r.type === 'equal').map((r) => r.text)).toEqual(['a', 'c', 'd'])
    expect(rows.filter((r) => r.type === 'del').map((r) => r.text)).toEqual(['b'])
    expect(rows.filter((r) => r.type === 'add').map((r) => r.text)).toEqual(['X', 'e'])
  })

  it('整段重写产生相邻的删除块与新增块', () => {
    const rows = diffLines('旧标题\n旧内容', '新标题\n新内容')
    expect(rowsOf(rows)).toEqual(['d:旧标题', 'd:旧内容', 'a:新标题', 'a:新内容'])
  })

  it('空行也参与比较；尾部换行不产生多余空行', () => {
    const rows = diffLines('a\n\nb\n', 'a\n\nc\n')
    expect(rowsOf(rows)).toEqual(['e:a', 'e:', 'd:b', 'a:c'])
  })

  it('从空文本到有文本 = 全部新增；反向 = 全部删除', () => {
    expect(rowsOf(diffLines('', 'x\ny'))).toEqual(['a:x', 'a:y'])
    expect(rowsOf(diffLines('x\ny', ''))).toEqual(['d:x', 'd:y'])
  })

  it('偏移可回指原文：del 行的 aStart 指向原文该行起点', () => {
    const a = '第一段落在这里\n\n被删的段落\n\n尾部'
    const rows = diffLines(a, '第一段落在这里\n\n尾部')
    const del = rows.find((r) => r.type === 'del')!
    expect(del.text).toBe('被删的段落')
    expect(a.slice(del.aStart!, del.aStart! + del.text.length)).toBe('被删的段落')
  })

  it('超大编辑距离降级为整块替换而不是挂死', () => {
    const a = Array.from({ length: 600 }, (_, i) => `旧行${i}`).join('\n')
    const b = Array.from({ length: 600 }, (_, i) => `完全不同的新行${i}`).join('\n')
    const rows = diffLines(a, b)
    expect(rows.every((r) => r.type !== 'equal')).toBe(true)
    const { added, removed } = diffStats(rows)
    expect(removed).toBe(600)
    expect(added).toBe(600)
  })

  it('公共前后缀裁剪后仍正确对齐中间的小改动', () => {
    const head = Array.from({ length: 50 }, (_, i) => `头${i}`).join('\n')
    const tail = Array.from({ length: 50 }, (_, i) => `尾${i}`).join('\n')
    const rows = diffLines(`${head}\n旧中\n${tail}`, `${head}\n新中\n${tail}`)
    expect(rowsOf(rows)).toEqual([...Array.from({ length: 50 }, (_, i) => `e:头${i}`), 'd:旧中', 'a:新中', ...Array.from({ length: 50 }, (_, i) => `e:尾${i}`)])
  })
})

describe('diffStats', () => {
  it('统计增删行数', () => {
    expect(diffStats(diffLines('a\nb\nc', 'a\nc\nd'))).toEqual({ added: 1, removed: 1 })
  })
})
