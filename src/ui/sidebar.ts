/** 侧栏：批注列表、筛选、单条操作。 */

import { snippet } from '../core/text'
import type { Annotation, AnnotationKind } from '../core/types'
import { escapeHtml, KIND_LABEL } from './editor'

export type StatusFilter = 'all' | 'open' | 'resolved'

export interface SidebarCallbacks {
  onFocus: (id: string) => void
  onEdit: (a: Annotation) => void
  onDelete: (id: string) => void
  onToggleStatus: (id: string) => void
  onFilterChange: (filter: StatusFilter) => void
  onKindFilterChange: (kinds: Set<AnnotationKind>) => void
  onHighlightModeChange: (only: boolean) => void
}

const ALL_KINDS: AnnotationKind[] = ['issue', 'suggestion', 'question', 'highlight', 'praise', 'slop']

export class SidebarView {
  private root: HTMLElement
  private filter: StatusFilter = 'all'
  /** 空 set = 全部类型；否则只显示勾选类型 */
  private kindFilter: Set<AnnotationKind> = new Set()
  private onlyHighlightFiltered = false
  private activeId: string | null = null

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

  render(text: string, annotations: Annotation[]): void {
    const open = annotations.filter((a) => a.status === 'open').length
    const shown = this.visibleOf(annotations)

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

    // 六类类型筛选 chips：始终全部展示，on 态用对应标注色
    const countOf = (k: AnnotationKind) => annotations.filter((a) => a.kind === k).length
    const kindChips = ALL_KINDS.map(
      (k) =>
        `<button class="chip-toggle kind-chip ${this.kindFilter.has(k) ? 'on' : ''}" data-kind="${k}">
           ${KIND_LABEL[k]} <span class="opacity-60">${countOf(k)}</span>
         </button>`,
    ).join('')

    const cards = shown.map((a) => this.renderCard(text, a)).join('')

    this.root.innerHTML = `
      <div class="mb-3 flex items-baseline justify-between px-1">
        <h3 class="text-sm font-semibold tracking-tight">批注</h3>
        <span class="text-xs text-muted-foreground">${open} 条待处理</span>
      </div>
      <div class="mb-1.5 flex flex-wrap gap-1.5 px-1">${chips}</div>
      <div class="mb-2 flex flex-wrap gap-1 px-1">${kindChips}</div>
      <label class="mb-3 flex cursor-pointer items-center gap-2 px-1 text-xs text-muted-foreground">
        <input type="checkbox" id="only-hl" class="size-3.5 accent-[var(--primary)]" ${this.onlyHighlightFiltered ? 'checked' : ''}/>
        正文只高亮当前筛选结果
      </label>
      ${shown.length === 0
        ? `<div class="mt-16 rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
             划选正文文字写批注，<br>或点顶栏「slop 预扫描」
           </div>`
        : `<div class="flex flex-col gap-2.5">${cards}</div>`}
    `

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
    this.root.querySelector('#only-hl')?.addEventListener('change', (e) => {
      this.callbacks.onHighlightModeChange((e.target as HTMLInputElement).checked)
    })
    for (const card of Array.from(this.root.querySelectorAll('.ann-card'))) {
      const id = (card as HTMLElement).dataset.id!
      const ann = annotations.find((x) => x.id === id)
      for (const btn of Array.from(card.querySelectorAll('[data-op]'))) {
        btn.addEventListener('click', (e) => {
          e.stopPropagation()
          const op = (e.target as HTMLElement).dataset.op
          if (op === 'focus') this.callbacks.onFocus(id)
          if (op === 'edit' && ann) this.callbacks.onEdit(ann)
          if (op === 'toggle') this.callbacks.onToggleStatus(id)
          if (op === 'delete') this.callbacks.onDelete(id)
        })
      }
      card.addEventListener('click', () => this.callbacks.onFocus(id))
    }
  }

  private renderCard(text: string, a: Annotation): string {
    const quote = snippet(text, a.start, a.end, 90)
    const slopInfo = a.meta
      ? `<span class="badge border-transparent" style="color:var(--kind-slop);background:var(--kind-slop-bg)">${escapeHtml(a.meta.label)}</span>`
      : ''
    const active = this.activeId === a.id
    return `
      <div class="card ann-card p-3 transition-shadow ${a.status === 'resolved' ? 'opacity-60' : ''} ${active ? 'ring-2 ring-ring/40' : 'hover:shadow-md'}" data-id="${a.id}">
        <div class="mb-1.5 flex items-center gap-1.5">
          <span class="badge border-transparent" style="color:var(--kind-${a.kind});background:var(--kind-${a.kind}-bg)">${KIND_LABEL[a.kind]}</span>
          ${slopInfo}
          ${a.status === 'resolved' ? '<span class="badge bg-secondary text-secondary-foreground">已解决</span>' : ''}
        </div>
        <blockquote class="mb-1.5 cursor-pointer border-l-2 border-border pl-2 text-[13px] text-muted-foreground transition-colors hover:border-ring" data-op="focus">
          “${escapeHtml(quote)}”
        </blockquote>
        <div class="whitespace-pre-wrap text-sm leading-relaxed">${escapeHtml(a.comment)}</div>
        <div class="mt-2 flex gap-0.5">
          <button class="btn btn-ghost btn-sm h-7 px-2 text-xs" data-op="focus">定位</button>
          <button class="btn btn-ghost btn-sm h-7 px-2 text-xs" data-op="edit">编辑</button>
          <button class="btn btn-ghost btn-sm h-7 px-2 text-xs" data-op="toggle">${a.status === 'open' ? '解决' : '重开'}</button>
          <button class="btn btn-ghost btn-sm btn-destructive h-7 px-2 text-xs" data-op="delete">删除</button>
        </div>
      </div>`
  }
}
