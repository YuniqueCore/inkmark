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
}

export class SidebarView {
  private root: HTMLElement
  private filter: StatusFilter = 'all'
  private activeId: string | null = null

  constructor(root: HTMLElement, private callbacks: SidebarCallbacks) {
    this.root = root
  }

  setFilter(filter: StatusFilter): void {
    this.filter = filter
  }

  setActive(id: string | null): void {
    this.activeId = id
  }

  render(text: string, annotations: Annotation[]): void {
    const open = annotations.filter((a) => a.status === 'open').length
    const shown = annotations.filter((a) => this.filter === 'all' || a.status === this.filter)

    const chips = (['all', 'open', 'resolved'] as StatusFilter[])
      .map(
        (f) =>
          `<button class="chip ${this.filter === f ? 'on' : ''}" data-filter="${f}">${
            f === 'all'
              ? `全部 ${annotations.length}`
              : f === 'open'
                ? `未解决 ${open}`
                : `已解决 ${annotations.length - open}`
          }</button>`,
      )
      .join('')

    const kinds = [...new Set(annotations.map((a) => a.kind))] as AnnotationKind[]
    const kindChips =
      kinds.length > 0
        ? `<div class="side-filters">${kinds
            .map((k) => `<span class="chip">${KIND_LABEL[k]}</span>`)
            .join('')}</div>`
        : ''

    const cards = shown.map((a) => this.renderCard(text, a)).join('')

    this.root.innerHTML = `
      <div class="side-head">
        <h3>批注</h3>
        <span class="count">${open} 条待处理</span>
      </div>
      <div class="side-filters">${chips}</div>
      ${kindChips}
      ${shown.length === 0 ? '<div class="side-empty">划选正文文字，或运行 slop 预扫描</div>' : cards}
    `

    this.root.querySelectorAll('[data-filter]').forEach((btn) =>
      btn.addEventListener('click', () =>
        this.callbacks.onFilterChange((btn as HTMLElement).dataset.filter as StatusFilter),
      ),
    )
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
    const slopInfo = a.meta ? `<span class="badge k-slop">${escapeHtml(a.meta.label)}</span>` : ''
    return `
      <div class="ann-card ${a.status === 'resolved' ? 'resolved' : ''} ${this.activeId === a.id ? 'active' : ''}" data-id="${a.id}">
        <div class="meta">
          <span class="badge k-${a.kind}">${KIND_LABEL[a.kind]}</span>
          ${slopInfo}
        </div>
        <blockquote class="quote" data-op="focus">“${escapeHtml(quote)}”</blockquote>
        <div class="comment">${escapeHtml(a.comment)}</div>
        <div class="ops">
          <button class="btn" data-op="focus">定位</button>
          <button class="btn" data-op="edit">编辑</button>
          <button class="btn" data-op="toggle">${a.status === 'open' ? '解决' : '重开'}</button>
          <button class="btn" data-op="delete">删除</button>
        </div>
      </div>`
  }
}
