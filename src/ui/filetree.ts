/** 左侧文档树：目录层级展示 + 打开/移除 + 多选批量操作（导出 / 删除）。多文档工作区入口。 */

import { icon } from './icons'
import type { DocItem } from '../core/types'

export interface FileTreeCallbacks {
  onOpen: (id: string) => void
  onRemove: (id: string) => void
  /** 单项导出：直接为该文档打开导出弹层（不必切换当前文档） */
  onExportDoc: (id: string) => void
  /** 多选导出 / 多选删除（删除在 main 侧二次确认） */
  onBulkExport: (ids: string[]) => void
  onBulkDelete: (ids: string[]) => void
}

interface TreeNode {
  name: string
  dir: boolean
  /** dir: 子节点；file: 文档 */
  children: TreeNode[]
  doc?: DocItem
}

export class FileTreeView {
  private root: HTMLElement
  private collapsed = new Set<string>()
  /** 多选集合：勾选框驱动，重渲染时剪除已不存在的文档 */
  private selected = new Set<string>()
  /** 最近一次渲染的入参，目录折叠切换时局部重渲染用 */
  private lastDocs: DocItem[] = []
  private lastActiveId = ''

  constructor(root: HTMLElement, private callbacks: FileTreeCallbacks) {
    this.root = root
  }

  /** 折叠/展开目录：切换后立即重渲染（此前只改集合不动视图，是展开失效的根因） */
  toggleDir(key: string): void {
    if (this.collapsed.has(key)) this.collapsed.delete(key)
    else this.collapsed.add(key)
    this.render(this.lastDocs, this.lastActiveId)
  }

  render(docs: DocItem[], activeDocId: string): void {
    this.lastDocs = docs
    this.lastActiveId = activeDocId
    if (docs.length === 0) {
      this.root.innerHTML = `
        <div class="px-3 py-6 text-center text-xs leading-relaxed text-muted-foreground">
          还没有文档。<br>用顶栏「打开文件」导入 .txt / .md，<br>或整个文件夹。
        </div>`
      return
    }
    const existing = new Set(docs.map((d) => d.id))
    for (const id of this.selected) if (!existing.has(id)) this.selected.delete(id)
    const tree = buildTree(docs)
    this.root.innerHTML = `
      <div class="px-2 py-1.5">
        <div class="flex items-center justify-between px-1.5 pb-1">
          <label class="flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" data-select-all class="size-3 accent-[var(--primary)]" ${this.selected.size === docs.length ? 'checked' : ''} title="全选"/>
            <span class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">文档 ${docs.length}</span>
          </label>
        </div>
        ${this.selected.size > 0 ? this.renderBulkBar() : ''}
        ${this.renderNodes(tree.children, '', activeDocId)}
      </div>`
    this.bindEvents()
  }

  private renderBulkBar(): string {
    return `
      <div class="mb-1.5 flex items-center gap-1 rounded-md border bg-muted/50 px-2 py-1.5 text-xs" data-bulk-bar>
        <span class="text-muted-foreground">已选 ${this.selected.size}</span>
        <span class="ml-auto flex gap-1">
          <button class="btn btn-outline btn-sm h-6 px-2 text-[11px]" data-bulk="export">导出</button>
          <button class="btn btn-outline btn-sm h-6 px-2 text-[11px] text-destructive hover:text-destructive" data-bulk="delete">删除</button>
          <button class="btn btn-ghost btn-sm h-6 px-1.5 text-[11px]" data-bulk="clear" title="取消选择">${icon('x', 'size-3')}</button>
        </span>
      </div>`
  }

  private renderNodes(nodes: TreeNode[], prefix: string, activeDocId: string): string {
    return nodes
      .map((n) => {
        const key = prefix + '/' + n.name
        if (n.dir) {
          const isCollapsed = this.collapsed.has(key)
          const chevron = icon('chevron', `size-3.5 transition-transform ${isCollapsed ? '' : 'rotate-90'}`)
          return `
            <div>
              <button class="tree-row group" data-dir="${key}">
                <span class="text-muted-foreground">${chevron}</span>
                ${icon('folder', 'size-3.5 text-muted-foreground/80')}
                <span class="truncate">${escape(n.name)}</span>
              </button>
              ${isCollapsed ? '' : `<div class="ml-3 border-l pl-1">${this.renderNodes(n.children, key, activeDocId)}</div>`}
            </div>`
        }
        const doc = n.doc!
        const count = doc.annotations.filter((a) => a.status === 'open').length
        const active = doc.id === activeDocId
        return `
          <div class="tree-row group ${active ? 'bg-secondary text-secondary-foreground' : ''}" data-doc="${doc.id}" role="button" tabindex="0">
            <input type="checkbox" data-select="${doc.id}" class="size-3 shrink-0 accent-[var(--primary)]" ${this.selected.has(doc.id) ? 'checked' : ''}/>
            ${icon('file', 'size-3.5 shrink-0 text-muted-foreground/80')}
            <span class="truncate flex-1">${escape(n.name)}</span>
            ${count > 0 ? `<span class="badge h-4 bg-secondary px-1 text-[10px] text-secondary-foreground">${count}</span>` : ''}
            <button class="tree-export opacity-0 transition-opacity group-hover:opacity-100" data-export="${doc.id}" title="导出该文档批注">${icon('download', 'size-3')}</button>
            <button class="tree-remove opacity-0 transition-opacity group-hover:opacity-100" data-remove="${doc.id}" title="移除文档">${icon('x', 'size-3')}</button>
          </div>`
      })
      .join('')
  }

  private bindEvents(): void {
    this.root.querySelectorAll('[data-dir]').forEach((btn) => {
      btn.addEventListener('click', () => this.toggleDir((btn as HTMLElement).dataset.dir!))
    })
    this.root.querySelectorAll('[data-select]').forEach((box) => {
      box.addEventListener('change', () => {
        const id = (box as HTMLInputElement).dataset.select!
        if ((box as HTMLInputElement).checked) this.selected.add(id)
        else this.selected.delete(id)
        this.render(this.lastDocs, this.lastActiveId)
      })
      // 勾选不触发行点击（打开文档）
      box.addEventListener('click', (e) => e.stopPropagation())
    })
    this.root.querySelectorAll('[data-select-all]').forEach((box) => {
      box.addEventListener('change', () => {
        const all = (box as HTMLInputElement).checked
        this.selected = new Set(all ? this.lastDocs.map((d) => d.id) : [])
        this.render(this.lastDocs, this.lastActiveId)
      })
    })
    this.root.querySelectorAll('[data-bulk]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const op = (btn as HTMLElement).dataset.bulk
        const ids = [...this.selected]
        if (ids.length === 0) return
        if (op === 'export') this.callbacks.onBulkExport(ids)
        if (op === 'delete') this.callbacks.onBulkDelete(ids)
        if (op === 'clear') {
          this.selected.clear()
          this.render(this.lastDocs, this.lastActiveId)
        }
      })
    })
    this.root.querySelectorAll('[data-doc]').forEach((row) => {
      const id = (row as HTMLElement).dataset.doc!
      row.addEventListener('click', () => this.callbacks.onOpen(id))
      row.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') this.callbacks.onOpen(id)
      })
    })
    this.root.querySelectorAll('[data-export]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        this.callbacks.onExportDoc((btn as HTMLElement).dataset.export!)
      })
    })
    this.root.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        this.callbacks.onRemove((btn as HTMLElement).dataset.remove!)
      })
    })
  }
}

function buildTree(docs: DocItem[]): TreeNode {
  const root: TreeNode = { name: '', dir: true, children: [] }
  for (const doc of docs) {
    const parts = (doc.path ? doc.path + '/' : '').split('/').filter(Boolean)
    let cur = root
    for (const part of parts) {
      let next = cur.children.find((c) => c.dir && c.name === part)
      if (!next) {
        next = { name: part, dir: true, children: [] }
        cur.children.push(next)
      }
      cur = next
    }
    cur.children.push({ name: doc.name, dir: false, children: [], doc })
  }
  const sortNodes = (n: TreeNode) => {
    n.children.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
    n.children.forEach(sortNodes)
  }
  sortNodes(root)
  return root
}

function escape(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
