/** 会话持久化：localStorage 是唯一 IO 边界（core 不触存储）。 */

import type { Session } from '../core/types'

const KEY = 'inkmark:session:v1'

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Session
    if (parsed.version !== 1 || typeof parsed.text !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

export function saveSession(session: Session): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(session))
  } catch {
    // 存储满/隐私模式：静默失败，导出功能不受影响
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // 同上
  }
}
