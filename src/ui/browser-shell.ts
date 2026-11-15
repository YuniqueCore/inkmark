import type {Presentation} from '../workbench/presentation'
import type {ShellActions, ChromeState, SaveState, WorkspaceAction} from '../workbench/shell-state'
import {SidebarView, type SidebarCallbacks} from './sidebar'
import {FileTreeView, type FileTreeCallbacks} from './filetree'
import {SelectionPin, type PinCallbacks} from './selection-pin'
import {AnnotationPopup, type PopupCallbacks} from './annotation-popup'
import {SearchPanelView, type SearchPanelCallbacks} from './search-panel'
import {ExporterView, type ExporterCallbacks} from './exporter'
import {TrashDialog, type TrashDialogCallbacks} from './trash-dialog'
import {choiceDialog, textDialog, textDialogDraft} from './confirm'
import {settingsDialog} from './settings-dialog'
import {importConflictDialog} from './import-conflict-dialog'
import type {ReviewList} from '../workbench/review-list'
import type {DocumentList} from '../workbench/documents'
import type {Search} from '../workbench/search'
import {wireHeaderMenu, type MenuItem} from './header-menu'
import {icon} from './icons'
import {toast} from './toast'
import {initResizers} from './resizer'
import {initViewport} from './viewport'
import {renderWelcome} from './welcome'
import {SourceEditor} from './source-editor'
import {BrowserImageControls} from './image-controls'
import {supportsDirectories} from '../platform/host'

const element = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const node = document.getElementById(id)
  if (!node) throw new Error(`Missing browser shell element: ${id}`)
  return node as T
}

export class BrowserShell implements Presentation {
  welcome = renderWelcome
  sourceEditor = new SourceEditor(element('editor'))
  imageControls = new BrowserImageControls()
  choice = choiceDialog
  text = textDialog
  textDraft = textDialogDraft
  settings = settingsDialog
  importConflict = importConflictDialog
  notify = toast

  sidebar(callbacks: SidebarCallbacks, model: ReviewList) { return new SidebarView(element('sidebar'), callbacks, model) }
  documents(callbacks: FileTreeCallbacks, model: DocumentList) { return new FileTreeView(element('filetree'), callbacks, model) }
  selection(callbacks: PinCallbacks) { return new SelectionPin(callbacks) }
  annotation(callbacks: PopupCallbacks) { return new AnnotationPopup(callbacks) }
  search(callbacks: SearchPanelCallbacks, model: Search) { return new SearchPanelView(callbacks, model) }
  exporter(callbacks: ExporterCallbacks) {
    const exporter = new ExporterView(element('export-modal'), element('overlay'), callbacks)
    element('overlay').addEventListener('click', () => exporter.close())
    return exporter
  }
  trash(callbacks: TrashDialogCallbacks) { return new TrashDialog(callbacks) }

  private chrome?: ChromeState
  private more?: ReturnType<typeof wireHeaderMenu>
  private menuItems(): MenuItem[] {
    const text = this.chrome?.ready && this.chrome.active?.kind === 'text'
    const item = (id: WorkspaceAction, label: string, extra: Partial<MenuItem> = {}): MenuItem => ({id, label, ...extra})
    return [
      item('search', '搜索与批量批注', {elementId: 'btn-search', hint: '⌘F', disabled: !text}),
      item('edit', this.chrome?.mode === 'edit' ? '完成编辑原文' : '编辑原文', {elementId: 'btn-edit', disabled: !text}),
      item('diff', this.chrome?.mode === 'diff' ? '退出改稿对照' : '对照 AI 改稿', {elementId: 'btn-diff', disabled: !text}),
      item('clear-revised', '清除改稿', {elementId: 'btn-diff-clear', hidden: !this.chrome?.hasRevised, danger: true}),
      item('scan', '扫描套话', {elementId: 'btn-scan', disabled: !text}),
      item('export', '导出批注', {hint: '⌘S', separatorBefore: true}),
      item('settings', '阅读设置', {elementId: 'btn-view', separatorBefore: true}),
      item('theme', '切换明暗', {elementId: 'btn-theme'}),
      item('recovery', '下载完整工作区备份', {separatorBefore: true}),
      item('restore', '恢复完整工作区备份'),
      item('backup', '下载文档与批注备份'),
      item('remove', '移除当前文档', {danger: true, disabled: !this.chrome?.active}),
    ]
  }

  private compact(): boolean { return window.matchMedia('(max-width: 1023.98px)').matches }
  revealCanvas(): void { if (this.compact()) this.closePanels() }
  private closePanels = (): void => { document.body.classList.remove('tree-open', 'sidebar-open') }
  private togglePanel(which: 'tree' | 'sidebar'): void {
    if (this.compact()) {
      document.body.classList.remove(which === 'tree' ? 'sidebar-open' : 'tree-open')
      document.body.classList.toggle(`${which}-open`)
    } else {
      const off = element(which === 'tree' ? 'documents-pane' : 'sidebar').classList.toggle('hidden')
      element(which === 'tree' ? 'btn-tree-drawer' : 'btn-sidebar-drawer').setAttribute('aria-expanded', String(!off))
    }
  }

  mount(actions: ShellActions): void {
    const execute = (action: WorkspaceAction): void => actions.execute(action)
    wireHeaderMenu(element('btn-import'), [
      {id: 'new', label: '粘贴新建文档', icon: icon('plus'), hint: '文本 · Markdown'},
      {id: 'files', label: '打开文件', icon: icon('file'), hint: '文本 · 图片 · JSON'},
      ...(supportsDirectories() ? [{id: 'folder', label: '导入文件夹', icon: icon('folder'), hint: '批量导入文本与图片'}] : []),
      {id: 'sample', label: '载入示例', icon: icon('plus'), hint: '体验划选批注'},
    ], id => execute(id as WorkspaceAction))
    this.more = wireHeaderMenu(element('btn-more'), this.menuItems(), id => execute(id as WorkspaceAction))
    const bindings: Record<string, WorkspaceAction> = {
      'btn-export': 'export', 'btn-trash': 'trash',
      'btn-recovery-backup': 'recovery', 'btn-legacy-backup': 'legacy-backup',
      'btn-raw-backup': 'raw-backup', 'btn-reset-storage': 'reset-storage',
    }
    for (const [id, action] of Object.entries(bindings)) element(id).addEventListener('click', () => execute(action))
    document.querySelectorAll<HTMLButtonElement>('[data-reading-mode]').forEach(button => button.addEventListener('click', () => {
      const mode = button.dataset.readingMode
      if (mode === 'source' || mode === 'split' || mode === 'preview') actions.readingMode(mode)
    }))
    element('btn-tree-drawer').addEventListener('click', () => this.togglePanel('tree'))
    element('btn-sidebar-drawer').addEventListener('click', () => this.togglePanel('sidebar'))
    element('drawer-backdrop').addEventListener('click', this.closePanels)
    window.matchMedia('(max-width: 1023.98px)').addEventListener('change', this.closePanels)
    document.addEventListener('keydown', event => { if (!event.isComposing && event.key === 'Escape') this.closePanels() })
    element('app-version').textContent = `v${__APP_VERSION__}`
    initResizers({layout: element('layout'), leftHandle: element('handle-left'), rightHandle: element('handle-right')})
    initViewport(element('layout'))
    element('btn-tree-drawer').innerHTML = icon('folder')
    element('btn-sidebar-drawer').innerHTML = icon('panelRight')
    element('btn-import').innerHTML = icon('plus')
    element('btn-more').innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>'
  }

  render(state: ChromeState): void {
    this.chrome = state
    this.more?.update(this.menuItems())
    const image = state.active?.kind === 'image'
    element('document-title').textContent = state.active?.name ?? 'InkMark'
    element('document-detail').textContent = state.active ? `${image ? '图片' : '文档'} · ${state.active.annotationCount} 条批注` : '文字与图片批注'
    element('reading-toolbar').hidden = !state.active || image || state.mode !== 'annotate'
    document.querySelectorAll<HTMLButtonElement>('[data-reading-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.readingMode === state.readingMode)))
    element('trash-count').textContent = state.trashCount > 99 ? '99+' : String(state.trashCount)
    element('trash-count').hidden = state.trashCount === 0
    element('legacy-recovery').hidden = !state.legacyRecovery
  }

  save(state: SaveState): void {
    element('save-dot').className = `size-1.5 rounded-full ${ {saved: 'bg-emerald-500', dirty: 'bg-amber-500', error: 'bg-red-500'}[state.status] }`
    element('save-text').textContent = state.message
    element('save-status').title = state.message
    element('save-error').hidden = state.status !== 'error'
    element('btn-raw-backup').hidden = !state.rawRecovery
    element('btn-reset-storage').hidden = !state.rawRecovery
  }
}
