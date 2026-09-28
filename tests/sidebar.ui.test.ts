// @vitest-environment happy-dom
/** UI 层回归测试：侧栏失锚徽标、评分趋势卡、类型 chips 统一、卡片多选与批量操作。
 * 断言锚点：失锚徽标；趋势线；种类 chips 只出现卡片实际拥有的类型；
 * 勾选驱动批量簇出现/消失且不触发卡片定位；反选与快速选中 selector；开关 toggle。
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SidebarView } from '../src/ui/sidebar'
import type { Annotation, DocItem, SlopSample } from '../src/core/types'

let root: HTMLElement
let sidebar: SidebarView
const notify: string[] = []

beforeEach(() => {
  document.body.innerHTML = ''
  notify.length = 0
  root = document.createElement('div')
  document.body.append(root)
  sidebar = new SidebarView(root, {
    onFocus: () => {},
    onEdit: () => {},
    onDelete: () => {},
    onToggleStatus: () => {},
    onOpenSearch: () => {},
    onFilterChange: () => {},
    onKindFilterChange: () => {},
    onHighlightModeChange: () => {},
    onNotify: (m) => notify.push(m),
  })
})

const ann = (over: Partial<Annotation> = {}): Annotation => ({
  id: 'a1',
  start: 0,
  end: 4,
  kind: 'issue',
  comment: '批注内容',
  status: 'open',
  source: 'manual',
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

const doc = (annotations: Annotation[]): DocItem => ({
  id: 'doc-1',
  name: '测试文档',
  path: '',
  text: '被批注的正文内容。',
  annotations,
  addedAt: 1,
})

const sample = (score: number): SlopSample => ({ at: 1, score, band: 'light', units: 100 })

describe('侧栏失锚徽标', () => {
  it('anchorLost 批注渲染「失锚」徽标，正常批注不渲染', () => {
    sidebar.render(doc([]).text, [ann({ anchorLost: true }), ann({ id: 'a2', comment: '正常' })], {})
    const badges = [...root.querySelectorAll('.ann-card')].map(
      (c) => c.querySelector('.badge.border-amber-500\\/40')?.textContent ?? null,
    )
    expect(badges).toEqual(['失锚', null])
  })
})

describe('批量批注分组卡', () => {
  it('同 groupId 聚合为一张卡：N 处统计，展开逐条摘录，不同组各成卡', () => {
    const a1 = ann({ id: 'g1', start: 0, end: 3, groupId: 'batch-1' })
    const a2 = ann({ id: 'g2', start: 4, end: 6, groupId: 'batch-1' })
    const a3 = ann({ id: 'g3', start: 7, end: 9, groupId: 'batch-2' })
    sidebar.render(doc([a1, a2, a3]).text, [a1, a2, a3], {})
    expect(root.querySelectorAll('.ann-card').length).toBe(2)
    const groupCard = root.querySelector('.ann-card[data-group="batch-1"]')!
    expect(groupCard.textContent).toContain('2 处')
    // 折叠态没有逐条跳转行
    expect(groupCard.querySelectorAll('[data-op="focus"]').length).toBe(0)

    ;(groupCard.querySelector('[data-group-op="expand"]') as HTMLElement).click()
    const expanded = root.querySelector('.ann-card[data-group="batch-1"]')!
    expect(expanded.querySelectorAll('[data-op="focus"]').length).toBe(2)
  })
})

describe('侧栏评分趋势卡', () => {
  it('历史 ≥2 时渲染趋势折线与环比升降', () => {
    const history = [sample(3), sample(5), sample(2)]
    sidebar.render(doc([ann()]).text, [ann()], { slop: { hits: [], units: 100, score: 2, band: 'light' }, slopHistory: history })
    expect(root.querySelector('svg polyline')).toBeTruthy()
    // 最新 2 分 < 上次 5 分 → 下降（emerald）
    expect(root.querySelector('.text-emerald-600')?.textContent).toContain('↓')
  })

  it('历史不足 2 个时不渲染趋势线与环比', () => {
    sidebar.render(doc([ann()]).text, [ann()], { slop: { hits: [], units: 100, score: 3, band: 'light' }, slopHistory: [sample(3)] })
    expect(root.querySelector('svg polyline')).toBeNull()
    expect(root.querySelector('.text-emerald-600')).toBeNull()
    expect(root.querySelector('.text-destructive.text-xs')).toBeNull()
  })

  it('分数上升渲染为破坏性颜色（分数越高越差）', () => {
    sidebar.render(doc([ann()]).text, [ann()], { slop: { hits: [], units: 100, score: 6, band: 'noticeable' }, slopHistory: [sample(3), sample(6)] })
    expect(root.querySelector('.text-destructive')?.textContent).toContain('↑')
  })
})

/** 勾选卡片勾选框：click 切换 + 显式派发 change（与 filetree 测试同一模式） */
const checkCard = (selector: string): void => {
  const box = root.querySelector(selector) as HTMLInputElement
  box.click()
  box.dispatchEvent(new Event('change'))
}

describe('类型 chips 与撰写卡一致', () => {
  it('人工四类常驻（含 0 计数），机器类型存在时才追加', () => {
    sidebar.render(
      doc([ann({ kind: 'issue' }), ann({ id: 'a2', kind: 'issue' }), ann({ id: 'a3', kind: 'praise' })]).text,
      [ann({ kind: 'issue' }), ann({ id: 'a2', kind: 'issue' }), ann({ id: 'a3', kind: 'praise' })],
      {},
    )
    const kinds = [...root.querySelectorAll('.kind-chip')].map((c) => c.getAttribute('data-kind'))
    // ALL_KINDS 规范顺序：人工四类（含 0 计数的建议/疑问/重点）在前，存在的「问题」追加在后
    expect(kinds).toEqual(['suggestion', 'question', 'highlight', 'praise', 'issue'])
    expect(root.querySelector('.kind-chip[data-kind="highlight"]')?.textContent).toContain('0')
    expect(root.querySelector('.kind-chip[data-kind="issue"]')?.textContent).toContain('2')
    // AI 味不存在 → 不出现
    expect(root.querySelector('.kind-chip[data-kind="slop"]')).toBeNull()
  })

  it('正被筛选的机器类型保留 0 计数 chip 以便取消', () => {
    sidebar.setKindFilter(new Set(['slop' as const]))
    sidebar.render(doc([ann({ kind: 'issue' })]).text, [ann({ kind: 'issue' })], {})
    const kinds = [...root.querySelectorAll('.kind-chip')].map((c) => c.getAttribute('data-kind'))
    expect(kinds).toEqual(['suggestion', 'question', 'highlight', 'praise', 'issue', 'slop'])
    expect(root.querySelector('.kind-chip[data-kind="slop"]')?.textContent).toContain('0')
  })

  it('无批注时不渲染类型 chips 行', () => {
    sidebar.render(doc([]).text, [], {})
    expect(root.querySelector('.kind-chip')).toBeNull()
  })
})

describe('侧栏卡片多选与批量操作', () => {
  const three = (): Annotation[] => [
    ann({ id: 'a1', kind: 'issue' }),
    ann({ id: 'a2', kind: 'suggestion', start: 5, end: 8 }),
    ann({ id: 'a3', kind: 'praise', start: 9, end: 12, anchorLost: true }),
  ]

  it('勾选出现批量簇并显示计数；再勾选累加；清除后消失', () => {
    sidebar.render(doc(three()).text, three(), {})
    expect(root.querySelector('[data-bulk-actions]')).toBeNull()
    checkCard('[data-select="a1"]')
    expect(root.querySelector('[data-bulk-actions]')?.textContent).toContain('已选 1')
    checkCard('[data-select="a2"]')
    expect(root.querySelector('[data-bulk-actions]')?.textContent).toContain('已选 2')
    ;(root.querySelector('[data-bulk="clear"]') as HTMLButtonElement).click()
    expect(root.querySelector('[data-bulk-actions]')).toBeNull()
  })

  it('勾选不触发卡片定位（focus）', () => {
    const focused: string[] = []
    sidebar = new SidebarView(root, {
      onFocus: (id) => focused.push(id),
      onEdit: () => {},
      onDelete: () => {},
      onToggleStatus: () => {},
      onOpenSearch: () => {},
      onFilterChange: () => {},
      onKindFilterChange: () => {},
      onHighlightModeChange: () => {},
      onNotify: () => {},
    })
    sidebar.render(doc(three()).text, three(), {})
    checkCard('[data-select="a1"]')
    expect(focused).toEqual([])
  })

  it('批量解决 / 删除回调携带选中 id；删除后选择剪除', () => {
    const calls: {op: string; ids: string[]}[] = []
    sidebar = new SidebarView(root, {
      onFocus: () => {},
      onEdit: () => {},
      onDelete: (ids) => calls.push({op: 'delete', ids}),
      onToggleStatus: (ids) => calls.push({op: 'toggle', ids}),
      onOpenSearch: () => {},
      onFilterChange: () => {},
      onKindFilterChange: () => {},
      onHighlightModeChange: () => {},
      onNotify: () => {},
    })
    const anns = three()
    sidebar.render(doc(anns).text, anns, {})
    checkCard('[data-select="a1"]')
    checkCard('[data-select="a3"]')
    // 全选未选中的 a2 后全量批量：解决按钮回调带全部 id
    ;(root.querySelector('[data-bulk="resolve"]') as HTMLButtonElement).click()
    expect(calls[0]).toEqual({op: 'toggle', ids: ['a1', 'a3']})
    ;(root.querySelector('[data-bulk="delete"]') as HTMLButtonElement).click()
    expect(calls[1]).toEqual({op: 'delete', ids: ['a1', 'a3']})
  })

  it('全选勾满、反选翻转', () => {
    sidebar.render(doc(three()).text, three(), {})
    ;(root.querySelector('[data-select-all]') as HTMLInputElement).click()
    ;(root.querySelector('[data-select-all]') as HTMLInputElement).dispatchEvent(new Event('change'))
    expect(root.querySelector('[data-bulk-actions]')?.textContent).toContain('已选 3')
    // 反选：3 → 0，批量簇随选中清空而隐藏
    ;(root.querySelector('[data-select-invert]') as HTMLButtonElement).click()
    expect(root.querySelector('[data-bulk-actions]')).toBeNull()
    // 再反选回全选
    ;(root.querySelector('[data-select-invert]') as HTMLButtonElement).click()
    expect(root.querySelector('[data-bulk-actions]')?.textContent).toContain('已选 3')
  })

  it('快速选中 selector：失锚 / 类型 / 无匹配反馈', () => {
    sidebar.render(doc(three()).text, three(), {})
    const select = () => root.querySelector('[data-quick-select]') as HTMLSelectElement
    select().value = 'lost'
    select().dispatchEvent(new Event('change'))
    expect(root.querySelector('[data-bulk-actions]')?.textContent).toContain('已选 1')
    // 累加：再快速选中「问题」类型 → a1（已是选中）+ 无其他 → 仍 1；选「建议」→ a2
    select().value = 'kind:suggestion'
    select().dispatchEvent(new Event('change'))
    expect(root.querySelector('[data-bulk-actions]')?.textContent).toContain('已选 2')
    // 无匹配 → onNotify
    select().value = 'revised'
    select().dispatchEvent(new Event('change'))
    expect(notify).toEqual(['没有匹配的批注'])
    expect(select().value).toBe('') // 复位到占位项
  })

  it('组卡勾选 = 全部成员 id；组内部分选中时勾选框不勾', () => {
    const a1 = ann({ id: 'g1', start: 0, end: 3, groupId: 'batch-1' })
    const a2 = ann({ id: 'g2', start: 4, end: 6, groupId: 'batch-1' })
    const calls: string[][] = []
    sidebar = new SidebarView(root, {
      onFocus: () => {},
      onEdit: () => {},
      onDelete: () => {},
      onToggleStatus: (ids) => calls.push(ids),
      onOpenSearch: () => {},
      onFilterChange: () => {},
      onKindFilterChange: () => {},
      onHighlightModeChange: () => {},
      onNotify: () => {},
    })
    sidebar.render(doc([a1, a2]).text, [a1, a2], {})
    checkCard('[data-select-group]')
    expect(root.querySelector('[data-bulk-actions]')?.textContent).toContain('已选 2')
    ;(root.querySelector('[data-bulk="resolve"]') as HTMLButtonElement).click()
    expect(calls[0]).toEqual(['g1', 'g2'])
  })
})

describe('正文只高亮开关', () => {
  it('点击开关切换 aria-checked 并上抛状态', () => {
    const modes: boolean[] = []
    sidebar = new SidebarView(root, {
      onFocus: () => {},
      onEdit: () => {},
      onDelete: () => {},
      onToggleStatus: () => {},
      onOpenSearch: () => {},
      onFilterChange: () => {},
      onKindFilterChange: () => {},
      onHighlightModeChange: (only) => modes.push(only),
      onNotify: () => {},
    })
    sidebar.render(doc([ann()]).text, [ann()], {})
    const sw = root.querySelector('#only-hl') as HTMLButtonElement
    expect(sw.getAttribute('role')).toBe('switch')
    expect(sw.getAttribute('aria-checked')).toBe('false')
    sw.click()
    expect(modes).toEqual([true])
    sidebar.setHighlightMode(true)
    sidebar.render(doc([ann()]).text, [ann()], {})
    expect((root.querySelector('#only-hl') as HTMLButtonElement).getAttribute('aria-checked')).toBe('true')
  })
})
