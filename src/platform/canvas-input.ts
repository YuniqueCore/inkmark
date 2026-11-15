interface CanvasImportContext {
  ready: Promise<void>
  hasDocuments(): boolean
  importFiles(files: File[] | FileList): Promise<void>
  createDocument(text: string): void
  notify(message: string): void
}

/** Canvas clipboard/drop input; native and browser form editors retain their own editing semantics. */
export function bindCanvasImport(ctx: CanvasImportContext): void {
// 图片粘贴创建独立文档；输入框保留原生粘贴。空工作台也接受直接粘贴文本。
document.addEventListener('paste', (event) => {
  if (!event.clipboardData) return
  const target = event.target as HTMLElement | null
  if (!target || target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"]')) return
  const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'))
  if (images.length > 0) {
    event.preventDefault()
    void ctx.ready.then(() => ctx.importFiles(images))
    return
  }
  if (ctx.hasDocuments() || !event.clipboardData.types.includes('text/plain')) return
  event.preventDefault()
  const text = event.clipboardData.getData('text/plain')
  void ctx.ready.then(() => {
    if (!ctx.hasDocuments()) ctx.createDocument(text)
    else ctx.notify('工作区已载入；请使用“粘贴新建文档”添加文本')
  })
})

const isEditableTarget = (target: EventTarget | null): boolean => target instanceof Element && Boolean(target.closest('input, textarea, [contenteditable="true"], [role="dialog"], [role="alertdialog"]'))
document.addEventListener('dragover', (event) => {
  if (!isEditableTarget(event.target) && event.dataTransfer?.types.includes('Files')) event.preventDefault()
})
document.addEventListener('drop', (event) => {
  if (isEditableTarget(event.target) || !event.dataTransfer?.files.length) return
  event.preventDefault()
  void ctx.importFiles(event.dataTransfer.files)
})

}
