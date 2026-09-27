// @vitest-environment happy-dom
/** UI 层回归测试：侧栏失锚徽标与 slop 评分趋势卡。
 * 断言锚点：失锚批注渲染「失锚」徽标；评分历史 ≥2 时统计卡出现趋势线与环比。
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SidebarView } from '../src/ui/sidebar'
import type { Annotation, DocItem, SlopSample } from '../src/core/types'

let root: HTMLElement
let sidebar: SidebarView

beforeEach(() => {
  document.body.innerHTML = ''
  root = document.createElement('div')
  document.body.append(root)
  sidebar = new SidebarView(root, {
    onFocus: () => {},
    onEdit: () => {},
    onDelete: () => {},
    onToggleStatus: () => {},
    onFilterChange: () => {},
    onKindFilterChange: () => {},
    onHighlightModeChange: () => {},
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
