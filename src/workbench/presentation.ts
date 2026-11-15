import type {Annotation, DocItem, ReviewDocument, TrashEntry} from '../core/types'
import type {ReadingPrefs} from '../core/prefs'
import type {ImportPlan, ImportRow} from '../core/import-conflict'
import type {AnnotationPresentation} from './annotation-presentation'
import type {DocumentList, DocumentSummary} from './documents'
import type {ReviewList} from './review-list'
import type {Search, SearchDocument} from './search'
import type {PinCallbacks, SelectionInfo} from '../ui/selection-pin'
import type {PopupCallbacks} from '../ui/annotation-popup'
import type {SidebarCallbacks, SidebarRenderOptions} from '../ui/sidebar'
import type {FileTreeCallbacks} from '../ui/filetree'
import type {SearchPanelCallbacks} from '../ui/search-panel'
import type {ExporterCallbacks} from '../ui/exporter'
import type {TrashDialogCallbacks} from '../ui/trash-dialog'
import type {ConfirmOptions, ConfirmChoice, TextDialogOptions} from '../ui/confirm'

import type {SourceEditing, ImageControls} from './surface-controls'

import type {ShellActions, ChromeState, SaveState} from './shell-state'

export interface SelectionPresentation {
  showFor(info: SelectionInfo): void
  dismiss(): void
  hasDrafts(docIds?: ReadonlySet<string>, side?: 'a' | 'b'): boolean
  discardDrafts(docIds: ReadonlySet<string>, side?: 'a' | 'b'): void
}

export interface AnnotationEditor {
  setAnchorRect(rect: DOMRect, root?: HTMLElement): void
  openFor(id: string, text: string, annotations: Annotation[], edit?: boolean): void
  sync(text: string, annotations: Annotation[], revised?: string): void
  close(): void
  hasDraft(): boolean
}

export interface SearchPresentation {
  hasDraft(): boolean
  isOpen(): boolean
  toggle(docs: SearchDocument[], activeDocId: string): void
  close(): void
  setDocs(docs: SearchDocument[], activeDocId: string): void
}

export interface ExportPresentation {
  open(docs: ReviewDocument[], options?: {includeResolved?: boolean}): void
  close(): void
}

export interface TrashPresentation {
  open(trash: TrashEntry[], now: number): void
  update(trash: TrashEntry[], now: number): void
  close(): void
}

/** Rendering boundary: each platform supplies controls; the workbench supplies their actions. */
export interface Presentation {
  sourceEditor: SourceEditing
  imageControls: ImageControls
  welcome(root: HTMLElement, onNew: () => void, onSample: () => void): void
  mount(actions: ShellActions): void
  render(state: ChromeState): void
  save(state: SaveState): void
  notify(message: string): void
  revealCanvas(): void
  sidebar(callbacks: SidebarCallbacks, model: ReviewList): {render(annotations: AnnotationPresentation[], options?: SidebarRenderOptions): void}
  documents(callbacks: FileTreeCallbacks, model: DocumentList): {render(docs: DocumentSummary[], activeId: string): void}
  selection(callbacks: PinCallbacks): SelectionPresentation
  annotation(callbacks: PopupCallbacks): AnnotationEditor
  search(callbacks: SearchPanelCallbacks, model: Search): SearchPresentation
  exporter(callbacks: ExporterCallbacks): ExportPresentation
  trash(callbacks: TrashDialogCallbacks): TrashPresentation
  choice(options: ConfirmOptions): Promise<ConfirmChoice>
  text(options: TextDialogOptions): void
  textDraft(): string | null
  settings(prefs: ReadingPrefs, onChange: (prefs: ReadingPrefs) => void): Promise<void>
  importConflict(plan: ImportPlan, docs: DocItem[]): Promise<ImportRow[] | null>
}
