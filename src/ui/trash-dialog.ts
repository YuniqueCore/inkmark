/** 回收站弹层：文档与批注两种条目混排（按删除时间倒序），7 天保留。
 *
 * 支持 搜索过滤、多选批量（恢复 / 彻底删除）、单条操作、清空。
 * 彻底删除与清空的二次确认归调用方（main 走统一 confirmDialog），
 * 本组件只负责列表呈现与动作派发。DOM 自挂载于 body，Esc / 遮罩关闭。
 *
 * 渲染分两层：open() 建一次 shell（头部/搜索/批量条/列表容器/底栏），
 * 之后查询与勾选只重绘列表与状态条——输入框不重建，焦点与光标不丢。
 */

import {TrashList} from '../workbench/trash-list'
import { escapeHtml } from '../core/text'
import { TRASH_RETENTION_MS } from '../core/trash'
import type { TrashEntry } from '../core/types'
import { entryKey } from '../core/trash'
import { KIND_LABEL } from '../core/types'
import { icon } from './icons'

export interface TrashDialogCallbacks {
  onRestore: (keys: string[]) => void
  onPurge: (keys: string[]) => void
  onClearAll: () => void
  onClose: () => void
}

const DAY_MS = 24 * 60 * 60 * 1000

export class TrashDialog {
  private panel: HTMLElement | null = null
  private overlay: HTMLElement | null = null
  private listEl: HTMLElement | null = null
  private searchEl: HTMLInputElement | null = null
  private model = new TrashList()
  private lastNow = 0
  constructor(private callbacks: TrashDialogCallbacks) {}

  get isOpen(): boolean {
    return this.panel !== null
  }

  open(trash: TrashEntry[], now: number): void {
    if (this.panel) this.close()
    this.model.entries = trash
    this.lastNow = now
    this.model.query = ''
    this.model.selected = new Set()
    this.overlay = document.createElement('div')
    this.overlay.className = 'fixed inset-0 z-100 bg-black/50 backdrop-blur-[2px]'
    this.panel = document.createElement('div')
    this.panel.className =
      'fixed left-1/2 top-1/2 z-101 flex max-h-[86vh] w-[min(560px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border bg-card text-card-foreground shadow-2xl'
    this.panel.setAttribute('role', 'dialog')
    this.panel.setAttribute('aria-modal', 'true')
    this.panel.setAttribute('aria-label', '回收站')
    this.panel.style.animation = 'pop-in 0.14s ease-out'
    this.overlay.addEventListener('mousedown', () => this.callbacks.onClose())
    this.panel.innerHTML = this.shellHtml()
    document.body.append(this.overlay, this.panel)

    this.listEl = this.panel.querySelector('[data-role="list"]')
    this.searchEl = this.panel.querySelector('[data-role="search"]')
    this.wireShell()
    this.renderList()
    this.searchEl?.focus()
  }

  /** 动作落地后由调用方刷新列表（trash 变了但弹层保持打开） */
  update(trash: TrashEntry[], now: number): void {
    if (!this.panel) return
    this.model.entries = trash
    this.lastNow = now
    this.model.update(trash)
    this.renderList()
  }

  close(): void {
    this.overlay?.remove()
    this.panel?.remove()
    this.overlay = null
    this.panel = null
    this.listEl = null
    this.searchEl = null
    document.removeEventListener('keydown', this.onKey)
  }

  private keyOf(t: TrashEntry): string {
    return entryKey(t)
  }

  private visible(): TrashEntry[] {
    return this.model.visible()
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.isComposing) return
    e.stopPropagation()
    if (e.key === 'Escape') this.callbacks.onClose()
  }

  // ---------------------------------------------------------------- shell

  private shellHtml(): string {
    return `
      <div class="flex shrink-0 items-center justify-between border-b px-5 py-3.5">
        <div class="flex items-center gap-2">
          <span class="flex size-7 items-center justify-center rounded-full bg-secondary text-secondary-foreground">${icon('trash', 'size-3.5')}</span>
          <h2 class="text-[15px] font-semibold tracking-tight">回收站</h2>
          <span class="badge bg-secondary text-secondary-foreground" data-role="count"></span>
        </div>
        <button class="btn btn-ghost btn-sm h-7 w-7 p-0" data-op="close" aria-label="关闭">${icon('x', 'size-4')}</button>
      </div>
      <p class="shrink-0 px-5 pt-3 text-xs leading-relaxed text-muted-foreground">
        删除的文档与批注在这里保留 7 天，过期自动清理；文档恢复后其批注一并找回。失锚批注建议先「恢复」或「标记为已解决」，而不是彻底删除。
      </p>
      <div class="shrink-0 px-5 pt-3">
        <div class="relative">
          <span class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">${icon('search', 'size-3.5')}</span>
          <input data-role="search" class="input-base h-8 w-full pl-8 pr-8 text-[13px]" placeholder="搜索批语、出处文档、类型…" value=""/>
          <button class="btn btn-ghost btn-sm absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 p-0 text-muted-foreground ${this.model.query ? '' : 'invisible'}" data-op="clear-search" aria-label="清除搜索">${icon('x', 'size-3')}</button>
        </div>
        <div data-role="bulk" class="hidden"></div>
      </div>
      <div data-role="list" class="min-h-0 flex-1 overflow-y-auto px-5 py-3"></div>
      <div class="flex shrink-0 items-center justify-between border-t px-5 py-3">
        <button class="btn btn-ghost btn-sm text-xs text-destructive hover:text-destructive" data-op="clear-all" ${this.model.entries.length === 0 ? 'disabled' : ''}>清空回收站</button>
        <span class="text-xs text-muted-foreground">删除的文档与批注可随时回到这里恢复</span>
      </div>`
  }

  private wireShell(): void {
    if (!this.panel) return
    this.panel.querySelector('[data-op="close"]')?.addEventListener('click', () => this.callbacks.onClose())
    this.panel.querySelector('[data-op="clear-all"]')?.addEventListener('click', () => this.callbacks.onClearAll())
    this.panel.querySelector('[data-op="clear-search"]')?.addEventListener('click', () => {
      this.setQuery('')
      this.searchEl?.focus()
    })
    this.panel.querySelector('[data-role="search"]')?.addEventListener('input', (e) => {
      this.setQuery((e.target as HTMLInputElement).value)
    })
    // Esc：搜索有词先清词（阻止冒泡），再按才落到 document 监听关弹层
    this.searchEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.model.query !== '') {
        e.stopPropagation()
        this.setQuery('')
      }
    })
    // 勾选与批量按钮全部走 panel 委托：列表随查询/勾选重绘，元素常换，委托一次挂稳
    this.panel.addEventListener('change', (e) => {
      const target = e.target as HTMLElement
      if (target.matches('[data-select-all]')) {
        const all = (target as HTMLInputElement).checked
        const visible = this.visible()
        if (all) for (const t of visible) this.model.selected.add(this.keyOf(t))
        else this.model.selected.clear()
        this.renderList()
        return
      }
      if (target.matches('[data-select-key]')) {
        const key = target.dataset.selectKey!
        if ((target as HTMLInputElement).checked) this.model.selected.add(key)
        else this.model.selected.delete(key)
        this.renderList()
      }
    })
    this.panel.addEventListener('click', (e) => {
      const action = (e.target as HTMLElement).closest('[data-op][data-key]') as HTMLElement | null
      if (action) {
        const key = action.dataset.key!
        if (action.dataset.op === 'restore') this.callbacks.onRestore([key])
        if (action.dataset.op === 'purge') this.callbacks.onPurge([key])
        return
      }
      const el = (e.target as HTMLElement).closest('[data-bulk-op]') as HTMLElement | null
      if (!el) return
      const op = el.dataset.bulkOp
      const keys = [...this.model.selected]
      if (keys.length === 0) return
      if (op === 'restore') this.callbacks.onRestore(keys)
      if (op === 'purge') this.callbacks.onPurge(keys)
      if (op === 'clear') {
        this.model.selected.clear()
        this.renderList()
      }
    })
  }

  private setQuery(q: string): void {
    this.model.query = q
    this.model.update(this.model.entries)
    if (this.searchEl) this.searchEl.value = q
    this.renderList()
  }

  // ---------------------------------------------------------------- list

  private renderList(): void {
    if (!this.panel || !this.listEl) return
    const visible = this.visible()
    const trash = this.model.entries
    const docCount = trash.filter((t) => t.type === 'doc').length
    const annCount = trash.length - docCount

    const countEl = this.panel.querySelector('[data-role="count"]')
    if (countEl) {
      countEl.textContent =
        trash.length === 0
          ? '空'
          : `${trash.length} 项${docCount > 0 ? ` · ${docCount} 文档` : ''}${annCount > 0 ? ` · ${annCount} 批注` : ''}`
    }
    this.panel.querySelector('[data-op="clear-all"]')?.toggleAttribute('disabled', trash.length === 0)
    this.panel.querySelector('[data-op="clear-search"]')?.classList.toggle('invisible', this.model.query === '')

    const allSelected = visible.length > 0 && visible.every((t) => this.model.selected.has(this.keyOf(t)))
    const someSelected = visible.some((t) => this.model.selected.has(this.keyOf(t)))
    const selectAll = this.panel.querySelector('[data-select-all]') as HTMLInputElement | null
    if (selectAll) {
      selectAll.checked = allSelected
      selectAll.indeterminate = !allSelected && someSelected
      selectAll.toggleAttribute('disabled', visible.length === 0)
    }
    this.renderBulk()

    this.listEl.innerHTML =
      trash.length === 0
        ? `<div class="mt-8 rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">回收站是空的</div>`
        : visible.length === 0
          ? `<div class="mt-8 rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">没有匹配「${escapeHtml(this.model.query.trim())}」的条目</div>`
          : `<div class="flex flex-col gap-2">
              <label class="flex cursor-pointer items-center gap-1.5 px-0.5 text-[11px] text-muted-foreground">
                <input type="checkbox" data-select-all class="size-3 accent-[var(--primary)]"/> 全选${this.model.query.trim() ? '（当前筛选结果）' : ''}
              </label>
              ${visible.map((t) => this.renderEntry(t)).join('')}
            </div>`

  }

  /** 批量操作条：有选中才出现（恢复 / 彻底删除 / 取消选择） */
  private renderBulk(): void {
    const bulk = this.panel?.querySelector('[data-role="bulk"]')
    if (!bulk) return
    if (this.model.selected.size === 0) {
      bulk.className = 'hidden'
      bulk.innerHTML = ''
      return
    }
    bulk.className = 'mt-2 flex items-center gap-1.5 rounded-lg border bg-muted/40 px-2 py-1.5'
    bulk.innerHTML = `
      <span class="shrink-0 text-[11px] text-muted-foreground">已选 ${this.model.selected.size} 项</span>
      <button type="button" class="btn btn-outline btn-sm h-6 px-2 text-[11px]" data-bulk-op="restore">恢复</button>
      <button type="button" class="btn btn-outline btn-sm h-6 px-2 text-[11px] text-destructive hover:text-destructive" data-bulk-op="purge">彻底删除</button>
      <button type="button" class="btn btn-ghost btn-sm h-6 w-6 p-0" data-bulk-op="clear" title="取消选择" aria-label="取消选择">${icon('x', 'size-3')}</button>`
  }

  private renderEntry(t: TrashEntry): string {
    const daysLeft = Math.max(0, Math.ceil((t.deletedAt + TRASH_RETENTION_MS - this.lastNow) / DAY_MS))
    const key = this.keyOf(t)
    const checked = this.model.selected.has(key)
    const head =
      t.type === 'doc'
        ? `<span class="badge border-sky-500/40 text-sky-600 dark:text-sky-400">文档</span>
           <span class="min-w-0 truncate text-sm font-medium" title="${escapeHtml(t.doc.name)}">${escapeHtml(t.doc.name)}</span>
           <span class="text-xs text-muted-foreground">${t.doc.annotations.length} 条批注</span>`
        : `<span class="badge border-transparent" style="color:var(--kind-${t.annotation.kind});background:var(--kind-${t.annotation.kind}-bg)">${KIND_LABEL[t.annotation.kind]}</span>
           ${('anchorLost' in t.annotation && t.annotation.anchorLost) ? '<span class="badge border-amber-500/40 text-amber-600 dark:text-amber-400">失锚</span>' : ''}
           ${t.annotation.status === 'resolved' ? '<span class="badge bg-secondary text-secondary-foreground">已解决</span>' : ''}
           <span class="truncate text-xs text-muted-foreground" title="${escapeHtml(t.docName)}">${escapeHtml(t.docName)}</span>`
    const body =
      t.type === 'doc'
        ? `<div class="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">整份文档入站，恢复后批注一并找回</div>`
        : `<div class="mt-1 line-clamp-2 whitespace-pre-wrap text-[13px] leading-relaxed">${t.annotation.comment ? escapeHtml(t.annotation.comment) : '<span class="opacity-50">（无批语）</span>'}</div>`
    return `
      <div class="flex items-start gap-2 rounded-lg border bg-muted/30 p-2.5 ${checked ? 'ring-1 ring-ring/40' : ''}" data-entry="${key}">
        <input type="checkbox" data-select-key="${key}" class="mt-0.5 size-3 shrink-0 accent-[var(--primary)]" ${checked ? 'checked' : ''} aria-label="选中该条目"/>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-1.5">${head}</div>
          ${body}
        </div>
        <div class="flex shrink-0 flex-col items-end gap-1">
          <span class="text-[11px] text-muted-foreground" title="超过保留期将自动清理">${daysLeft} 天后清理</span>
          <div class="flex gap-0.5">
            <button class="btn btn-ghost btn-sm h-7 px-2 text-xs" data-op="restore" data-key="${key}">恢复</button>
            <button class="btn btn-ghost btn-sm h-7 px-2 text-xs text-destructive hover:text-destructive" data-op="purge" data-key="${key}">彻底删除</button>
          </div>
        </div>
      </div>`
  }
}
