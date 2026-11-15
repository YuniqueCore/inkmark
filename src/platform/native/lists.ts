import {summarizeSlop} from '../../workbench/slop-summary'
import {ALL_KINDS, MANUAL_KINDS} from '../../core/types'
import type {SidebarCallbacks, SidebarRenderOptions} from '../../ui/sidebar'
import type {FileTreeCallbacks} from '../../ui/filetree'
import type {AnnotationPresentation} from '../../workbench/annotation-presentation'
import {documentTree, type DocumentList, type DocumentSummary, type DocumentNode} from '../../workbench/documents'
import {reviewListItems, type ReviewList} from '../../workbench/review-list'
import type {NativeChannel} from './channel'
import type {NativeView} from '../../workbench/shell-protocol'

const PAGE_SIZE = 100
const clip = (value: string): string => value.slice(0, 4000)

export function nativeDocuments(channel: NativeChannel, callbacks: FileTreeCallbacks, model: DocumentList) {
  let page = 0
  const refresh = (): void => {
    const rows: NativeView['documents']['rows'] = []
    const walk = (nodes: DocumentNode[], path: string, depth: number): void => {
      for (const node of nodes) {
        const key = `${path}/${node.name}`
        rows.push({key: node.doc?.id ?? key, title: clip(node.name), depth, directory: node.dir, collapsed: model.collapsed.has(key), doc: node.doc ? {...node.doc, name: clip(node.doc.name), path: clip(node.doc.path)} : undefined})
        if (node.dir && !model.collapsed.has(key)) walk(node.children, key, depth + 1)
      }
    }
    walk(documentTree(model.docs).children, '', 0)
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
    page = Math.min(page, pages - 1)
    channel.view.documents = {rows: rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), selected: [...model.selected], activeId: model.activeId, total: model.docs.length, page, pages}
    channel.publish()
  }
  channel.on('document', command => {
    if (command.action === 'directory') { model.toggleDirectory(command.id); refresh(); return }
    if (!model.docs.some(doc => doc.id === command.id)) throw new Error('文档已不存在，请重新选择')
    switch (command.action) {
      case 'open': callbacks.onOpen(command.id); break
      case 'remove': callbacks.onRemove(command.id); break
      case 'export': callbacks.onExportDoc(command.id); break
      case 'select': if (model.selected.has(command.id)) model.selected.delete(command.id); else model.selected.add(command.id); break
    }
    refresh()
  })
  channel.on('documents', command => {
    const ids = [...model.selected]
    switch (command.action) {
      case 'all': model.selectAll(model.selected.size !== model.docs.length); break
      case 'invert': model.invertSelection(); break
      case 'clear': model.selectAll(false); break
      case 'export': if (ids.length) callbacks.onBulkExport(ids); break
      case 'delete': if (ids.length) callbacks.onBulkDelete(ids); break
      case 'next': page++; break
      case 'previous': page = Math.max(0, page - 1); break
    }
    refresh()
  })
  return {render(docs: DocumentSummary[], activeId: string): void { model.update(docs, activeId); refresh() }}
}

export function nativeReviews(channel: NativeChannel, callbacks: SidebarCallbacks, model: ReviewList) {
  let annotations: AnnotationPresentation[] = []
  let options: SidebarRenderOptions = {}
  let page = 0
  const refresh = (): void => {
    model.reconcile(annotations)
    const shown = model.visible(annotations).sort((a, b) => a.order - b.order)
    const project = (ann: AnnotationPresentation): NativeView['reviews']['rows'][number] => ({id: ann.id, key: `a:${ann.id}`, rowType: 'annotation', count: 1, expanded: false, selected: model.selected.has(ann.id), kind: ann.kind,
      comment: clip(ann.comment), excerpt: clip(ann.excerpt), status: ann.status, groupId: ann.groupId,
      anchorLost: ann.anchorLost === true, revised: ann.target === 'revised', replacement: clip(ann.replacement ?? ''), category: clip(ann.meta?.label ?? '')})
    const rows = reviewListItems(shown).flatMap(item => {
      if (item.kind === 'single') return [project(item.ann)]
      const first = item.members[0]!, groupId = first.groupId!, expanded = model.expanded.has(groupId)
      return [{...project(first), id: groupId, key: `g:${groupId}`, rowType: 'group' as const, count: item.members.length, expanded,
        selected: item.members.every(a => model.selected.has(a.id)), status: item.members.some(a => a.status === 'open') ? 'open' as const : 'resolved' as const},
        ...(expanded ? item.members.map(project) : [])]
    })
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
    page = Math.min(page, pages - 1)
    channel.view.reviews = {
      rows: rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
      selected: [...model.selected], activeId: model.activeId, filter: model.filter, kinds: [...model.kinds],
      highlightFiltered: model.highlightFiltered, availableKinds: ALL_KINDS.filter(kind => (MANUAL_KINDS as readonly string[]).includes(kind) || annotations.some(ann => ann.kind === kind) || model.kinds.has(kind)), total: shown.length, page, pages,
      report: options.slop ? summarizeSlop(options.slop, options.slopHistory ?? []) : null,
    }
    channel.publish()
  }
  channel.on('filter', command => {
    page = 0
    callbacks.onFilterChange(command.status)
    callbacks.onKindFilterChange(new Set(command.kinds))
    callbacks.onHighlightModeChange(command.highlightFiltered)
    refresh()
  })
  channel.on('review-quick', command => {
    if (!model.selectMatching(annotations, command.selection)) callbacks.onNotify?.('没有匹配的批注')
    refresh()
  })
  channel.on('review-group', command => {
    const members = model.visible(annotations).filter(ann => ann.groupId === command.id)
    if (!members.length) throw new Error('此批注组已变化，请重新选择')
    const ids = members.map(ann => ann.id)
    switch (command.action) {
      case 'expand': if (model.expanded.has(command.id)) model.expanded.delete(command.id); else model.expanded.add(command.id); break
      case 'select': { const selected = ids.every(id => model.selected.has(id)); for (const id of ids) { if (selected) model.selected.delete(id); else model.selected.add(id) }; break }
      case 'resolve': callbacks.onToggleStatus(ids); break
      case 'delete': callbacks.onDelete(ids); break
      case 'export': callbacks.onExport(ids); break
    }
    refresh()
  })
  channel.on('review', command => {
    const ann = model.visible(annotations).find(item => item.id === command.id)
    if (!ann) throw new Error('批注已变化或不在当前筛选中，请重新选择')
    switch (command.action) {
      case 'focus': callbacks.onFocus(ann.id); break
      case 'edit': callbacks.onEdit(ann); break
      case 'select': if (model.selected.has(ann.id)) model.selected.delete(ann.id); else model.selected.add(ann.id); break
      case 'resolve': callbacks.onToggleStatus([ann.id]); break
      case 'delete': callbacks.onDelete([ann.id]); break
      case 'export': callbacks.onExport([ann.id]); break
    }
    refresh()
  })
  channel.on('reviews', command => {
    model.reconcile(annotations)
    const shown = model.visible(annotations)
    const ids = [...model.selected]
    switch (command.action) {
      case 'all': model.selected = new Set(model.selected.size === shown.length ? [] : shown.map(ann => ann.id)); break
      case 'invert': model.selected = new Set(shown.filter(ann => !model.selected.has(ann.id)).map(ann => ann.id)); break
      case 'clear': model.selected.clear(); break
      case 'export': if (ids.length) callbacks.onExport(ids); break
      case 'resolve': if (ids.length) callbacks.onToggleStatus(ids); break
      case 'delete': if (ids.length) callbacks.onDelete(ids); break
      case 'next': page++; break
      case 'previous': page = Math.max(0, page - 1); break
    }
    refresh()
  })
  return {render(next: AnnotationPresentation[], opts: SidebarRenderOptions = {}): void { annotations = next; options = opts; refresh() }}
}
