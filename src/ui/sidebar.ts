/** 侧栏：批注列表、筛选、单条/分组操作。搜索与批量批注在 ⌘F 面板（search-panel.ts）。

 * 批量批注模型：N 条共享 groupId 的一阶批注在列表里聚合为一张卡
 * （统计 + 展开跳转）；聚合是派生状态，不复制可变状态。
 */

import { snippet } from '../core/text'
import { reportCategoryCounts } from '../core/slop'
import type { SlopBand, SlopReport, SlopSample } from '../core/types'
import { ALL_KINDS, KIND_LABEL, MANUAL_KINDS } from '../core/types'
import type { Annotation, AnnotationKind } from '../core/types'
import { escapeHtml } from '../core/text'
import { icon } from './icons'

export type StatusFilter = 'all' | 'open' | 'resolved'

export interface SidebarCallbacks {
  onFocus: (id: string) => void
  onEdit: (a: Annotation) => void
  onDelete: (ids: string[]) => void
  onToggleStatus: (ids: string[]) => void
  onOpenSearch: () => void
  onFilterChange: (filter: StatusFilter) => void
  onKindFilterChange: (kinds: Set<AnnotationKind>) => void
  onHighlightModeChange: (only: boolean) => void
  /** 轻量操作反馈（快速选中无匹配等）：main 侧接 toast */
  onNotify?: (msg: string) => void
}

export interface SidebarRenderOptions {
  /** AI 改稿全文：改稿侧批注（target === 'revised'）的摘录来源 */
  revised?: string
  /** 最近一次 slop 扫描报告（当前文档）：有则展示评分统计卡 */
  slop?: SlopReport | null
  /** 评分历史采样：≥2 个时统计卡展示趋势线与环比 */
  slopHistory?: SlopSample[]
}

/** 分档 → 徽标配色（亮暗主题都够对比） */
const BAND_STYLE: Record<SlopBand, string> = {
  clean: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400',
  light: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  noticeable: 'bg-orange-500/15 text-orange-700 dark:text-orange-400',
  heavy: 'bg-destructive/12 text-destructive',
}

const BAND_LABEL: Record<SlopBand, string> = {
  clean: '干净',
  light: '轻微',
  noticeable: '明显',
  heavy: '严重',
}

/** 列表项：单条批注，或同 groupId 的批量批注聚合 */
type ListItem = { kind: 'single'; ann: Annotation } | { kind: 'group'; members: Annotation[] }

export class SidebarView {
  private root: HTMLElement
  private filter: StatusFilter = 'all'
  /** 空 set = 全部类型；否则只显示勾选类型 */
  private kindFilter: Set<AnnotationKind> = new Set()
  private onlyHighlightFiltered = false
  private activeId: string | null = null
  /** 展开的批量批注组 */
  private expandedGroups = new Set<string>()
  /** 卡片多选（批注 id，组卡选中 = 全部成员 id）：重渲染时剪除已不存在的 */
  private selected = new Set<string>()
  /** 上次渲染的选中数：0 → N 的瞬间给操作簇挂滑入动画，避免每次勾选重放 */
  private prevSelectedSize = 0
  private lastArgs: { text: string; annotations: Annotation[]; opts: SidebarRenderOptions } = {
    text: '',
    annotations: [],
    opts: {},
  }

  constructor(root: HTMLElement, private callbacks: SidebarCallbacks) {
    this.root = root
  }

  setFilter(filter: StatusFilter): void {
    this.filter = filter
  }

  setKindFilter(kinds: Set<AnnotationKind>): void {
    this.kindFilter = kinds
  }

  setHighlightMode(only: boolean): void {
    this.onlyHighlightFiltered = only
  }

  /** 把类型并入当前筛选并返回新集合（调用方据此触发重渲染） */
  includeKind(kind: AnnotationKind): Set<AnnotationKind> {
    const next = new Set(this.kindFilter)
    next.add(kind)
    this.kindFilter = next
    return next
  }

  /** 当前筛选下的可见批注（列表与编辑器高亮共用同一份判定） */
  visibleOf(annotations: Annotation[]): Annotation[] {
    return annotations.filter(
      (a) =>
        (this.filter === 'all' || a.status === this.filter) &&
        (this.kindFilter.size === 0 || this.kindFilter.has(a.kind)),
    )
  }

  setActive(id: string | null): void {
    this.activeId = id
  }

  render(text: string, annotations: Annotation[], opts: SidebarRenderOptions = {}): void {
    this.lastArgs = { text, annotations, opts }
    const open = annotations.filter((a) => a.status === 'open').length
    const shown = this.visibleOf(annotations)
    // 选中集合剪除已不存在的批注（删除/重锚 id 不变，删除才失效）
    const existing = new Set(annotations.map((a) => a.id))
    for (const id of this.selected) if (!existing.has(id)) this.selected.delete(id)
    const selectedAnns = annotations.filter((a) => this.selected.has(a.id))
    const selectedAnyOpen = selectedAnns.some((a) => a.status === 'open')
    const popIn = this.prevSelectedSize === 0 && this.selected.size > 0
    this.prevSelectedSize = this.selected.size

    const chips = (['all', 'open', 'resolved'] as StatusFilter[])
      .map(
        (f) =>
          `<button class="chip-toggle ${this.filter === f ? 'on' : ''}" data-filter="${f}">${
            f === 'all'
              ? `全部 ${annotations.length}`
              : f === 'open'
                ? `未解决 ${open}`
                : `已解决 ${annotations.length - open}`
          }</button>`,
      )
      .join('')

    // 类型筛选 chips 与撰写卡同一套清单：人工四类常驻（含 0 计数），
    // 扫描/遗留类型（问题/AI 味）存在或正被筛选时才出现——行内容稳定、又不丢机器类型的筛选入口
    const countOf = (k: AnnotationKind) => annotations.filter((a) => a.kind === k).length
    const isManual = (k: AnnotationKind) => (MANUAL_KINDS as readonly string[]).includes(k)
    const chipKinds = ALL_KINDS.filter(
      (k) => isManual(k) || countOf(k) > 0 || this.kindFilter.has(k),
    )
    const kindChips = chipKinds
      .map(
        (k) =>
          `<button class="chip-toggle kind-chip ${this.kindFilter.has(k) ? 'on' : ''}" data-kind="${k}">
             ${KIND_LABEL[k]} <span class="opacity-60">${countOf(k)}</span>
           </button>`,
      )
      .join('')

    const items = buildListItems(shown)
    const cards = items
      .map((item) =>
        item.kind === 'single'
          ? this.renderCard(sourceTextFor(item.ann, text, opts), item.ann)
          : this.renderGroupCard(item.members, text, opts),
      )
      .join('')

    const strip =
      annotations.length === 0
        ? ''
        : `
      <div class="mb-2 flex items-center gap-1.5 rounded-lg border bg-muted/40 px-2 py-1.5" data-bulk-strip>
        <label class="flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-muted-foreground">
          <input type="checkbox" data-select-all class="size-3 accent-[var(--primary)]" ${this.selected.size === annotations.length && annotations.length > 0 ? 'checked' : ''}/> 全选
        </label>
        <button type="button" data-select-invert class="shrink-0 text-[11px] text-muted-foreground transition-colors hover:text-foreground" title="反选：选中未勾选的，取消已勾选的">反选</button>
        <select data-quick-select class="h-6 min-w-0 flex-1 rounded-md border border-input bg-card px-1 text-[11px] text-muted-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40" aria-label="快速选中">
          <option value="" disabled selected>快速选中…</option>
          <option value="lost">失锚批注</option>
          <option value="open">未解决</option>
          <option value="resolved">已解决</option>
          <option value="revised">改稿侧</option>
          ${chipKinds.map((k) => `<option value="kind:${k}">${KIND_LABEL[k]}</option>`).join('')}
        </select>
        ${
          this.selected.size > 0
            ? `<div class="flex shrink-0 items-center gap-1 ${popIn ? 'bulk-pop' : ''}" data-bulk-actions>
                 <span class="text-[11px] text-muted-foreground">已选 ${this.selected.size}</span>
                 <button type="button" class="btn btn-outline btn-sm h-6 px-2 text-[11px]" data-bulk="resolve">${selectedAnyOpen ? '解决' : '重开'}</button>
                 <button type="button" class="btn btn-outline btn-sm h-6 px-2 text-[11px] text-destructive hover:text-destructive" data-bulk="delete">删除</button>
                 <button type="button" class="btn btn-ghost btn-sm h-6 w-6 p-0" data-bulk="clear" title="取消选择" aria-label="取消选择">${icon('x', 'size-3')}</button>
               </div>`
            : ''
        }
      </div>`

    this.root.innerHTML = `
      <div class="mb-3 flex items-baseline justify-between px-1">
        <h3 class="text-sm font-semibold tracking-tight">批注</h3>
        <span class="flex items-center gap-1">
          <button class="btn btn-ghost btn-sm h-7 w-7 p-0 text-muted-foreground" data-op="open-search" title="搜索与批量批注（⌘F）" aria-label="搜索与批量批注">${icon('search', 'size-3.5')}</button>
          <span class="text-xs text-muted-foreground">${open} 条待处理</span>
        </span>
      </div>
      ${opts.slop ? this.renderSlopCard(opts.slop, opts.slopHistory ?? []) : ''}
      <div class="mb-1.5 flex flex-wrap gap-1.5 px-1">${chips}</div>
      ${annotations.length > 0 && chipKinds.length > 0 ? `<div class="mb-2 flex flex-wrap gap-1 px-1">${kindChips}</div>` : ''}
      <div class="mb-3 flex items-center gap-2 px-1 text-xs text-muted-foreground">
        <button type="button" id="only-hl" role="switch" aria-checked="${this.onlyHighlightFiltered}" class="ui-switch" aria-label="正文只高亮当前筛选结果"></button>
        正文只高亮当前筛选结果
      </div>
      ${strip}
      ${items.length === 0
        ? `<div class="mt-16 rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
             划选正文写批注、点顶栏「slop 预扫描」，<br>或按 ⌘F 搜索后一键批量批注
           </div>`
        : `<div class="flex flex-col gap-2.5 ${this.selected.size > 0 ? 'sel-active' : ''}">${cards}</div>`}
    `

    this.wireFilters()
    this.wireStrip(annotations)
    this.wireCards(items)
  }

  private rerender(): void {
    const { text, annotations, opts } = this.lastArgs
    this.render(text, annotations, opts)
  }

  // ---------------------------------------------------------------- 列表

  private wireFilters(): void {
    this.root.querySelector('[data-op="open-search"]')?.addEventListener('click', () => {
      this.callbacks.onOpenSearch()
    })
    this.root.querySelectorAll('[data-filter]').forEach((btn) =>
      btn.addEventListener('click', () =>
        this.callbacks.onFilterChange((btn as HTMLElement).dataset.filter as StatusFilter),
      ),
    )
    this.root.querySelectorAll('.kind-chip[data-kind]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const k = (chip as HTMLElement).dataset.kind as AnnotationKind
        const next = new Set(this.kindFilter)
        if (next.has(k)) next.delete(k)
        else next.add(k)
        this.callbacks.onKindFilterChange(next)
      })
    })
    this.root.querySelector('#only-hl')?.addEventListener('click', () => {
      this.callbacks.onHighlightModeChange(!this.onlyHighlightFiltered)
    })
  }

  /** 批量条：全选 / 反选 / 快速选中 selector / 批量解决·删除·清除 */
  private wireStrip(annotations: Annotation[]): void {
    this.root.querySelector('[data-select-all]')?.addEventListener('change', (e) => {
      const all = (e.target as HTMLInputElement).checked
      this.selected = all ? new Set(annotations.map((a) => a.id)) : new Set()
      this.rerender()
    })
    this.root.querySelector('[data-select-invert]')?.addEventListener('click', () => {
      this.selected = new Set(annotations.filter((a) => !this.selected.has(a.id)).map((a) => a.id))
      this.rerender()
    })
    const quick = this.root.querySelector('[data-quick-select]') as HTMLSelectElement | null
    quick?.addEventListener('change', () => {
      const v = quick.value
      quick.value = ''
      if (v === '') return
      const match = (a: Annotation): boolean =>
        v === 'lost'
          ? a.anchorLost === true
          : v === 'open' || v === 'resolved'
            ? a.status === v
            : v === 'revised'
              ? a.target === 'revised'
              : v.startsWith('kind:')
                ? a.kind === (v.slice(5) as AnnotationKind)
                : false
      const ids = annotations.filter(match).map((a) => a.id)
      if (ids.length === 0) {
        this.callbacks.onNotify?.('没有匹配的批注')
        return
      }
      for (const id of ids) this.selected.add(id)
      this.rerender()
    })
    this.root.querySelectorAll('[data-bulk]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const op = (btn as HTMLElement).dataset.bulk
        const ids = [...this.selected]
        if (ids.length === 0) return
        if (op === 'resolve') this.callbacks.onToggleStatus(ids)
        if (op === 'delete') this.callbacks.onDelete(ids)
        if (op === 'clear') {
          this.selected.clear()
          this.rerender()
        }
      })
    })
  }

  private wireCards(items: ListItem[]): void {
    for (const item of items) {
      if (item.kind === 'single') {
        this.wireSingleCard(item.ann)
      } else {
        this.wireGroupCard(item.members)
      }
    }
  }

  private wireSingleCard(a: Annotation): void {
    const card = this.root.querySelector(`.ann-card[data-id="${a.id}"]`)
    if (!card) return
    const check = card.querySelector('[data-select]') as HTMLInputElement | null
    check?.addEventListener('change', () => {
      if (check.checked) this.selected.add(a.id)
      else this.selected.delete(a.id)
      this.rerender()
    })
    // 勾选不触发展开卡片（定位批注）
    check?.addEventListener('click', (e) => e.stopPropagation())
    for (const btn of Array.from(card.querySelectorAll('[data-op]'))) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const op = (e.target as HTMLElement).dataset.op
        if (op === 'focus') this.callbacks.onFocus(a.id)
        if (op === 'edit') this.callbacks.onEdit(a)
        if (op === 'toggle') this.callbacks.onToggleStatus([a.id])
        if (op === 'delete') this.callbacks.onDelete([a.id])
      })
    }
    card.addEventListener('click', () => this.callbacks.onFocus(a.id))
  }

  private wireGroupCard(members: Annotation[]): void {
    const groupId = members[0]!.groupId!
    const card = this.root.querySelector(`.ann-card[data-group="${groupId}"]`)
    if (!card) return
    const ids = members.map((m) => m.id)
    const check = card.querySelector('[data-select-group]') as HTMLInputElement | null
    check?.addEventListener('change', () => {
      if (check.checked) for (const id of ids) this.selected.add(id)
      else for (const id of ids) this.selected.delete(id)
      this.rerender()
    })
    // 勾选不触发展开组卡
    check?.addEventListener('click', (e) => e.stopPropagation())
    card.querySelectorAll('[data-op="focus"]').forEach((btn) =>
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        this.callbacks.onFocus((btn as HTMLElement).dataset.id!)
      }),
    )
    card.querySelectorAll('[data-op="edit"]').forEach((btn) =>
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const member = members.find((m) => m.id === (btn as HTMLElement).dataset.id)
        if (member) this.callbacks.onEdit(member)
      }),
    )
    card.querySelector('[data-group-op="expand"]')?.addEventListener('click', () => {
      if (this.expandedGroups.has(groupId)) this.expandedGroups.delete(groupId)
      else this.expandedGroups.add(groupId)
      this.rerender()
    })
    card.querySelector('[data-group-op="toggle"]')?.addEventListener('click', () => {
      this.callbacks.onToggleStatus(ids)
    })
    card.querySelector('[data-group-op="delete"]')?.addEventListener('click', () => {
      this.callbacks.onDelete(ids)
    })
  }

  /** slop 评分统计卡：评分 / 环比 / 趋势线 / 分档 / 类目分布 */
  private renderSlopCard(report: SlopReport, history: SlopSample[]): string {
    const cats = reportCategoryCounts(report.hits)
    const top = cats
      .slice(0, 4)
      .map((c) => `${escapeHtml(c.label)} ×${c.count}`)
      .join(' · ')
    const rest = cats.length - Math.min(4, cats.length)
    const catLine =
      report.hits.length === 0
        ? '<div class="mt-1.5 text-xs text-muted-foreground">未发现候选信号</div>'
        : `<div class="mt-1.5 text-xs leading-relaxed text-muted-foreground">候选 ${report.hits.length} 处${top ? `：${top}` : ''}${rest > 0 ? ` 等 ${cats.length} 类` : ''}</div>`
    const trend = this.renderTrend(history)
    return `
      <div class="card mb-3 p-3">
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs font-medium text-muted-foreground">slop 评分</span>
          <span class="badge border-transparent ${BAND_STYLE[report.band]}">${BAND_LABEL[report.band]}</span>
        </div>
        <div class="mt-1 flex items-baseline gap-2">
          <span class="text-xl font-semibold tracking-tight">${report.score}</span>
          <span class="text-xs text-muted-foreground">/ 千单位（${report.units} 单位）</span>
          ${this.renderDelta(report.score, history)}
        </div>
        ${trend}
        ${catLine}
      </div>`
  }

  /** 环比：与上一次采样比较（分数越低越好） */
  private renderDelta(score: number, history: SlopSample[]): string {
    const prev = history[history.length - 2]
    if (!prev || prev.score === score) return ''
    const delta = +(score - prev.score).toFixed(1)
    return delta > 0
      ? `<span class="text-xs font-medium text-destructive" title="较上次上升 ${delta}">↑ ${delta}</span>`
      : `<span class="text-xs font-medium text-emerald-600 dark:text-emerald-400" title="较上次下降 ${Math.abs(delta)}">↓ ${Math.abs(delta)}</span>`
  }

  /** 评分趋势线：≥2 个采样点时画迷你折线 */
  private renderTrend(history: SlopSample[]): string {
    if (history.length < 2) return ''
    const scores = history.map((h) => h.score)
    const min = Math.min(...scores)
    const span = Math.max(Math.max(...scores) - min, 1)
    const w = 120
    const h = 24
    const pad = 2
    const points = scores
      .map((s, i) => {
        const x = pad + (i / (scores.length - 1)) * (w - pad * 2)
        const y = h - pad - ((s - min) / span) * (h - pad * 2)
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
    return `<svg viewBox="0 0 ${w} ${h}" class="mt-1.5 h-6 w-full text-muted-foreground" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`
  }

  private renderCard(text: string, a: Annotation): string {
    const quote = snippet(text, a.start, a.end, 90)
    const slopInfo = a.meta
      ? `<span class="badge border-transparent" style="color:var(--kind-slop);background:var(--kind-slop-bg)">${escapeHtml(a.meta.label)}</span>`
      : ''
    const active = this.activeId === a.id
    const selected = this.selected.has(a.id)
    return `
      <div class="card ann-card group p-3 transition-[background-color,border-color,box-shadow] ${a.status === 'resolved' ? 'opacity-60' : ''} ${active ? 'ring-2 ring-ring/40' : 'hover:shadow-md'} ${selected ? 'sel-on' : ''}" data-id="${a.id}">
        <div class="mb-1.5 flex items-center gap-1.5">
          <input type="checkbox" data-select="${a.id}" class="ann-check" ${selected ? 'checked' : ''} aria-label="选中该批注"/>
          <span class="badge border-transparent" style="color:var(--kind-${a.kind});background:var(--kind-${a.kind}-bg)">${KIND_LABEL[a.kind]}</span>
          ${slopInfo}
          ${a.target === 'revised' ? '<span class="badge border-sky-500/40 text-sky-600 dark:text-sky-400">改稿</span>' : ''}
          ${a.anchorLost ? '<span class="badge border-amber-500/40 text-amber-600 dark:text-amber-400" title="原引文已不在原文中，批注钉在改动处">失锚</span>' : ''}
          ${a.status === 'resolved' ? '<span class="badge bg-secondary text-secondary-foreground">已解决</span>' : ''}
        </div>
        <blockquote class="mb-1.5 cursor-pointer border-l-2 border-border pl-2 text-[13px] text-muted-foreground transition-colors hover:border-ring" data-op="focus">
          “${escapeHtml(quote)}”
        </blockquote>
        ${a.comment ? `<div class="whitespace-pre-wrap text-sm leading-relaxed">${escapeHtml(a.comment)}</div>` : ''}
        <div class="mt-2 flex gap-0.5">
          <button class="btn btn-ghost btn-sm h-7 px-2 text-xs" data-op="focus">定位</button>
          <button class="btn btn-ghost btn-sm h-7 px-2 text-xs" data-op="edit">编辑</button>
          <button class="btn btn-ghost btn-sm h-7 px-2 text-xs" data-op="toggle">${a.status === 'open' ? '解决' : '重开'}</button>
          <button class="btn btn-ghost btn-sm h-7 px-2 text-xs" data-op="delete">删除</button>
        </div>
      </div>`
  }

  /** 批量批注组卡：kind + N 处统计 + 批注语，展开逐条跳转 */
  private renderGroupCard(members: Annotation[], text: string, opts: SidebarRenderOptions): string {
    const first = members[0]!
    const groupId = first.groupId!
    const resolved = members.filter((m) => m.status === 'resolved').length
    const allResolved = resolved === members.length
    const anyOpen = resolved < members.length
    const expanded = this.expandedGroups.has(groupId)
    const active = members.some((m) => m.id === this.activeId)
    const rows = expanded
      ? `<div class="mt-2 flex flex-col gap-1">${members
          .map((m) => {
            const quote = snippet(sourceTextFor(m, text, opts), m.start, m.end, 60)
            return `<div class="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[13px] hover:bg-secondary/60">
              <button class="min-w-0 flex-1 truncate text-left text-muted-foreground transition-colors hover:text-foreground" data-op="focus" data-id="${m.id}" title="${escapeHtml(quote)}">“${escapeHtml(quote)}”</button>
              ${m.anchorLost ? '<span class="badge border-amber-500/40 text-amber-600 dark:text-amber-400">失锚</span>' : ''}
              ${m.status === 'resolved' ? '<span class="badge bg-secondary text-secondary-foreground">已解决</span>' : ''}
              <button class="btn btn-ghost btn-sm h-6 shrink-0 px-1.5 text-xs" data-op="edit" data-id="${m.id}">编辑</button>
            </div>`
          })
          .join('')}</div>`
      : ''
    return `
      <div class="card ann-card group p-3 transition-[background-color,border-color,box-shadow] ${allResolved ? 'opacity-60' : ''} ${active ? 'ring-2 ring-ring/40' : 'hover:shadow-md'} ${members.every((m) => this.selected.has(m.id)) ? 'sel-on' : ''}" data-group="${groupId}">
        <div class="flex items-center gap-1.5">
          <input type="checkbox" data-select-group class="ann-check" ${members.every((m) => this.selected.has(m.id)) ? 'checked' : ''} aria-label="选中该组全部批注"/>
          <button class="flex min-w-0 flex-1 items-center gap-1.5 text-left" data-group-op="expand">
            <span class="badge border-transparent" style="color:var(--kind-${first.kind});background:var(--kind-${first.kind}-bg)">${KIND_LABEL[first.kind]}</span>
            <span class="badge border-border bg-secondary text-secondary-foreground" title="一次搜索批量批注">${members.length} 处</span>
            ${resolved > 0 && !allResolved ? `<span class="text-xs text-muted-foreground">${resolved} 已解决</span>` : ''}
            ${allResolved ? '<span class="badge bg-secondary text-secondary-foreground">已解决</span>' : ''}
            <span class="ml-auto text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}">›</span>
          </button>
        </div>
        ${first.comment ? `<div class="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed">${escapeHtml(first.comment)}</div>` : ''}
        ${rows}
        <div class="mt-2 flex gap-0.5">
          <button class="btn btn-ghost btn-sm h-7 px-2 text-xs" data-group-op="toggle">${anyOpen ? '全部解决' : '重开'}</button>
          <button class="btn btn-ghost btn-sm h-7 px-2 text-xs btn-destructive" data-group-op="delete">删除</button>
        </div>
      </div>`
  }
}

// ---------------------------------------------------------------- 纯辅助

/** 批注锚定侧对应的摘录来源文本 */
function sourceTextFor(a: Annotation, text: string, opts: SidebarRenderOptions): string {
  return a.target === 'revised' ? (opts.revised ?? '') : text
}

/** 可见批注 → 列表项：无 groupId 的单条 + 同 groupId 聚合，按位置排序 */
function buildListItems(shown: Annotation[]): ListItem[] {
  const items: ListItem[] = []
  const groupIndex = new Map<string, Annotation[]>()
  for (const a of shown) {
    if (a.groupId === undefined) {
      items.push({ kind: 'single', ann: a })
      continue
    }
    const members = groupIndex.get(a.groupId) ?? []
    members.push(a)
    groupIndex.set(a.groupId, members)
  }
  const groupItems: ListItem[] = [...groupIndex.values()].map((members) => ({
    kind: 'group' as const,
    members: [...members].sort((x, y) => x.start - y.start),
  }))
  return [...items, ...groupItems].sort(
    (x, y) => firstStart(x) - firstStart(y),
  )
}

function firstStart(item: ListItem): number {
  return item.kind === 'single' ? item.ann.start : item.members[0]!.start
}
