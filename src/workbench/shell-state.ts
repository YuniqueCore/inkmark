import type {DocumentSummary} from './documents'
import type {ReadingPrefs} from '../core/prefs'

export type ReadingMode = 'source' | 'split' | 'preview'
export type WorkspaceMode = 'annotate' | 'diff' | 'edit'
export type WorkspaceAction = 'new' | 'files' | 'folder' | 'paste-image' | 'sample' | 'scan' | 'edit' |
  'diff' | 'clear-revised' | 'export' | 'search' | 'trash' | 'backup' | 'recovery' | 'restore' | 'remove' |
  'settings' | 'theme' | 'raw-backup' | 'reset-storage' | 'legacy-backup'

export interface ChromeState {
  ready: boolean
  active: DocumentSummary | null
  mode: WorkspaceMode
  readingMode: ReadingMode
  hasRevised: boolean
  trashCount: number
  legacyRecovery: boolean
  prefs: ReadingPrefs
}

export interface SaveState {
  status: 'saved' | 'dirty' | 'error'
  message: string
  rawRecovery: boolean
}

export interface ShellActions {
  execute: (action: WorkspaceAction) => void
  readingMode: (mode: ReadingMode) => void
  getPrefs: () => ReadingPrefs
  setPrefs: (prefs: ReadingPrefs) => void
}
