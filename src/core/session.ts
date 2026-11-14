/** 会话迁移：v1 单文档 → v2 多文档 → v3 回收站。纯函数。 */

import type { DocItem, ReviewDocument, SessionV1, Workspace } from './types'
import { SESSION_VERSION } from './types'
import { annotationFits } from './image'
import { sessionSchema } from './session-schema'
import { safeParse } from 'valibot'

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
    const result = safeParse(sessionSchema, JSON.parse(raw))
    if (!result.success) return null
    const parsed = result.output
    const workspace = parsed.version === SESSION_VERSION ? parsed
      : parsed.version === 2 ? {...parsed, version: SESSION_VERSION, trash: []}
      : migrateV1(parsed)
    if (!validWorkspace(workspace)) return null
    if (!workspace.activeDocId && workspace.docs.length > 0) workspace.activeDocId = workspace.docs[0]!.id
    return workspace
  } catch {
    return null
  }
}

function validWorkspace(workspace: Workspace): boolean {
  const docIds = new Set<string>()
  const annotationIds = new Set<string>()
  const validDoc = (doc: ReviewDocument): boolean => {
    if (docIds.has(doc.id)) return false
    docIds.add(doc.id)
    for (const ann of doc.annotations) {
      if (!annotationFits(doc, ann) || annotationIds.has(ann.id)) return false
      annotationIds.add(ann.id)
    }
    return true
  }
  if (!workspace.docs.every(validDoc)) return false
  if (workspace.activeDocId && !workspace.docs.some((doc) => doc.id === workspace.activeDocId)) return false
  for (const entry of workspace.trash) {
    if (entry.type === 'doc') {
      if (!validDoc(entry.doc)) return false
    } else {
      if (annotationIds.has(entry.annotation.id)) return false
      annotationIds.add(entry.annotation.id)
    }
  }
  return true
}
