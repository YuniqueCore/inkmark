import {entryKey, TRASH_RETENTION_MS} from '../core/trash'
import {KIND_LABEL, type TrashEntry} from '../core/types'

export class TrashList {
  entries: TrashEntry[] = []
  query = ''
  selected = new Set<string>()
  update(entries: TrashEntry[]): void {
    this.entries = entries
    const alive = new Set(this.visible().map(entryKey))
    this.selected = new Set([...this.selected].filter(key => alive.has(key)))
  }
  visible(): TrashEntry[] {
    const query = this.query.trim().toLowerCase()
    return [...this.entries].sort((a, b) => b.deletedAt - a.deletedAt).filter(entry => !query ||
      (entry.type === 'doc' ? entry.doc.name : `${entry.docName} ${entry.annotation.comment} ${KIND_LABEL[entry.annotation.kind]}`).toLowerCase().includes(query))
  }
}

export function trashSummary(entry: TrashEntry, now: number) {
  return {key: entryKey(entry), name: (entry.type === 'doc' ? entry.doc.name : entry.docName).slice(0, 4000),
    description: entry.type === 'doc' ? `${entry.doc.annotations.length} 条批注` : `${KIND_LABEL[entry.annotation.kind]} · ${entry.annotation.comment}`.slice(0, 4000),
    remainingDays: Math.max(0, Math.ceil((entry.deletedAt + TRASH_RETENTION_MS - now) / 86400000))}
}
