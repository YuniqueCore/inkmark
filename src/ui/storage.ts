/** 工作区持久化：localStorage 是唯一 IO 边界。v1 旧数据自动迁移。 */

import { parseWorkspace } from '../core/session'
import { purgeExpired } from '../core/trash'
import { SESSION_VERSION } from '../core/types'
import type { Workspace } from '../core/types'

const KEY = 'inkmark:session:v1' // 键沿用，内部按 version 字段迁移

export function loadWorkspace(): Workspace {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return emptyWorkspace()
    const ws = parseWorkspace(raw) ?? emptyWorkspace()
    // 启动即清理超过保留期的回收站条目（唯一的过期清理入口，会话中途不再轮询）
    return { ...ws, trash: purgeExpired(ws.trash, Date.now()).keep }
  } catch {
    return emptyWorkspace()
  }
}

export function saveWorkspace(ws: Workspace): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ws))
  } catch {
    // 配额溢出（大文件夹导入）：静默失败，导出能力不受影响
  }
}

export function clearWorkspaceStorage(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // 同上
  }
}

export function emptyWorkspace(): Workspace {
  return { version: SESSION_VERSION, docs: [], activeDocId: '', trash: [], savedAt: Date.now() }
}
