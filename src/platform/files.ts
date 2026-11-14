import {callHost} from './host'
import {decodeBytes, encodeBytes, MAX_FILE_BYTES, type SaveReceipt} from './protocol'
import {normalizeClipboardRaster} from './image-input'

let activeFiles = 0
export function fileOperationPending(): boolean { return activeFiles > 0 }
export function beginFileOperation(): () => void {
  activeFiles++
  return () => { activeFiles-- }
}

export async function saveFile(file: File): Promise<SaveReceipt> {
  const finish = beginFileOperation()
  try {
  if (__NATIVE_HOST__) {
    if (file.size > MAX_FILE_BYTES) throw new Error('单个导出文件超过 32 MB，请减少所选文档后重试')
    const result = await callHost({operation: 'files.save', file: {
      name: file.name, type: file.type, base64: encodeBytes(new Uint8Array(await file.arrayBuffer())),
    }})
    if (typeof result !== 'string') throw new Error('宿主未确认文件操作结果')
    return result
  }
  const link = document.createElement('a')
  link.href = URL.createObjectURL(file)
  link.download = file.name
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  return 'downloaded'
  } finally { finish() }
}

/** The existing input remains the browser's user gesture and accessible file control. */
export function bindFileInput(input: HTMLInputElement, consume: (files: File[]) => void | Promise<void>, onError: (message: string) => void): () => void {
  const accept = async (files: File[]): Promise<void> => { if (files.length) await consume(files) }
  input.addEventListener('change', () => {
    const files = Array.from(input.files ?? [])
    input.value = ''
    void accept(files).catch(error => onError(error instanceof Error ? error.message : '文件读取失败'))
  })
  return () => {
    if (!__NATIVE_HOST__) { input.click(); return }
    const extensions = input.accept.split(',').filter(value => value.startsWith('.')).map(value => value.slice(1))
    void callHost({operation: 'files.pick', options: {multiple: input.multiple, directory: input.webkitdirectory, extensions}})
      .then(result => {
        if (!Array.isArray(result)) throw new Error('宿主返回了无效的文件列表')
        return accept(result.map(file => {
          const picked = new File([decodeBytes(file.base64)], file.name, {type: file.type})
          if (file.relativePath) Object.defineProperty(picked, 'webkitRelativePath', {value: file.relativePath})
          return picked
        }))
      }).catch(error => onError(error instanceof Error ? error.message : '文件选择失败'))
  }
}

export async function writeClipboardText(text: string): Promise<void> {
  if (__NATIVE_HOST__) await callHost({operation: 'clipboard.write', text})
  else await navigator.clipboard.writeText(text)
}

export async function readClipboardImage(): Promise<File[]> {
  const finish = beginFileOperation()
  try {
    const result = await callHost({operation: 'clipboard.image'})
    if (!Array.isArray(result)) throw new Error('宿主返回了无效的图片')
    const files: File[] = []
    for (const file of result) files.push(await normalizeClipboardRaster(new File([decodeBytes(file.base64)], file.name, {type: file.type})))
    return files
  } finally { finish() }
}
