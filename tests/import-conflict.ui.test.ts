// @vitest-environment happy-dom
/** UI 层回归测试：导入冲突诊断树——分组呈现、逐行动作、批量预设、取消/确认契约。 */

import { beforeEach, describe, expect, it } from 'vitest'
import { buildImportPlan, type ImportRow } from '../src/core/import-conflict'
import { importConflictDialog } from '../src/ui/import-conflict-dialog'
import type { Annotation, DocItem } from '../src/core/types'

const ann = (id: string): Annotation => ({
  id,
  start: 0,
  end: 2,
  kind: 'suggestion',
  comment: 'c',
  status: 'open',
  source: 'manual',
  createdAt: 1,
  updatedAt: 1,
})

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

let panel: HTMLElement

beforeEach(() => {
  document.body.innerHTML = ''
})

/** 打开诊断树：弹层同步挂载，返回其 Promise（null = 取消）。 */
const open = (
  plan = buildImportPlan([incoming()], [doc()]),
  existing = [doc()],
): Promise<ImportRow[] | null> => {
  const p = importConflictDialog(plan, existing)
  panel = document.querySelector('[role="dialog"]') as HTMLElement
  return p
}

const rowEls = (): HTMLElement[] => [...panel.querySelectorAll('[data-row]')] as HTMLElement[]
const rowAction = (row: HTMLElement, action: string): void => {
  ;(row.querySelector(`[data-action="${action}"]`) as HTMLElement).click()
}
const preset = (i: number): void =>
  (panel.querySelector(`[data-preset="${i}"]`) as HTMLElement).click()

describe('导入冲突诊断树', () => {
  it('只呈现冲突行并按路径分组；identical 行标「无变化」且无动作控件', () => {
    const existing = [doc(), doc({id: 'd2', name: 'b.txt'}), doc({id: 'd3', name: 'same.txt', text: '旧文本'})]
    open(
      buildImportPlan(
        [
          incoming(),
          incoming({name: 'b.txt'}),
          incoming({name: 'same.txt', text: '旧文本'}),
          incoming({name: 'fresh.txt'}),
        ],
        existing,
      ),
      existing,
    )

    expect(rowEls().length).toBe(3) // fresh.txt（direct）不进树
    expect(panel.textContent).toContain('（根目录）')
    expect(panel.textContent).toContain('2 个同名冲突') // identical 不占冲突数
    const identical = rowEls()[2]!
    expect(identical.textContent).toContain('无变化')
    expect(identical.querySelector('[data-action]')).toBeNull()
  })

  it('逐行动作：默认重命名显示落点；覆盖后摘要联动；确认返回最终行动', async () => {
    const p = open()
    const row = rowEls()[0]!
    expect(row.textContent).toContain('→ report-1.txt')

    rowAction(row, 'overwrite')
    expect(rowEls()[0]!.querySelector('[data-action="overwrite"].on')).toBeTruthy()
    expect(panel.querySelector('[data-role="summary"]')!.textContent).toContain('覆盖 1')

    ;(panel.querySelector('[data-op="confirm"]') as HTMLElement).click()
    const rows = await p
    expect(rows!.length).toBe(1)
    expect(rows![0]!.action).toBe('overwrite')
  })

  it('全部行 skip 时确认按钮禁用；取消解析为 null（整次作废）', async () => {
    const p = open()
    rowAction(rowEls()[0]!, 'skip')
    const confirm = panel.querySelector('[data-op="confirm"]') as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    // 切回覆盖恢复可用
    rowAction(rowEls()[0]!, 'overwrite')
    expect(confirm.disabled).toBe(false)

    ;(panel.querySelector('[data-op="cancel"]') as HTMLElement).click()
    expect(await p).toBeNull()
  })

  it('批量预设：全部覆盖 / 覆盖未标注的 / 覆盖标注的，identical 永不触碰', async () => {
    const existing = [
      doc({id: 'd-plain'}),
      doc({id: 'd-ann', name: 'b.txt', annotations: [ann('a1')]}),
      doc({id: 'd-same', name: 'same.txt', text: '旧文本'}),
    ]
    const p = open(
      buildImportPlan(
        [incoming(), incoming({name: 'b.txt'}), incoming({name: 'same.txt', text: '旧文本'})],
        existing,
      ),
      existing,
    )

    // 覆盖未标注的：report.txt（无批注）→ 覆盖；b.txt（有批注）保持 rename
    preset(1)
    expect(rowEls()[0]!.querySelector('[data-action="overwrite"].on')).toBeTruthy()
    expect(rowEls()[1]!.querySelector('[data-action="rename"].on')).toBeTruthy()

    // 覆盖标注的：b.txt → 覆盖；report.txt 不在预设范围内，保持上一步的决策
    preset(2)
    expect(rowEls()[0]!.querySelector('[data-action="overwrite"].on')).toBeTruthy()
    expect(rowEls()[1]!.querySelector('[data-action="overwrite"].on')).toBeTruthy()

    // 全部覆盖：两行都覆盖，identical 行不动
    preset(0)
    expect(rowEls()[0]!.querySelector('[data-action="overwrite"].on')).toBeTruthy()
    expect(rowEls()[1]!.querySelector('[data-action="overwrite"].on')).toBeTruthy()
    expect(rowEls()[2]!.querySelector('[data-action]')).toBeNull()

    ;(panel.querySelector('[data-op="confirm"]') as HTMLElement).click()
    const rows = await p
    expect(rows!.map((r) => r.action)).toEqual(['overwrite', 'overwrite', 'identical'])
  })

  it('有批注的行选覆盖：徽标预告重锚/失锚条数（先知情再确认）', () => {
    // 旧文本含引文，新文本删掉它 → 该批注将失锚
    open(
      buildImportPlan([incoming({text: '全新文本没有引文'})], [
        doc({text: '保持这段引文', annotations: [ann('a1')]}),
      ]),
    )
    rowAction(rowEls()[0]!, 'overwrite')
    expect(rowEls()[0]!.textContent).toContain('失锚 1')
  })
})
