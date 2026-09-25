/** 左侧文档树：目录层级展示 + 打开/移除。多文档工作区入口。 */

import { icon } from './icons'
import type { DocItem } from '../core/types'

export interface FileTreeCallbacks {
  onOpen: (id: string) => void
  onRemove: (id: string) => void
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

  constructor(root: HTMLElement, private callbacks: FileTreeCallbacks) {
    this.root = root
  }

  /** 折叠/展开目录 */
  toggleDir(key: string): void {
    if (this.collapsed.has(key)) this.collapsed.delete(key)
    else this.collapsed.add(key)
  }

  render(docs: DocItem[], activeDocId: string): void {
    if (docs.length === 0) {
      this.root.innerHTML = `
        <div class="px-3 py-6 text-center text-xs leading-relaxed text-muted-foreground">
          还没有文档。<br>用顶栏「打开文件」导入 .txt / .md，<br>或整个文件夹。
        </div>`
      return
    }
    const tree = buildTree(docs)
    this.root.innerHTML = `
      <div class="px-2 py-1.5">
        <div class="flex items-center justify-between px-1.5 pb-1">
          <span class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">文档 ${docs.length}</span>
        </div>
        ${this.renderNodes(tree.children, '', activeDocId)}
      </div>`
    this.bindEvents()
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
            ${icon('file', 'size-3.5 shrink-0 text-muted-foreground/80')}
            <span class="truncate flex-1">${escape(n.name)}</span>
            ${count > 0 ? `<span class="badge h-4 bg-secondary px-1 text-[10px] text-secondary-foreground">${count}</span>` : ''}
            <button class="tree-remove opacity-0 transition-opacity group-hover:opacity-100" data-remove="${doc.id}" title="移除文档">${icon('x', 'size-3')}</button>
          </div>`
      })
      .join('')
  }

  private bindEvents(): void {
    this.root.querySelectorAll('[data-dir]').forEach((btn) => {
      btn.addEventListener('click', () => this.toggleDir((btn as HTMLElement).dataset.dir!))
    })
    this.root.querySelectorAll('[data-doc]').forEach((row) => {
      const id = (row as HTMLElement).dataset.doc!
      row.addEventListener('click', () => this.callbacks.onOpen(id))
      row.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') this.callbacks.onOpen(id)
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
