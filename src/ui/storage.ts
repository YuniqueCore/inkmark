/** One atomic, self-contained workspace snapshot; no persistent object URLs. */
import { createStore, get, set, del } from 'idb-keyval'
import { parseWorkspace } from '../core/session'
import { purgeExpired } from '../core/trash'
import { SESSION_VERSION, type Workspace } from '../core/types'

const LEGACY_KEY = 'inkmark:session:v1'
const store = createStore('inkmark-workspace', 'snapshots')
const KEY = 'workspace'
let unreadableWorkspace: string | null = null
let readFailed = false

export function unreadableWorkspaceData(): string | null { return unreadableWorkspace }

export async function replaceUnreadableWorkspace(ws: Workspace): Promise<boolean> {
  if (unreadableWorkspace === null) return false
  try {
    await set(KEY, JSON.stringify(ws), store)
    unreadableWorkspace = null
    removeLegacy()
    return true
  } catch { return false }
}

export async function loadWorkspace(): Promise<Workspace> {
  try {
    const stored = await get<string>(KEY, store)
    const raw = stored ?? localStorage.getItem(LEGACY_KEY)
    if (!raw) return emptyWorkspace()
    const ws = parseWorkspace(raw)
    if (!ws) {
      unreadableWorkspace = raw
      return emptyWorkspace()
    }
    return {...ws, trash: purgeExpired(ws.trash, Date.now()).keep}
  } catch {
    // Never overwrite a database that could not be read. Reload to retry.
    readFailed = true
    return emptyWorkspace()
  }
}

export async function saveWorkspace(snapshot: string): Promise<boolean> {
  if (unreadableWorkspace !== null || readFailed) return false
  try {
    await set(KEY, snapshot, store)
    removeLegacy()
    return true
  } catch { return false }
}

function removeLegacy(): void {
  try { localStorage.removeItem(LEGACY_KEY) } catch { /* IndexedDB is already committed. */ }
}

export async function clearWorkspaceStorage(): Promise<void> {
  await del(KEY, store)
  removeLegacy()
}

export function emptyWorkspace(): Workspace {
  return {version: SESSION_VERSION, docs: [], activeDocId: '', trash: [], savedAt: Date.now()}
}
