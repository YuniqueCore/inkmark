import {entryKey, purgeExpired, purgeForever, restoreFromTrash, trashDocs, trashFromDoc} from '../core/trash'
import {isRegionAnnotation, type ReviewDocument, type TrashEntry} from '../core/types'
import {patchAnnotationBodies} from '../core/document'
import type {WorkspaceStore} from './workspace'
import type {Presentation, SelectionPresentation, AnnotationEditor} from './presentation'
import type {WorkspaceMode} from './shell-state'
import type {ConfirmOptions} from '../ui/confirm'

export const trashedDocIds = (entries: TrashEntry[]): Set<string> => new Set(entries.flatMap(entry => entry.type === 'doc' ? [entry.doc.id] : []))

interface TrashBindings {
  workspace: WorkspaceStore
  mode: WorkspaceMode
  active(): ReviewDocument | undefined
  canLeave(): boolean
  imageDraft(): boolean
  presentation: Pick<Presentation, 'choice' | 'trash'>
  selection: SelectionPresentation
  annotation: AnnotationEditor
  confirm(options: ConfirmOptions): Promise<boolean>
  mutate(update: (doc: ReviewDocument) => ReviewDocument): void
  render(): void
  invalidate(id: string): void
  notify(message: string): void
}

export function createTrash(ctx: TrashBindings) {
const workspace = ctx.workspace
// ---------------------------------------------------------------- 批注命令

/** 删除批注 → 回收站（7 天保留，可恢复；彻底删除在回收站里二次确认）。
 * 选中含失锚批注时给出「标记为已解决」引导：失锚批注的批语仍然完整，
 * 归档比删除更有利于保留以往的标注。弹层与侧栏共用同一命令 */
const deleteAnnotation = (ids: string[]): void => {
  if (ctx.imageDraft()) { ctx.notify('请先保存或取消当前区域批注'); return }
  void (async () => {
    const doc = ctx.active()
    const picked = doc?.annotations.filter((a) => ids.includes(a.id)) ?? []
    const lostCount = picked.filter((a) => !isRegionAnnotation(a) && a.anchorLost === true).length
    const choice = await ctx.presentation.choice({
      title: ids.length > 1 ? `删除这 ${ids.length} 条批注？` : '删除这条批注？',
      description:
        '删除后进入回收站，保留 7 天，可随时恢复。' +
        (lostCount > 0
          ? `其中 ${lostCount} 条已失去锚点：批语仍然完整，建议改为「标记为已解决」归档，避免丢失以往的标注。`
          : ''),
      confirmText: '删除',
      danger: true,
      ...(lostCount > 0 ? { altText: `标记为已解决（${lostCount}）` } : {}),
    })
    if (choice === 'cancel') return
    if (!doc || ctx.active() !== doc || document.body.inert) {
      ctx.notify('文档在操作期间发生变化，请重新确认删除')
      return
    }
    if (choice === 'alt') {
      // 引导路径：不删除，把所选批注全部归档为已解决
      const altSet = new Set(ids)
      ctx.mutate((doc) => patchAnnotationBodies(doc, altSet, {status: 'resolved', updatedAt: Date.now()}))
      ctx.notify(`已将 ${ids.length} 条批注标记为已解决`)
      return
    }
    const idSet = new Set(ids)
    const { doc: nextDoc, trashed } = trashFromDoc(doc, idSet, Date.now())
    workspace.current = {
      ...workspace.current,
      docs: workspace.current.docs.map((d) => (d.id === doc.id ? nextDoc : d)),
      trash: [...workspace.current.trash, ...trashed],
    }
    ctx.render()
    ctx.notify(`已删除 ${ids.length} 条批注，可在回收站恢复`)
  })()
}

// ---------------------------------------------------------------- 回收站

const trashDialog = ctx.presentation.trash({
  onRestore: (ids) => {
    const r = restoreFromTrash(workspace.current.trash, workspace.current.docs, new Set(ids))
    workspace.current = { ...workspace.current, trash: r.trash, docs: r.docs, activeDocId: workspace.current.activeDocId || r.docs[0]?.id || '' }
    ctx.render()
    ctx.notify(
      r.stranded > 0
        ? `已恢复 ${r.restored} 项；${r.stranded} 项因原文档不存在、内容已变化或 ID 冲突未恢复`
        : `已恢复 ${r.restored} 项`,
    )
    trashDialog.update(workspace.current.trash, Date.now())
  },
  onPurge: (ids) => {
    void (async () => {
      const initialTrash = workspace.current.trash
      const selected = new Set(ids)
      const docIds = trashedDocIds(initialTrash.filter((entry) => selected.has(entryKey(entry))))
      const draftNote = ctx.selection.hasDrafts(docIds) ? ' 这些文档中未提交的划词草稿也会被放弃。' : ''
      const ok = await ctx.confirm({
        title: ids.length > 1 ? `彻底删除这 ${ids.length} 项？` : '彻底删除此项？',
        description: `彻底删除后不可恢复。${draftNote}`,
        confirmText: '彻底删除',
        danger: true,
      })
      if (!ok) return
      if (workspace.current.trash !== initialTrash) {
        ctx.notify('回收站在操作期间发生变化，请重试')
        return
      }
      ctx.selection.discardDrafts(docIds)
      workspace.current = { ...workspace.current, trash: purgeForever(workspace.current.trash, selected) }
      ctx.render()
      trashDialog.update(workspace.current.trash, Date.now())
      ctx.notify(`已彻底删除 ${ids.length} 项`)
    })()
  },
  onClearAll: () => {
    void (async () => {
      const initialTrash = workspace.current.trash
      const docIds = trashedDocIds(initialTrash)
      const draftNote = ctx.selection.hasDrafts(docIds) ? ' 这些文档中未提交的划词草稿也会被放弃。' : ''
      const ok = await ctx.confirm({
        title: '清空回收站？',
        description: `将彻底删除回收站里的 ${initialTrash.length} 项，不可恢复。${draftNote}`,
        confirmText: '清空',
        danger: true,
      })
      if (!ok) return
      if (workspace.current.trash !== initialTrash) {
        ctx.notify('回收站在操作期间发生变化，请重试')
        return
      }
      ctx.selection.discardDrafts(docIds)
      workspace.current = { ...workspace.current, trash: [] }
      ctx.render()
      trashDialog.update([], Date.now())
      ctx.notify('回收站已清空')
    })()
  },
  onClose: () => trashDialog.close(),
})

/** 打开回收站：进入前顺手清一次过期条目（长会话期间 7 天窗口会自然过期） */
function openTrash(): void {
  const { keep, purged } = purgeExpired(workspace.current.trash, Date.now())
  const protectedDocs = purged.filter((entry) => entry.type === 'doc' && ctx.selection.hasDrafts(new Set([entry.doc.id])))
  const expired = new Set(purged)
  const protectedEntries = new Set(protectedDocs)
  const remaining = protectedDocs.length > 0
    ? workspace.current.trash.filter((entry) => !expired.has(entry) || protectedEntries.has(entry))
    : keep
  const removed = remaining.length !== workspace.current.trash.length
  if (removed) workspace.current = { ...workspace.current, trash: remaining }
  trashDialog.open(remaining, Date.now())
  if (protectedDocs.length > 0) ctx.notify('有未提交草稿的过期文档暂保留在回收站')
  if (removed) ctx.render()
}


async function removeDoc(id: string): Promise<void> {
  const doc = workspace.current.docs.find((d) => d.id === id)
  if (!doc) return
  if (id === workspace.current.activeDocId && !ctx.canLeave()) return
  const count = doc.annotations.length
  const draftNote = ctx.selection.hasDrafts(new Set([id])) ? ' 未提交的划词草稿仅保留在当前页面；恢复文档后可重选取回。' : ''
  const ok = await ctx.confirm({
    title: `移除「${doc.name}」？`,
    description:
      count > 0
        ? `其中 ${count} 条批注会一并移入回收站，保留 7 天，可随时恢复。${draftNote}`
        : `移入回收站后保留 7 天，可随时恢复。${draftNote}`,
    confirmText: '移除',
    danger: true,
  })
  if (!ok) return
  if (workspace.current.docs.find((d) => d.id === id) !== doc || document.body.inert) {
    ctx.notify('文档在操作期间发生变化，请重新确认删除')
    return
  }
  await removeDocsConfirmed([id])
  ctx.notify(`已移除 ${doc.name}，可在回收站恢复`)
}

/** 多选移除入口：先统一确认，再落盘 */
async function removeDocs(ids: string[]): Promise<void> {
  if (ids.includes(workspace.current.activeDocId) && !ctx.canLeave()) return
  const docs = workspace.current.docs.filter((d) => ids.includes(d.id))
  if (docs.length === 0) return
  const count = docs.reduce((acc, d) => acc + d.annotations.length, 0)
  // 名称清单截断展示：多文档批量删除不把确认弹层撑成长清单（弹层本身另有滚动兜底）
  const shown = docs.slice(0, 3).map((d) => d.name).join('、')
  const names = docs.length > 3 ? `${shown} 等 ${docs.length} 份文档` : shown
  const draftNote = ctx.selection.hasDrafts(new Set(ids)) ? ' 未提交的划词草稿仅保留在当前页面；恢复文档后可重选取回。' : ''
  const ok = await ctx.confirm({
    title: `移除 ${docs.length} 个文档？`,
    description: `${names}${count > 0 ? `（共 ${count} 条批注）` : ''}——移入回收站，保留 7 天，可随时恢复。${draftNote}`,
    confirmText: '移除',
    danger: true,
  })
  if (!ok) return
  if (docs.some((doc) => workspace.current.docs.find((d) => d.id === doc.id) !== doc) || document.body.inert) {
    ctx.notify('文档在操作期间发生变化，请重新确认删除')
    return
  }
  await removeDocsConfirmed(ids)
  ctx.notify(`已移除 ${docs.length} 个文档`)
}

/** 已确认的删除落盘：文档整份入回收站、清运行时缓存、维护活动文档、重渲染 */
async function removeDocsConfirmed(ids: string[]): Promise<void> {
  const idSet = new Set(ids)
  workspace.current.docs.filter((d) => idSet.has(d.id)).forEach((d) => ctx.invalidate(d.id))
  const { docs, trashed } = trashDocs(workspace.current.docs, idSet, Date.now())
  const activeRemoved = idSet.has(workspace.current.activeDocId)
  workspace.current = {
    docs,
    activeDocId: activeRemoved ? (docs[0]?.id ?? '') : workspace.current.activeDocId,
    trash: [...workspace.current.trash, ...trashed],
  }
  if (activeRemoved) {
    // 编辑的是被移除文档的文本，随文档一起终止（与 switchDoc 同规则）
    if (ctx.mode === 'edit') ctx.mode = 'annotate'
    ctx.annotation.close()
    ctx.selection.dismiss()
  }
  ctx.render()
}


return {deleteAnnotation, openTrash, removeDoc, removeDocs}
}
