import type {ReviewDocument} from '../core/types'

export interface DocumentSummary {
  id: string
  name: string
  path: string
  kind: 'text' | 'image'
  annotationCount: number
  openCount: number
}

export interface DocumentNode {
  name: string
  dir: boolean
  children: DocumentNode[]
  doc?: DocumentSummary
}

export function summarizeDocuments(docs: readonly ReviewDocument[]): DocumentSummary[] {
  return docs.map(doc => ({id: doc.id, name: doc.name, path: doc.path,
    kind: doc.kind === 'image' ? 'image' : 'text', annotationCount: doc.annotations.length,
    openCount: doc.annotations.filter(a => a.status === 'open').length}))
}

/** Navigator state contains identities and summaries, never copies of document assets. */
export class DocumentList {
  collapsed = new Set<string>()
  selected = new Set<string>()
  docs: DocumentSummary[] = []
  activeId = ''

  update(docs: DocumentSummary[], activeId: string): void {
    this.docs = docs
    this.activeId = activeId
    const existing = new Set(docs.map(doc => doc.id))
    this.selected = new Set([...this.selected].filter(id => existing.has(id)))
  }

  toggleDirectory(path: string): void {
    if (this.collapsed.has(path)) this.collapsed.delete(path)
    else this.collapsed.add(path)
  }

  selectAll(all: boolean): void { this.selected = new Set(all ? this.docs.map(doc => doc.id) : []) }
  invertSelection(): void { this.selected = new Set(this.docs.filter(doc => !this.selected.has(doc.id)).map(doc => doc.id)) }
}

export function documentTree(docs: readonly DocumentSummary[]): DocumentNode {
  const root: DocumentNode = {name: '', dir: true, children: []}
  for (const doc of docs) {
    let current = root
    for (const name of doc.path.split('/').filter(Boolean)) {
      let next = current.children.find(child => child.dir && child.name === name)
      if (!next) { next = {name, dir: true, children: []}; current.children.push(next) }
      current = next
    }
    current.children.push({name: doc.name, dir: false, children: [], doc})
  }
  const sort = (node: DocumentNode): void => {
    node.children.sort((a, b) => a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1)
    node.children.forEach(sort)
  }
  sort(root)
  return root
}
