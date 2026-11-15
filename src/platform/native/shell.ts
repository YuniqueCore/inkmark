import type {Presentation} from '../../workbench/presentation'
import type {ShellActions, ChromeState, SaveState} from '../../workbench/shell-state'
import type {SidebarCallbacks} from '../../ui/sidebar'
import type {FileTreeCallbacks} from '../../ui/filetree'
import type {PinCallbacks} from '../../ui/selection-pin'
import type {PopupCallbacks} from '../../ui/annotation-popup'
import type {SearchPanelCallbacks} from '../../ui/search-panel'
import type {ExporterCallbacks} from '../../ui/exporter'
import type {TrashDialogCallbacks} from '../../ui/trash-dialog'
import type {ConfirmOptions, ConfirmChoice, TextDialogOptions} from '../../ui/confirm'
import type {ReviewList} from '../../workbench/review-list'
import type {DocumentList} from '../../workbench/documents'
import type {Search} from '../../workbench/search'
import type {ReadingPrefs} from '../../core/prefs'
import type {ImportPlan, ImportRow} from '../../core/import-conflict'
import {setRowAction, applyPreset} from '../../core/import-conflict'
import {reanchorAnnotations} from '../../core/reanchor'
import type {DocItem} from '../../core/types'
import {NativeSourceEditor, NativeImageControls} from './surface-controls'
import {NativeChannel} from './channel'
import {NativeInteractions} from './interactions'
import {nativeDocuments, nativeReviews} from './lists'
import {nativeSelection, nativeAnnotationEditor} from './annotations'
import {nativeSearch, nativeExporter, nativeTrash} from './panels'

export class NativeShell implements Presentation {
  readonly channel = new NativeChannel()
  readonly interactions = new NativeInteractions(this.channel)
  sourceEditor = new NativeSourceEditor(this.interactions)
  imageControls = new NativeImageControls(this.channel, this.interactions)
  private textId: string | null = null
  private submittingText = false
  private noticeTimer: ReturnType<typeof setTimeout> | undefined

  welcome(root: HTMLElement): void { root.replaceChildren() }
  mount(actions: ShellActions): void {
    this.channel.on('workspace', command => actions.execute(command.action))
    this.channel.on('reading', command => actions.readingMode(command.mode))
    this.channel.publish()
  }
  render(state: ChromeState): void { this.channel.view.chrome = {...state, active: state.active ? {...state.active, name: state.active.name.slice(0, 4000), path: state.active.path.slice(0, 4000)} : null}; this.channel.publish() }
  save(state: SaveState): void { this.channel.view.save = state; this.channel.publish() }
  notify = (message: string): void => {
    this.channel.view.notice = message.slice(0, 4000); this.channel.publish()
    clearTimeout(this.noticeTimer)
    this.noticeTimer = setTimeout(() => { this.channel.view.notice = ''; this.channel.publish() }, 5000)
  }
  revealCanvas(): void {} // Host navigation follows the active document/annotation projection.
  sidebar(callbacks: SidebarCallbacks, model: ReviewList) { return nativeReviews(this.channel, callbacks, model) }
  documents(callbacks: FileTreeCallbacks, model: DocumentList) { return nativeDocuments(this.channel, callbacks, model) }
  selection(callbacks: PinCallbacks) { return nativeSelection(this.channel, this.interactions, callbacks) }
  annotation(callbacks: PopupCallbacks) { return nativeAnnotationEditor(this.interactions, callbacks) }
  search(callbacks: SearchPanelCallbacks, model: Search) { return nativeSearch(this.interactions, model, callbacks) }
  exporter(callbacks: ExporterCallbacks) { return nativeExporter(this.interactions, callbacks, this.notify) }
  trash(callbacks: TrashDialogCallbacks) { return nativeTrash(this.interactions, callbacks) }

  choice(options: ConfirmOptions): Promise<ConfirmChoice> {
    return new Promise(resolve => {
      this.interactions.open<'choice'>({type: 'choice', title: options.title, description: options.description ?? '',
        confirmText: options.confirmText ?? '确认', cancelText: options.cancelText ?? '取消', altText: options.altText, danger: options.danger ?? false}, (command, id) => {
        if (command.choice === 'alt' && !options.altText) throw new Error('此操作不可用')
        this.interactions.close(id)
        resolve(command.choice)
      })
    })
  }

  textDraft(): string | null { return this.textId && !this.submittingText ? this.interactions.get(this.textId, 'text')?.value ?? null : null }
  text(options: TextDialogOptions): void {
    if (this.textId) { this.notify('请先完成当前文本输入'); return }
    this.textId = this.interactions.open<'text'>({type: 'text', title: options.title, description: options.description ?? '', placeholder: options.placeholder ?? '',
      inputLabel: options.inputLabel ?? options.title, value: options.value ?? '', confirmText: options.confirmText ?? '确认'}, (command, id) => {
      if (command.action === 'cancel') { this.interactions.close(id); this.textId = null; return }
      this.interactions.update(id, 'text', {value: command.value, error: ''})
      if (command.action === 'change') return
      const error = options.validate?.(command.value)
      if (error) { this.interactions.update(id, 'text', {error}); return }
      this.submittingText = true
      try {
        options.onSubmit(command.value)
        this.interactions.close(id); this.textId = null
      } finally { this.submittingText = false }
    })
  }

  settings(prefs: ReadingPrefs, onChange: (prefs: ReadingPrefs) => void): Promise<void> {
    return new Promise(resolve => {
      this.interactions.open<'settings'>({type: 'settings', title: '阅读设置', prefs}, (command, id) => {
        if (command.action === 'close') { this.interactions.close(id); resolve(); return }
        onChange(command.prefs)
        this.interactions.update(id, 'settings', {prefs: command.prefs})
      })
    })
  }

  importConflict(plan: ImportPlan, docs: DocItem[]): Promise<ImportRow[] | null> {
    return new Promise(resolve => {
      let rows = plan.rows
      const previews = rows.map(row => row.existing ? reanchorAnnotations(row.existing.text, row.incoming.text, row.existing.annotations) : null)
      const project = () => rows.map((row, index) => ({index, name: row.incoming.name, path: row.incoming.path, action: row.action,
        renameTo: row.renameTo ?? '', annotationCount: row.existing?.annotations.length ?? 0,
        lost: previews[index]?.clamped ?? 0, moved: previews[index]?.moved ?? 0}))
      const canSubmit = () => rows.some(row => row.action !== 'skip' && row.action !== 'identical')
      this.interactions.open<'import'>({type: 'import', title: '导入冲突诊断', rows: project(), canSubmit: canSubmit()}, (command, id) => {
        if (command.action === 'cancel') { this.interactions.close(id); resolve(null); return }
        if (command.action === 'submit') { if (canSubmit()) { this.interactions.close(id); resolve(rows) }; return }
        if (command.action === 'row') rows = setRowAction(rows, docs, command.index, command.decision)
        if (command.action === 'preset') rows = applyPreset(rows, docs, command.preset)
        this.interactions.update(id, 'import', {rows: project(), canSubmit: canSubmit()})
      })
    })
  }
}
