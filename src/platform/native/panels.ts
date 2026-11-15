import {canSubmitComposition, type ComposerState} from '../../workbench/composition'
import type {Search} from '../../workbench/search'
import type {SearchPresentation, ExportPresentation, TrashPresentation} from '../../workbench/presentation'
import type {SearchPanelCallbacks} from '../../ui/search-panel'
import type {ExporterCallbacks} from '../../ui/exporter'
import type {TrashDialogCallbacks} from '../../ui/trash-dialog'
import type {NativeInteractions} from './interactions'
import {buildReviewExport, type ReviewExport, type ReviewFormat} from '../../core/review-export'
import {isImageDocument, type ReviewDocument} from '../../core/types'
import {artifactFile} from '../export-artifact'
import {exportFile} from '../../ui/file-transfer'
import {bindFileInput} from '../files'
import {TrashList, trashSummary} from '../../workbench/trash-list'
import {entryKey} from '../../core/trash'

export function nativeSearch(interactions: NativeInteractions, model: Search, callbacks: SearchPanelCallbacks): SearchPresentation {
  let id: string | null = null
  let value: ComposerState = {kind: 'suggestion', comment: '', replacement: ''}
  const refresh = (): void => {
    if (id) interactions.update(id, 'search', {query: model.query, caseSensitive: model.caseSensitive, regex: model.useRegex, crossDoc: model.crossDoc,
      hits: model.hits().length, invalid: model.invalid(), value})
  }
  const close = (): void => { if (id) interactions.close(id); id = null; model.reset(); callbacks.onClose() }
  return {
    hasDraft: () => Boolean(id && (value.comment.trim() || value.replacement.trim())),
    isOpen: () => id !== null,
    close,
    setDocs(docs, activeDocId): void { model.docs = docs; model.activeDocId = activeDocId; refresh() },
    toggle(docs, activeDocId): void {
      if (id) return
      model.docs = docs; model.activeDocId = activeDocId
      value = {...value, comment: '', replacement: ''}
      id = interactions.open<'search'>({type: 'search', title: '搜索与批量批注', query: model.query, caseSensitive: model.caseSensitive, regex: model.useRegex,
        crossDoc: model.crossDoc, hits: model.hits().length, invalid: model.invalid(), value}, (command, sessionId) => {
        if (command.action === 'close') { close(); return }
        const changed = model.query !== command.query || model.caseSensitive !== command.caseSensitive || model.useRegex !== command.regex || model.crossDoc !== command.crossDoc
        model.query = command.query; model.caseSensitive = command.caseSensitive; model.useRegex = command.regex; model.crossDoc = command.crossDoc; value = command.value
        if (changed) { model.navIndex = -1; callbacks.onQueryChange(model.query, model.options()) }
        if (command.action === 'submit') {
          if (!canSubmitComposition(value) || model.hits().length === 0 || model.invalid()) {
            interactions.update(sessionId, 'search', {error: '请检查搜索结果和批注内容后重试'})
          } else {
            callbacks.onBatchAnnotate(model.targets(), value.kind, value.comment.trim(), value.replacement.trim() || undefined)
            close()
          }
        } else if (command.action === 'next' || command.action === 'previous') {
          const hit = model.navigate(command.action === 'next' ? 1 : -1)
          if (hit) callbacks.onNavigate(hit)
        }
        refresh()
      })
    },
  }
}

export function nativeExporter(interactions: NativeInteractions, callbacks: ExporterCallbacks, notify: (message: string) => void): ExportPresentation {
  let id: string | null = null
  let docs: ReviewDocument[] = []
  let format: ReviewFormat = 'inline'
  let resolved = false
  let fileInfo = false
  let artifact: ReviewExport | null = null
  let busy = false
  const refresh = (): void => {
    if (!id || !docs.length) return
    artifact = buildReviewExport(docs, format, {includeResolved: resolved, includeFileInfo: fileInfo})
    interactions.update(id, 'export', {format, includeResolved: resolved, includeFileInfo: fileInfo, hasImages: docs.some(isImageDocument), busy,
      description: `${docs.length} 份文档。${docs.some(isImageDocument) ? '评审 ZIP 包含原图；W3C JSON 不含原图。' : '多文档评审下载为 ZIP。'}${artifact.preview.length > 100000 ? '预览显示前 100,000 字符，复制和保存包含完整内容。' : ''}`,
      preview: artifact.preview.slice(0, 100000), suffix: artifact.kind === 'bundle' ? 'zip' : format === 'w3c' ? 'json' : 'md'})
  }
  const close = (): void => { if (busy) return; if (id) interactions.close(id); id = null; docs = []; artifact = null; callbacks.onClose() }
  return {
    close,
    open(selected, options = {}): void {
      if (id || !selected.length) return
      docs = selected
      resolved = options.includeResolved ?? false
      if (docs.some(isImageDocument) && (format === 'inline' || format === 'snippets')) format = 'review'
      id = interactions.open<'export'>({type: 'export', title: '导出批注', format, includeResolved: resolved, includeFileInfo: fileInfo, hasImages: docs.some(isImageDocument), description: '', preview: '', suffix: '', busy: false}, async (command, sessionId) => {
        if (busy) return
        if (command.action === 'close') { close(); return }
        format = docs.some(isImageDocument) && (command.format === 'inline' || command.format === 'snippets') ? 'review' : command.format
        resolved = command.includeResolved; fileInfo = command.includeFileInfo
        refresh()
        if (command.action === 'copy') callbacks.onCopy(artifact!.preview)
        if (command.action === 'save') {
          const exporting = artifact!
          busy = true; refresh()
          try { await exportFile(artifactFile(exporting), '', notify) }
          finally { busy = false; refresh() }
        }
        if (command.action === 'import') {
          const input = document.createElement('input'); input.type = 'file'; input.accept = '.json'
          const exporting = docs
          bindFileInput(input, async files => {
            if (files[0]) await callbacks.onImportW3C(files[0], exporting.length === 1 ? exporting[0]!.id : null)
            if (id === sessionId) close()
          }, notify)()
        }
      })
      refresh()
    },
  }
}

export function nativeTrash(interactions: NativeInteractions, callbacks: TrashDialogCallbacks): TrashPresentation {
  const model = new TrashList()
  let id: string | null = null
  let now = 0
  let page = 0
  const refresh = (): void => {
    if (!id) return
    const visible = model.visible()
    const pages = Math.max(1, Math.ceil(visible.length / 100))
    page = Math.max(0, Math.min(page, pages - 1))
    interactions.update(id, 'trash', {query: model.query, rows: visible.slice(page * 100, (page + 1) * 100).map(entry => trashSummary(entry, now)), selected: [...model.selected], total: model.entries.length, page, pages})
  }
  const close = (): void => { if (id) interactions.close(id); id = null }
  return {
    close,
    update(entries, time): void { model.update(entries); now = time; refresh() },
    open(entries, time): void {
      close(); page = 0; model.query = ''; model.selected.clear(); model.update(entries); now = time
      id = interactions.open<'trash'>({type: 'trash', title: '回收站', query: '', rows: [], selected: [], total: entries.length, page: 0, pages: 1}, command => {
        if (command.action === 'close') { callbacks.onClose(); return }
        if (command.action === 'search') { page = 0; model.query = command.query; model.update(model.entries) }
        const visible = new Set(model.visible().map(entryKey))
        const keys = command.keys.filter(key => visible.has(key))
        switch (command.action) {
          case 'next': page++; break
          case 'previous': page--; break
          case 'select': for (const key of keys) { if (model.selected.has(key)) model.selected.delete(key); else model.selected.add(key) }; break
          case 'all': model.selected = model.selected.size === visible.size ? new Set() : visible; break
          case 'invert': model.selected = new Set([...visible].filter(key => !model.selected.has(key))); break
          case 'restore': if (keys.length) callbacks.onRestore(keys); break
          case 'purge': if (keys.length) callbacks.onPurge(keys); break
          case 'clear': callbacks.onClearAll(); break
        }
        refresh()
      })
      refresh()
    },
  }
}
