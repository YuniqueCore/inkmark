/** 会话迁移：v1 单文档 → v2 多文档 → v3 回收站。纯函数。 */

import type { DocItem, SessionV1, SessionV2, Workspace } from './types'
import { SESSION_VERSION } from './types'

export function migrateV1(old: SessionV1): Workspace {
  const doc: DocItem = {
    id: 'doc-' + old.savedAt.toString(36),
    name: old.text.slice(0, 24).replace(/\s+/g, ' ').trim() || '未命名文档',
    path: '',
    text: old.text,
    annotations: old.annotations,
    addedAt: old.savedAt,
  }
  return {
    version: SESSION_VERSION,
    docs: [doc],
    activeDocId: doc.id,
    trash: [],
    savedAt: old.savedAt,
  }
}

/** 任意存储读数的防御性解析：合法 v3 返回，v2/v1 迁移，其余 null。 */
export function parseWorkspace(raw: string): Workspace | null {
  try {
    const parsed = JSON.parse(raw) as SessionV1 | SessionV2 | Workspace
    if (
      parsed.version === SESSION_VERSION &&
      Array.isArray((parsed as Workspace).docs) &&
      Array.isArray((parsed as Workspace).trash)
    ) {
      return parsed as Workspace
    }
    if (parsed.version === 2 && Array.isArray((parsed as SessionV2).docs)) {
      return { ...(parsed as SessionV2), version: SESSION_VERSION, trash: [] }
    }
    if (parsed.version === 1 && typeof (parsed as SessionV1).text === 'string') {
      return migrateV1(parsed as SessionV1)
    }
    return null
  } catch {
    return null
  }
}
