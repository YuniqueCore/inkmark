import type {ReviewDocument, DocItem} from '../core/types'
import {isImageDocument, isTextDocument} from '../core/types'
import {importFileList, prepareSessionDocs, newDocId, type ImportContext, type ImportOutcome, type W3CRouted} from '../core/import'
import {buildImportPlan, uniqueDocumentName} from '../core/import-conflict'
import {reanchorAnnotations} from '../core/reanchor'
import {importedAnnotationId} from '../core/identity'
import {appendAnnotations} from '../core/document'
import {annotationFits} from '../core/image'
import {readRaster, verifyRaster} from '../platform/image-input'
import {beginFileOperation} from '../platform/files'
import type {WorkspaceStore} from './workspace'
import type {Presentation} from './presentation'

interface ImportContextBindings {
  workspace: WorkspaceStore
  ready: Promise<void>
  canLeave(): boolean
  active(): ReviewDocument | undefined
  presentation: Pick<Presentation, 'importConflict'>
  confirmDrafts(docIds: ReadonlySet<string>, side: 'a' | 'b', unchanged: () => boolean): Promise<boolean>
  dismissSelection(): void
  closeAnnotation(): void
  render(): void
  notify(message: string): void
}

export function createImports(ctx: ImportContextBindings) {
  const workspace = ctx.workspace
async function readImport(files: FileList | File[], context: ImportContext): Promise<ImportOutcome | null> {
  try {
    return await importFileList(files, context)
  } catch {
    ctx.notify('读取文件失败，请检查文件后重试')
    return null
  }
}

/** 文件导入编排：管线（分类/解析）在 core/import.ts，冲突判定在 core/import-conflict.ts，
 * 这里只做诊断弹出、状态应用与提示。工作区为空 → 直接导入；存在同名冲突 → 先弹
 * 诊断树（取消 = 整次导入作废，W3C/会话也一并作废），确认后一次性落盘。 */
async function importFiles(inputFiles: FileList | File[]): Promise<void> {
  const finish = beginFileOperation()
  try {
    const files = Array.from(inputFiles)
    await ctx.ready
    if (!ctx.canLeave()) return
    const initialDocs = workspace.current.docs
    const initialActiveId = workspace.current.activeDocId
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|svg)$/i.test(file.name))
    const imageDocs: ReviewDocument[] = []
    const imageErrors: string[] = []
    for (const file of imageFiles) {
      try {
        const image = await readRaster(file)
        const rel = file.webkitRelativePath || ''
        const path = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
        imageDocs.push({kind: 'image', id: newDocId(), name: uniqueDocumentName(file.name || '粘贴的图片.png', path, [...initialDocs, ...imageDocs]), path, image, annotations: [], addedAt: Date.now()})
      } catch (error) { imageErrors.push(`${file.name}: ${error instanceof Error ? error.message : '图片读取失败'}`) }
    }
    if (imageErrors.length > 0) ctx.notify(imageErrors.join('；'))
    const r = await readImport(Array.from(files).filter((file) => !imageFiles.includes(file)), { docs: initialDocs, currentDoc: ctx.active() })
    if (!r) return
    try {
      for (const doc of r.sessionDocs) if (isImageDocument(doc)) await verifyRaster(doc.image)
    } catch (error) { ctx.notify(error instanceof Error ? error.message : '备份中的图片无效'); return }
    const plan = buildImportPlan(
      r.textDocs.map((d) => ({name: d.name, path: d.path, text: d.text})),
      workspace.current.docs.filter(isTextDocument),
    )
    let rows = plan.rows
    if (plan.hasConflicts) {
      const decided = await ctx.presentation.importConflict(plan, workspace.current.docs.filter(isTextDocument))
      if (!decided) return
      rows = decided
    }
    if (!ctx.canLeave()) return
    if (workspace.current.docs !== initialDocs || workspace.current.activeDocId !== initialActiveId) {
      ctx.notify('工作区在导入期间发生变化，请重新导入')
      return
    }

    // 落盘：direct/rename 建新文档；overwrite 覆盖文本并重锚已有批注（编辑原文同款管线）
    const now = Date.now()
    const fresh: DocItem[] = []
    const overwrites = new Map<string, string>()
    let reanchored = 0
    let lost = 0
    for (const row of rows) {
      if (row.action === 'direct' || row.action === 'rename') {
        fresh.push({
          id: newDocId(),
          name: row.renameTo ?? row.incoming.name,
          path: row.incoming.path,
          text: row.incoming.text,
          annotations: [],
          addedAt: now,
        })
      } else if (row.action === 'overwrite' && row.existing) {
        overwrites.set(row.existing.id, row.incoming.text)
      }
    }

    if (!await ctx.confirmDrafts(new Set(overwrites.keys()), 'a', () =>
      workspace.current.docs === initialDocs && workspace.current.activeDocId === initialActiveId && ctx.canLeave(),
    )) return
    if (workspace.current.docs !== initialDocs || workspace.current.activeDocId !== initialActiveId || !ctx.canLeave()) {
      ctx.notify('工作区在导入期间发生变化，请重新导入')
      return
    }

    // Existing-document imports join the same overwrite/reanchor operation. New documents
    // receive their anchors after identity allocation, without changing the input-order contract.
    const existingIds = new Set(workspace.current.docs.map((doc) => doc.id))
    const applied = applyW3C(r.w3cRouted.filter((route) => route.docId === null || existingIds.has(route.docId)))
    const sessionDocs = prepareSessionDocs(r.sessionDocs, [...workspace.current.docs, ...imageDocs, ...fresh], workspace.current.trash)
    const newDocs = [...imageDocs, ...fresh, ...sessionDocs]
    if (overwrites.size > 0 || newDocs.length > 0) {
      const nextActiveId = imageDocs[0]?.id ?? fresh[0]?.id ?? sessionDocs[0]?.id ?? workspace.current.activeDocId
      if (nextActiveId !== workspace.current.activeDocId || overwrites.has(workspace.current.activeDocId)) {
        ctx.dismissSelection()
        ctx.closeAnnotation()
      }
      workspace.current = {
        docs: [
          ...workspace.current.docs.map((d) => {
            const text = overwrites.get(d.id)
            if (text === undefined || !isTextDocument(d)) return d
            const preview = reanchorAnnotations(d.text, text, d.annotations)
            reanchored += preview.moved
            lost += preview.clamped
            return {...d, text, annotations: preview.annotations}
          }),
          ...newDocs,
        ],
        activeDocId: nextActiveId,
        trash: workspace.current.trash,
      }
    }
    const incomingApplied = applyW3C(r.w3cRouted.filter((route) => route.docId !== null && !existingIds.has(route.docId)))
    applied.merged += incomingApplied.merged
    applied.unmatched += incomingApplied.unmatched
    applied.routed += incomingApplied.routed
    if (applied.merged > 0 || newDocs.length > 0 || overwrites.size > 0) ctx.render()
    const parts: string[] = []
    if (applied.merged > 0 || applied.unmatched > 0) parts.push(w3cToast(applied.merged, applied.unmatched, applied.routed))
    else if (r.w3cFiles > 0 && newDocs.length === 0 && overwrites.size === 0) {
      ctx.notify('这些批注已导入')
    } else if (newDocs.length === 0 && overwrites.size === 0 && r.w3cFiles === 0) {
      if (imageErrors.length === 0) ctx.notify(r.skipped > 0 ? `没有可导入的文本文件（跳过 ${r.skipped} 个）` : '没有可导入的文件')
    }
    if (newDocs.length > 0 || overwrites.size > 0) {
      const action = (a: string): number => rows.filter((row) => row.action === a).length
      if (imageErrors.length) parts.push(`${imageErrors.length} 张图片导入失败`)
      if (imageDocs.length) parts.push(`导入 ${imageDocs.length} 张图片`)
      const imported = action('direct') + action('rename')
      if (imported > 0) parts.push(`导入 ${imported} 个文档`)
      if (overwrites.size > 0) {
        let p = `覆盖 ${overwrites.size}`
        if (reanchored > 0 || lost > 0) p += `（重锚 ${reanchored}${lost > 0 ? ` · 失锚 ${lost}` : ''}）`
        parts.push(p)
      }
      if (r.sessionDocs.length > 0) parts.push(`会话已合并（${r.sessionDocs.length} 个文档）`)
      if (action('identical') > 0) parts.push(`${action('identical')} 个内容相同已跳过`)
      if (r.skipped > 0) parts.push(`跳过 ${r.skipped}`)
      if (r.truncated > 0) parts.push(`${r.truncated} 个超大文件已截断`)
    }
    if (r.omittedTrash > 0) parts.push(`${r.omittedTrash} 项回收站记录未合并；请用更多菜单中的「恢复完整工作区」恢复全部数据`)
    if (parts.length > 0) ctx.notify(parts.join('，'))
  } finally { finish() }
}

/** 导出弹层的 W3C 导入入口：单文件按来源分发 */
async function importW3CFile(file: File, fallbackDocId: string | null): Promise<void> {
  const finish = beginFileOperation()
  try {
    if (!ctx.canLeave()) return
    const initialDocs = workspace.current.docs
    const initialActiveId = workspace.current.activeDocId
    const r = await readImport([file], { docs: workspace.current.docs, currentDoc: workspace.current.docs.find((doc) => doc.id === fallbackDocId) })
    if (!r) return
    if (workspace.current.docs !== initialDocs || workspace.current.activeDocId !== initialActiveId || !ctx.canLeave()) {
      ctx.notify('工作区在导入期间发生变化，请重新导入')
      return
    }
    const applied = applyW3C(r.w3cRouted)
    if (r.w3cFiles === 0) {
      ctx.notify('不是可导入的 W3C 批注文件')
      return
    }
    if (applied.merged === 0 && applied.unmatched === 0) {
      ctx.notify('这些批注已导入')
      return
    }
    if (applied.merged > 0) ctx.render()
    ctx.notify(w3cToast(applied.merged, applied.unmatched, applied.routed))
  } finally { finish() }
}

/** 把按来源分组的 W3C 批注折叠进工作区（一次不可变更新），返回汇总 */
function applyW3C(routed: W3CRouted[]): { merged: number; unmatched: number; routed: number } {
  if (routed.length === 0) return { merged: 0, unmatched: 0, routed: 0 }
  let merged = 0
  const unmatched = routed.reduce((count, g) => count + g.unmatched +
    (g.docId !== null && !workspace.current.docs.some((d) => d.id === g.docId) ? g.annotations.length : 0), 0)
  let routedDocs = 0
  const usedIds = new Set([
    ...workspace.current.docs.flatMap((d) => d.annotations.map((a) => a.id)),
    ...workspace.current.trash.flatMap((t) => t.type === 'doc' ? t.doc.annotations.map((a) => a.id) : [t.annotation.id]),
  ])
  workspace.current = {
    ...workspace.current,
    docs: workspace.current.docs.map((d) => {
      const groups = routed.filter(
        (g) => g.docId === d.id,
      )
      if (groups.length === 0) return d
      const ids = new Set(d.annotations.map((a) => a.id))
      const occupiedElsewhere = new Set([...usedIds].filter((id) => !ids.has(id)))
      const anns = groups.flatMap((g) => g.annotations).flatMap((a) => {
        if (ids.has(a.id)) return []
        const id = importedAnnotationId(a.id, d.id, occupiedElsewhere, ids)
        if (ids.has(id)) return []
        ids.add(id)
        usedIds.add(id)
        return [id === a.id ? a : {...a, id}]
      })
      merged += anns.length
      routedDocs +=
        anns.length > 0 && groups.some((g) => g.docId !== null && g.docId !== workspace.current.activeDocId) ? 1 : 0
      return appendAnnotations(d, anns.filter((a) => annotationFits(d, a)))
    }),
  }
  return { merged, unmatched, routed: routedDocs }
}

/** W3C 导入结果提示：分发到多个文档时注明 */
function w3cToast(merged: number, unmatched: number, routed: number): string {
  const base = `导入 ${merged} 条批注`
  const skip = unmatched > 0 ? `，${unmatched} 条无法匹配目标已跳过` : ''
  const dist = routed > 0 ? `（已按来源分发到 ${routed} 份文档）` : ''
  return `${base}${skip}${dist}`
}

return {importFiles, importW3CFile}
}
