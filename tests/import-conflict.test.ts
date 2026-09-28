/** 导入冲突判定语义：冲突键、重命名递增、逐行动作、批量预设。 */

import { describe, expect, it } from 'vitest'
import {
  applyPreset,
  buildImportPlan,
  conflictKey,
  setRowAction,
  type ImportRow,
} from '../src/core/import-conflict'
import type { DocItem } from '../src/core/types'

const doc = (over: Partial<DocItem> = {}): DocItem => ({
  id: over.id ?? `doc-${over.name ?? 'a'}`,
  name: over.name ?? 'report.txt',
  path: over.path ?? '',
  text: over.text ?? '旧文本',
  annotations: over.annotations ?? [],
  addedAt: 1,
  ...over,
})

const incoming = (over: Partial<{name: string; path: string; text: string}> = {}) => ({
  name: over.name ?? 'report.txt',
  path: over.path ?? '',
  text: over.text ?? '新文本',
})

describe('conflictKey', () => {
  it('相对路径 + 文件名；根层与单文件共用空路径空间', () => {
    expect(conflictKey({name: 'a.txt', path: 'docs'})).toBe('docs/a.txt')
    expect(conflictKey({name: 'a.txt', path: ''})).toBe('a.txt')
  })
})

describe('buildImportPlan', () => {
  it('无同名 → direct；同名同文 → identical；同名异文 → rename', () => {
    const plan = buildImportPlan(
      [incoming(), incoming({name: 'same.txt', text: '旧文本'}), incoming({name: 'other.txt'})],
      [doc(), doc({id: 'doc-same', name: 'same.txt', text: '旧文本'})],
    )
    expect(plan.rows.map((r) => r.action)).toEqual(['rename', 'identical', 'direct'])
    expect(plan.hasConflicts).toBe(true)
    expect(plan.identicalCount).toBe(1)
    expect(plan.rows[0]!.renameTo).toBe('report-1.txt')
  })

  it('路径参与判定：不同目录的同名文件互不冲突', () => {
    const plan = buildImportPlan(
      [incoming({path: 'v2'}), incoming({path: 'v1'})],
      [doc({id: 'doc-v1', path: 'v1'})],
    )
    expect(plan.rows.map((r) => r.action)).toEqual(['direct', 'rename'])
  })

  it('重命名递增避开现有文档：report.txt 与 report-1.txt 都被占 → report-2.txt', () => {
    const plan = buildImportPlan([incoming()], [
      doc({id: 'd1'}),
      doc({id: 'd2', name: 'report-1.txt'}),
    ])
    expect(plan.rows[0]!.renameTo).toBe('report-2.txt')
  })

  it('无扩展名与隐藏文件整体当词干', () => {
    const plan = buildImportPlan(
      [incoming({name: 'README'}), incoming({name: '.gitignore'})],
      [doc({id: 'd1', name: 'README'}), doc({id: 'd2', name: '.gitignore'})],
    )
    expect(plan.rows.map((r) => r.renameTo)).toEqual(['README-1', '.gitignore-1'])
  })

  it('本次导入的多份同名文件依次递增，落点互不相撞', () => {
    const plan = buildImportPlan(
      [incoming(), incoming({text: '另一版'}), incoming({text: '第三版'})],
      [doc()],
    )
    expect(plan.rows.map((r) => r.renameTo)).toEqual(['report-1.txt', 'report-2.txt', 'report-3.txt'])
  })

  it('工作区为空：全部 direct，不弹诊断', () => {
    const plan = buildImportPlan([incoming(), incoming({name: 'b.txt'})], [])
    expect(plan.hasConflicts).toBe(false)
    expect(plan.rows.every((r) => r.action === 'direct')).toBe(true)
  })
})

describe('setRowAction', () => {
  it('改行动后重命名落点重排：覆盖行让出的名字可被 rename 行接管', () => {
    const plan = buildImportPlan([incoming(), incoming({name: 'b.txt', path: ''})], [
      doc(),
      doc({id: 'd2', name: 'b.txt'}),
    ])
    // 行 0 改为覆盖（report.txt 键将让出）→ 行 1 的重命名不再需要避开它自己
    // （b.txt 本就是冲突键），但 report.txt 仍被覆盖行占位语义保护
    const rows = setRowAction(plan.rows, [doc(), doc({id: 'd2', name: 'b.txt'})], 0, 'overwrite')
    expect(rows[0]!.action).toBe('overwrite')
    expect(rows[0]!.renameTo).toBeUndefined()
    expect(rows[1]!.renameTo).toBe('b-1.txt')
    // 切回 rename：重新拿到最小空闲名
    const back = setRowAction(rows, [doc(), doc({id: 'd2', name: 'b.txt'})], 0, 'rename')
    expect(back[0]!.renameTo).toBe('report-1.txt')
  })

  it('skip 行不参与落点，但已占用的现有名仍被避开', () => {
    const plan = buildImportPlan([incoming()], [doc()])
    const rows = setRowAction(plan.rows, [doc()], 0, 'skip')
    expect(rows[0]!.action).toBe('skip')
    expect(rows[0]!.renameTo).toBeUndefined()
  })
})

describe('applyPreset', () => {
  const ann = (): import('../src/core/types').Annotation => ({
    id: 'a1',
    start: 0,
    end: 2,
    kind: 'suggestion',
    comment: 'c',
    status: 'open',
    source: 'manual',
    createdAt: 1,
    updatedAt: 1,
  })
  const existing = [
    doc({id: 'd-plain'}), // 无批注
    doc({id: 'd-ann', name: 'b.txt', annotations: [ann()]}), // 有批注
  ]
  const rowsOf = (): ImportRow[] =>
    buildImportPlan(
      [incoming(), incoming({name: 'b.txt'}), incoming({name: 'same.txt', text: '旧文本'})],
      [...existing, doc({id: 'd-same', name: 'same.txt', text: '旧文本'})],
    ).rows

  it('全部覆盖：所有冲突行 → overwrite；identical 不动', () => {
    const rows = applyPreset(rowsOf(), [...existing, doc({id: 'd-same', name: 'same.txt', text: '旧文本'})], 'overwrite-all')
    expect(rows.map((r) => r.action)).toEqual(['overwrite', 'overwrite', 'identical'])
  })

  it('覆盖未标注的：只覆盖无批注文档；有批注的保持原决策', () => {
    const rows = applyPreset(rowsOf(), [...existing, doc({id: 'd-same', name: 'same.txt', text: '旧文本'})], 'overwrite-unannotated')
    expect(rows.map((r) => r.action)).toEqual(['overwrite', 'rename', 'identical'])
  })

  it('覆盖标注的：只覆盖带批注文档', () => {
    const rows = applyPreset(rowsOf(), [...existing, doc({id: 'd-same', name: 'same.txt', text: '旧文本'})], 'overwrite-annotated')
    expect(rows.map((r) => r.action)).toEqual(['rename', 'overwrite', 'identical'])
  })
})
