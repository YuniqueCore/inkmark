/** One atomic, self-contained workspace snapshot; no persistent object URLs. */
import { createStore, get, update } from 'idb-keyval'
import { parseWorkspace } from '../core/session'
import { purgeExpired } from '../core/trash'
import { SESSION_VERSION, type Workspace } from '../core/types'

const LEGACY_KEY = 'inkmark:session:v1'
const store = createStore('inkmark-workspace', 'snapshots')
const KEY = 'workspace'
let unreadableWorkspace: string | null = null
let readFailed = false
let knownSnapshot: string | undefined
let conflict = false
let initialSave = false
export const needsInitialSave = (): boolean => initialSave
export const storageReadError = (): boolean => readFailed || unreadableWorkspace !== null
export const storageConflict = (): boolean => conflict

async function commit(snapshot: string): Promise<void> {
  let committed = snapshot
  await update<string>(KEY, (current) => {
    if (current && current !== knownSnapshot && sameContent(current, snapshot)) { committed = current; return current }
    if (current !== knownSnapshot) { conflict = true; throw new Error('Workspace changed in another tab') }
    return snapshot
  }, store)
  knownSnapshot = committed
}

function sameContent(a: string, b: string): boolean {
  try {
    const left = JSON.parse(a); const right = JSON.parse(b)
    delete left.savedAt; delete right.savedAt
    return JSON.stringify(left) === JSON.stringify(right)
  } catch { return false }
}

export function unreadableWorkspaceData(): string | null { return unreadableWorkspace }

/** Older tabs do not participate in IndexedDB transactions. Never erase their data automatically. */
export function legacyWorkspaceData(): string | null {
  try { return localStorage.getItem(LEGACY_KEY) } catch { return null }
}

export async function replaceWorkspace(ws: Workspace): Promise<boolean> {
  if (readFailed) return false
  try {
    await commit(JSON.stringify(ws))
    unreadableWorkspace = null
    conflict = false
    initialSave = false
    return true
  } catch { return false }
}

export async function loadWorkspace(): Promise<Workspace> {
  const legacy = legacyWorkspaceData()
  let raw = legacy
  try {
    const stored = await get<string>(KEY, store)
    knownSnapshot = stored
    raw = stored ?? legacy
    initialSave = stored === undefined
  } catch {
    // Keep available legacy data readable/exportable, but never overwrite an unreadable database.
    readFailed = true
  }
  if (!raw) return emptyWorkspace()
  const ws = parseWorkspace(raw)
  if (!ws) { unreadableWorkspace = raw; return emptyWorkspace() }
  const keep = purgeExpired(ws.trash, Date.now()).keep
  initialSave ||= keep.length !== ws.trash.length || JSON.parse(raw).version !== SESSION_VERSION
  return {...ws, trash: keep}
}

export async function saveWorkspace(snapshot: string): Promise<boolean> {
  if (unreadableWorkspace !== null || readFailed) return false
  try {
    await commit(snapshot)
    return true
  } catch { return false }
}

export function emptyWorkspace(): Workspace {
  return {version: SESSION_VERSION, docs: [], activeDocId: '', trash: [], savedAt: Date.now()}
}
