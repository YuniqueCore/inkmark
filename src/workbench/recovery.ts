import type {WorkspaceStore, WorkspaceState} from './workspace'
import type {Workspace} from '../core/types'
import {parseWorkspace} from '../core/session'
import {isImageDocument} from '../core/types'
import {holdInput} from '../platform/input-lock'
import {beginFileOperation} from '../platform/files'
import {verifyRaster} from '../platform/image-input'
import {replaceWorkspace, unreadableWorkspaceData} from '../ui/storage'
import type {initSaveStatus} from '../ui/save-status'
import type {Presentation} from './presentation'

interface RecoveryContext {
  workspace: WorkspaceStore
  snapshot: () => Workspace
  save: ReturnType<typeof initSaveStatus>
  canLeave: () => boolean
  confirm: (options: Parameters<Presentation['choice']>[0]) => Promise<boolean>
  notify: (message: string) => void
  exportFile: (file: File, detail?: string) => Promise<unknown>
  onReplace: (initial: WorkspaceState) => void
}

/** Backup and replacement share one save queue and validate before mutating the workspace. */
export function createRecovery({workspace, snapshot, save, canLeave, confirm, notify, exportFile, onReplace}: RecoveryContext) {
function downloadDocumentBackup(): void {
  if (!canLeave()) return
  const data = JSON.stringify({...snapshot(), trash: []}, null, 2)
  downloadJson(data, 'inkmark-documents.json', '文档与批注备份不含未提交草稿')
}

function downloadRecoveryBackup(): void {
  if (!canLeave()) return
  downloadJson(JSON.stringify(snapshot(), null, 2), 'inkmark-workspace.json', '完整工作区含原图和回收站，不含未提交草稿')
}

async function restoreWorkspaceFile(file: File): Promise<void> {
  const finish = beginFileOperation()
  try {
    if (!canLeave()) return
    const initial = workspace.current
    try {
      const restored = parseWorkspace(await file.text())
      if (!restored) { notify('工作区备份格式无效，当前数据保持不变'); return }
      const docs = [...restored.docs, ...restored.trash.flatMap((t) => t.type === 'doc' ? [t.doc] : [])]
      for (const doc of docs) if (isImageDocument(doc)) await verifyRaster(doc.image)
      const ok = await confirm({title: '恢复完整工作区？', description: `将以备份中的 ${restored.docs.length} 份文档和 ${restored.trash.length} 项回收站记录替换当前工作区。请先备份当前内容。恢复会放弃所有未提交的批注草稿；备份不包含草稿。`, confirmText: '恢复工作区', danger: true})
      if (!ok || !canLeave()) return
      if (workspace.current !== initial) { notify('工作区在恢复期间发生变化，请重试'); return }
      if (!await commitWorkspaceReplacement(restored, initial)) return
      notify('完整工作区已恢复')
    } catch (error) { notify(error instanceof Error ? error.message : '备份读取失败') }
  } finally { finish() }
}

/** Explicit replacement shares the save queue and excludes concurrent UI mutations. */
async function commitWorkspaceReplacement(restored: ReturnType<typeof snapshot>, initial: WorkspaceState): Promise<boolean> {
  const release = holdInput(document.body)
  try {
    await save.settle()
    if (workspace.current !== initial) { notify('工作区在恢复期间发生变化，请重试'); return false }
    if (!await replaceWorkspace(restored)) { notify('无法恢复：请先下载当前完整备份，再刷新页面后重试'); return false }
    workspace.current = restored
    save.initialize()
    onReplace(initial)
    return true
  } finally { release() }
}

function downloadJson(data: string, name: string, detail = ''): void {
  void exportFile(new File([data], name, {type: 'application/json;charset=utf-8'}), detail)
}


async function resetStorage(): Promise<void> {
  if (!canLeave() || unreadableWorkspaceData() === null) return
  const ok = await confirm({
    title: '重置无法解析的本地数据？',
    description: '请先下载原始数据。确认后将以当前文档与批注替换本地损坏数据，原数据无法从应用中恢复。',
    confirmText: '重置并保存',
    danger: true,
  })
  if (!ok) return
  if (!await commitWorkspaceReplacement(snapshot(), workspace.current)) return
  notify('已用当前工作区重置本地数据')
 }

return {downloadDocumentBackup, downloadRecoveryBackup, restoreWorkspaceFile, downloadJson, resetStorage}
}
