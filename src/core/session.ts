/** 会话迁移：v1 单文档 → v2 多文档工作区。纯函数。 */

import type { DocItem, SessionV1, Workspace } from './types'

export function migrateV1(old: SessionV1): Workspace {
  const doc: DocItem = {
    id: 'doc-' + old.savedAt.toString(36),
    name: old.text.slice(0, 24).replace(/\s+/g, ' ').trim() || '未命名文档',
    path: '',
    text: old.text,
    annotations: old.annotations,
    addedAt: old.savedAt,
  }
  return { version: 2, docs: [doc], activeDocId: doc.id, savedAt: old.savedAt }
}

/** 任意存储读数的防御性解析：合法 v2 返回，v1 迁移，其余 null。 */
export function parseWorkspace(raw: string): Workspace | null {
  try {
    const parsed = JSON.parse(raw) as SessionV1 | Workspace
    if (parsed.version === 2 && Array.isArray(parsed.docs)) return parsed
    if (parsed.version === 1 && typeof parsed.text === 'string') return migrateV1(parsed)
    return null
  } catch {
    return null
  }
}
