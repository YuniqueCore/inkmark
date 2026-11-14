import {saveFile, writeClipboardText} from '../platform/files'
import {toast} from './toast'

let exporting = false
export async function exportFile(file: File, detail = ''): Promise<void> {
  if (exporting) { toast('请先完成当前导出操作'); return }
  exporting = true
  try {
    const receipt = await saveFile(file)
    if (receipt === 'cancelled') return
    const message = {saved: '文件已保存', shared: '已交给系统分享，请选择保存位置或接收应用', downloaded: '已开始下载'}[receipt]
    toast(detail ? `${message}；${detail}` : message)
  } catch (error) { toast(error instanceof Error ? error.message : '导出失败，请重试') }
  finally { exporting = false }
}

export async function copyText(text: string, message: string): Promise<void> {
  try { await writeClipboardText(text); toast(message) }
  catch { toast('无法写入剪贴板，请检查系统权限后重试') }
}
