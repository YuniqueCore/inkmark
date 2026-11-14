/** 批注回收站：删除 → 7 天保留 → 过期自动清理 / 用户彻底删除。纯函数，无 DOM。
 *
 * 双类型模型：批注条目（type:'annotation'）与整文档条目（type:'doc'）共用
 * 一个保留期与一套恢复/清理语义。回收站条目自持数据、与 docs 解耦——
 * 文档被删后其中的批注条目滞留回收站（不可恢复、可彻底删除）；
 * 导出 / W3C / 重锚只走 doc.annotations，回收站不参与。
 */

import type { ReviewDocument, TrashEntry, TrashedAnnotation, TrashedDoc } from './types'
import { uniqueDocumentName } from './import-conflict'
import { availableId } from './identity'
import { annotationFits, targetIdentity } from './image'
import { appendAnnotations, filterAnnotations, remapAnnotationIds } from './document'

/** 回收站保留期：7 天 */
export const TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

/** 条目唯一键包含类型，不依赖不同实体的 ID 命名空间互斥。 */
export function entryKey(t: TrashEntry): string {
  return t.type === 'doc' ? `doc:${t.doc.id}` : `annotation:${t.annotation.id}`
}

/** 从文档移除批注并包装为回收站条目（保持原顺序）。纯函数。 */
export function trashFromDoc(
  doc: ReviewDocument,
  ids: ReadonlySet<string>,
  now: number,
): { doc: ReviewDocument; trashed: TrashedAnnotation[] } {
  const removed = doc.annotations.filter((a) => ids.has(a.id))
  return {
    doc: filterAnnotations(doc, (a) => !ids.has(a.id)),
    trashed: removed.map((a) => ({
      type: 'annotation' as const,
      annotation: a,
      targetIdentity: targetIdentity(doc, a) ?? undefined,
      docId: doc.id,
      docName: doc.name,
      deletedAt: now,
    })),
  }
}

/** 移除整文档并入站：条目持有完整 ReviewDocument，恢复即整份找回。纯函数。 */
export function trashDocs(
  docs: ReviewDocument[],
  ids: ReadonlySet<string>,
  now: number,
): { docs: ReviewDocument[]; trashed: TrashedDoc[] } {
  const removed = docs.filter((d) => ids.has(d.id))
  return {
    docs: docs.filter((d) => !ids.has(d.id)),
    trashed: removed.map((d) => ({ type: 'doc' as const, doc: d, deletedAt: now })),
  }
}

/** 清理超过保留期的条目：now - deletedAt >= retentionMs 判过期。纯函数。 */
export function purgeExpired(
  trash: TrashEntry[],
  now: number,
  retentionMs: number = TRASH_RETENTION_MS,
): { keep: TrashEntry[]; purged: TrashEntry[] } {
  const keep: TrashEntry[] = []
  const purged: TrashEntry[] = []
  for (const t of trash) (now - t.deletedAt >= retentionMs ? purged : keep).push(t)
  return { keep, purged }
}

export interface RestoreResult {
  trash: TrashEntry[]
  docs: ReviewDocument[]
  /** 成功恢复的条数（文档按份计，批注按条计） */
  restored: number
  /** 批注条目原文档已删除、无法恢复的条数（留在回收站，可彻底删除） */
  stranded: number
}

/** 恢复：文档条目整份回 docs；批注条目追加回原文档，原文档不存在则滞留。纯函数。 */
export function restoreFromTrash(
  trash: TrashEntry[],
  docs: ReviewDocument[],
  selection: ReadonlySet<string>,
): RestoreResult {
  const picking = trash.filter((t) => selection.has(entryKey(t)))
  if (picking.length === 0) return { trash, docs, restored: 0, stranded: 0 }
  const alive = new Set(docs.map((d) => d.id))
  const restoredDocs: ReviewDocument[] = []
  const annotationsByDoc = new Map<string, TrashedAnnotation[]>()
  const pickedKeys = new Set<string>()
  const usedIds = new Set([
    ...docs.flatMap((d) => d.annotations.map((a) => a.id)),
    ...trash.filter((t) => !selection.has(entryKey(t))).flatMap((t) =>
      t.type === 'doc' ? t.doc.annotations.map((a) => a.id) : [t.annotation.id]),
  ])
  let stranded = 0
  // 先恢复文档，再处理批注；同批恢复的批注也可以落回其文档。
  for (const t of picking) {
    if (t.type !== 'doc') continue
    if (alive.has(t.doc.id)) {
      stranded += 1
      continue
    }
    const name = uniqueDocumentName(t.doc.name, t.doc.path, [...docs, ...restoredDocs])
    const restored = remapAnnotationIds(t.doc, (oldId) => {
      const id = availableId(oldId, usedIds)
      usedIds.add(id)
      return id
    })
    restoredDocs.push({...restored, name})
    alive.add(t.doc.id)
    pickedKeys.add(entryKey(t))
  }
  for (const t of picking) {
    if (t.type !== 'annotation') continue
    const target = [...docs, ...restoredDocs].find((d) => d.id === t.docId)
    if (!target || !annotationFits(target, t.annotation) ||
      (t.targetIdentity !== undefined && t.targetIdentity !== targetIdentity(target, t.annotation))) {
      stranded += 1
      continue
    }
    const list = annotationsByDoc.get(t.docId) ?? []
    const id = availableId(t.annotation.id, usedIds)
    usedIds.add(id)
    list.push(id === t.annotation.id ? t : {...t, annotation: {...t.annotation, id}})
    annotationsByDoc.set(t.docId, list)
    pickedKeys.add(entryKey(t))
  }
  return {
    trash: trash.filter((t) => !pickedKeys.has(entryKey(t))),
    docs: [
      ...[...docs, ...restoredDocs].map((d) => {
        const back = annotationsByDoc.get(d.id)
        return back ? appendAnnotations(d, back.map((t) => t.annotation)) : d
      }),
    ],
    restored: restoredDocs.length + [...annotationsByDoc.values()].reduce((n, l) => n + l.length, 0),
    stranded,
  }
}

/** 彻底删除：从回收站移除指定条目，不可恢复。纯函数。 */
export function purgeForever(trash: TrashEntry[], selection: ReadonlySet<string>): TrashEntry[] {
  return trash.filter((t) => !selection.has(entryKey(t)))
}
