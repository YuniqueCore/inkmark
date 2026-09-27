/** 自动保存状态机：saved → dirty → saving → saved。
 *
 * 持有防抖计时器与状态栏 DOM（#save-dot / #save-text），并通过 beforeunload
 * 在脏状态下强制落盘一次。数据快照由调用方注入（模块不持有工作区状态）。
 */

import { saveWorkspace } from './storage'
import type { Workspace } from '../core/types'

type SaveStatus = 'saved' | 'dirty' | 'saving'

const LABEL: Record<SaveStatus, {cls: string; text: string}> = {
  saved: {cls: 'bg-emerald-500', text: '已保存'},
  dirty: {cls: 'bg-amber-500', text: '有未保存改动'},
  saving: {cls: 'bg-sky-400 animate-pulse', text: '保存中…'},
}

const DEBOUNCE_MS = 500
const SAVING_FLASH_MS = 150

export function initSaveStatus(getPayload: () => Workspace): {markDirty: () => void} {
  let status: SaveStatus = 'saved'
  let timer: ReturnType<typeof setTimeout> | undefined

  const render = (): void => {
    const dot = document.querySelector('#save-dot')
    const label = document.querySelector('#save-text')
    if (!dot || !label) return
    const s = LABEL[status]
    dot.className = `size-1.5 rounded-full ${s.cls}`
    label.textContent = s.text
  }

  const flush = (): void => {
    clearTimeout(timer)
    status = 'saving'
    render()
    saveWorkspace(getPayload())
    setTimeout(() => {
      status = 'saved'
      render()
    }, SAVING_FLASH_MS)
  }

  window.addEventListener('beforeunload', (e) => {
    if (status === 'dirty') {
      flush()
      e.preventDefault()
    }
  })

  return {
    markDirty(): void {
      status = 'dirty'
      render()
      clearTimeout(timer)
      timer = setTimeout(flush, DEBOUNCE_MS)
    },
  }
}
