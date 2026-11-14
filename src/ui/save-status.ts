/** 自动保存状态机：saved → dirty → saved / error。
 *
 * 持有防抖计时器与状态栏 DOM（#save-dot / #save-text），并通过 beforeunload
 * 在脏状态下强制落盘一次。数据快照由调用方注入（模块不持有工作区状态）。
 */

import { saveWorkspace, unreadableWorkspaceData } from './storage'
import type { Workspace } from '../core/types'

type SaveStatus = 'saved' | 'dirty' | 'error'

const LABEL: Record<SaveStatus, {cls: string; text: string}> = {
  saved: {cls: 'bg-emerald-500', text: '已保存'},
  dirty: {cls: 'bg-amber-500', text: '有未保存改动'},
  error: {cls: 'bg-red-500', text: '保存失败，请检查浏览器存储'},
}

const DEBOUNCE_MS = 500
export function initSaveStatus(getPayload: () => Workspace): {markDirty: () => void} {
  let status: SaveStatus = 'saved'
  let timer: ReturnType<typeof setTimeout> | undefined

  const render = (): void => {
    const dot = document.querySelector('#save-dot')
    const label = document.querySelector('#save-text')
    const error = document.querySelector<HTMLElement>('#save-error')
    const rawBackup = document.querySelector<HTMLElement>('#btn-raw-backup')
    const resetStorage = document.querySelector<HTMLElement>('#btn-reset-storage')
    if (!dot || !label) return
    const s = LABEL[status]
    dot.className = `size-1.5 rounded-full ${s.cls}`
    label.textContent = s.text
    document.querySelector('#save-status')?.setAttribute('title', s.text)
    if (error) error.hidden = status !== 'error'
    if (rawBackup) rawBackup.hidden = unreadableWorkspaceData() === null
    if (resetStorage) resetStorage.hidden = unreadableWorkspaceData() === null
  }

  let revision = 0
  let queue = Promise.resolve()
  const flush = (): void => {
    clearTimeout(timer)
    const saving = revision
    const snapshot = JSON.stringify(getPayload())
    queue = queue.then(async () => {
      const ok = await saveWorkspace(snapshot)
      if (saving !== revision) return
      status = ok ? 'saved' : 'error'
      render()
    })
  }

  window.addEventListener('beforeunload', (e) => {
    if (status !== 'saved') {
      flush()
      // Unload cannot await IndexedDB: warn until the transaction has committed.
      e.preventDefault()
      e.returnValue = ''
    }
  })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && status === 'dirty') flush()
  })

  return {
    markDirty(): void {
      revision++
      status = 'dirty'
      render()
      clearTimeout(timer)
      timer = setTimeout(flush, DEBOUNCE_MS)
    },
  }
}
