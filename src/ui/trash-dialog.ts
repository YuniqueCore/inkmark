/** 批注回收站弹层：文档与批注两种条目混排（按删除时间倒序），7 天保留。
 *
 * 支持 恢复 / 彻底删除 / 清空；彻底删除与清空的二次确认归调用方
 * （main 走统一 confirmDialog），本组件只负责列表呈现与动作派发。
 * DOM 自挂载于 body，Esc / 遮罩关闭。
 */

import { escapeHtml } from '../core/text'
import { TRASH_RETENTION_MS } from '../core/trash'
import type { TrashEntry } from '../core/types'
import { KIND_LABEL } from '../core/types'
import { icon } from './icons'

export interface TrashDialogCallbacks {
  onRestore: (keys: string[]) => void
  onPurge: (keys: string[]) => void
  onClearAll: () => void
  onClose: () => void
}

const DAY_MS = 24 * 60 * 60 * 1000

/** 展示顺序：最近删除的在前（回收站惯例），core 存储保持追加序 */
function byDeletedDesc(a: TrashEntry, b: TrashEntry): number {
  return b.deletedAt - a.deletedAt
}

export class TrashDialog {
  private panel: HTMLElement | null = null
  private overlay: HTMLElement | null = null
  private lastTrash: TrashEntry[] = []
  private lastNow = 0

  constructor(private callbacks: TrashDialogCallbacks) {}

  get isOpen(): boolean {
    return this.panel !== null
  }

  open(trash: TrashEntry[], now: number): void {
    if (this.panel) this.close()
    this.lastTrash = trash
    this.lastNow = now
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
    document.body.append(this.overlay, this.panel)
    this.render()
  }

  /** 动作落地后由调用方刷新列表（trash 变了但弹层保持打开） */
  update(trash: TrashEntry[], now: number): void {
    if (!this.panel) return
    this.lastTrash = trash
    this.lastNow = now
    this.render()
  }

  close(): void {
    this.overlay?.remove()
    this.panel?.remove()
    this.overlay = null
    this.panel = null
    document.removeEventListener('keydown', this.onKey)
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.isComposing) return
    e.stopPropagation()
    if (e.key === 'Escape') this.callbacks.onClose()
  }

  private renderEntry(t: TrashEntry): string {
    const daysLeft = Math.max(0, Math.ceil((t.deletedAt + TRASH_RETENTION_MS - this.lastNow) / DAY_MS))
    const key = t.type === 'doc' ? t.doc.id : t.annotation.id
    const head =
      t.type === 'doc'
        ? `<span class="badge border-sky-500/40 text-sky-600 dark:text-sky-400">文档</span>
           <span class="min-w-0 truncate text-sm font-medium" title="${escapeHtml(t.doc.name)}">${escapeHtml(t.doc.name)}</span>
           <span class="text-xs text-muted-foreground">${t.doc.annotations.length} 条批注</span>`
        : `<span class="badge border-transparent" style="color:var(--kind-${t.annotation.kind});background:var(--kind-${t.annotation.kind}-bg)">${KIND_LABEL[t.annotation.kind]}</span>
           ${t.annotation.anchorLost ? '<span class="badge border-amber-500/40 text-amber-600 dark:text-amber-400">失锚</span>' : ''}
           ${t.annotation.status === 'resolved' ? '<span class="badge bg-secondary text-secondary-foreground">已解决</span>' : ''}
           <span class="truncate text-xs text-muted-foreground" title="${escapeHtml(t.docName)}">${escapeHtml(t.docName)}</span>`
    const body =
      t.type === 'doc'
        ? `<div class="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">整份文档入站，恢复后批注一并找回</div>`
        : `<div class="mt-1 line-clamp-2 whitespace-pre-wrap text-[13px] leading-relaxed">${t.annotation.comment ? escapeHtml(t.annotation.comment) : '<span class="opacity-50">（无批语）</span>'}</div>`
    return `
      <div class="flex items-start gap-2 rounded-lg border bg-muted/30 p-2.5" data-entry="${key}">
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

  private render(): void {
    if (!this.panel) return
    const trash = [...this.lastTrash].sort(byDeletedDesc)
    const docCount = trash.filter((t) => t.type === 'doc').length
    const annCount = trash.length - docCount
    const countLine =
      trash.length === 0
        ? ''
        : `<span class="badge bg-secondary text-secondary-foreground">${trash.length} 项${docCount > 0 ? ` · ${docCount} 文档` : ''}${annCount > 0 ? ` · ${annCount} 批注` : ''}</span>`

    this.panel.innerHTML = `
      <div class="flex shrink-0 items-center justify-between border-b px-5 py-3.5">
        <div class="flex items-center gap-2">
          <span class="flex size-7 items-center justify-center rounded-full bg-secondary text-secondary-foreground">${icon('trash', 'size-3.5')}</span>
          <h2 class="text-[15px] font-semibold tracking-tight">回收站</h2>
          ${countLine}
        </div>
        <button class="btn btn-ghost btn-sm h-7 w-7 p-0" data-op="close" aria-label="关闭">${icon('x', 'size-4')}</button>
      </div>
      <p class="shrink-0 px-5 pt-3 text-xs leading-relaxed text-muted-foreground">
        删除的文档与批注在这里保留 7 天，过期自动清理；文档恢复后其批注一并找回。失锚批注建议先「恢复」或「标记为已解决」，而不是彻底删除。
      </p>
      <div class="min-h-0 flex-1 overflow-y-auto px-5 py-3">
        ${
          trash.length === 0
            ? `<div class="mt-8 rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">回收站是空的</div>`
            : `<div class="flex flex-col gap-2">${trash.map((t) => this.renderEntry(t)).join('')}</div>`
        }
      </div>
      <div class="flex shrink-0 items-center justify-between border-t px-5 py-3">
        <button class="btn btn-ghost btn-sm text-xs text-destructive hover:text-destructive" data-op="clear-all" ${trash.length === 0 ? 'disabled' : ''}>清空回收站</button>
        <span class="text-xs text-muted-foreground">删除的文档与批注可随时回到这里恢复</span>
      </div>`

    const key = (el: HTMLElement): string => el.dataset.key!
    this.panel.querySelectorAll('[data-op="restore"]').forEach((btn) =>
      btn.addEventListener('click', () => this.callbacks.onRestore([key(btn as HTMLElement)])),
    )
    this.panel.querySelectorAll('[data-op="purge"]').forEach((btn) =>
      btn.addEventListener('click', () => this.callbacks.onPurge([key(btn as HTMLElement)])),
    )
    this.panel.querySelector('[data-op="clear-all"]')?.addEventListener('click', () => this.callbacks.onClearAll())
    this.panel.querySelector('[data-op="close"]')?.addEventListener('click', () => this.callbacks.onClose())

    // 重挂键盘监听（render 重建了 panel 内容，监听绑在 document 上只需一份）
    document.removeEventListener('keydown', this.onKey)
    document.addEventListener('keydown', this.onKey)
  }
}
