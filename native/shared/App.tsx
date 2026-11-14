import {Clipboard, Text, View, WebView, effect, lifecycle, signal, openUrl, type WebViewRef} from 'nsh'
import {AlertDialog} from 'nsh/base'
import {currentWindow, Application, Menu, isAvailable} from 'nsh/desktop'
import {parseRequest, encodeBytes, type HostResponse, type SaveReceipt, type TransferFile, type PickOptions} from '../../src/platform/protocol'

export interface FileBindings {
  saveFile: (file: TransferFile) => Promise<SaveReceipt>
  pickFiles: (options: PickOptions) => Promise<TransferFile[]>
  readClipboardImage?: () => Promise<TransferFile[]>
}

export function Workspace(props: {document: {html: string; baseUrl: string}; files: FileBindings}) {
  let web!: WebViewRef
  const error = signal('')
  let transferPending = false
  let closePending: string | undefined
  let closeSequence = 0
  let ready = false
  let closeTimer: ReturnType<typeof setTimeout> | undefined
  effect(() => { if (lifecycle() !== 'active') web?.postMessage('inkmark:flush') })
  // System termination cannot be vetoed; explicit window/menu close awaits the document owner.
  Application.on('quit', () => { web?.postMessage('inkmark:flush') })
  const requestClose = (): void => {
    if (closePending) return
    if (!ready) { Application.quit(); return }
    if (transferPending) { error.set('文件操作尚未完成，请完成或取消系统对话框后再关闭'); return }
    const attempt = String(++closeSequence)
    closePending = attempt
    web.postMessage(`inkmark:prepare-close:${attempt}`)
    closeTimer = setTimeout(() => {
      if (closePending !== attempt) return
      void AlertDialog.show({title: '工作台未回应', description: '强制退出可能丢失尚未保存的改动。也可以返回工作台，稍后重试关闭。',
        actions: [{label: '返回工作台', id: 'cancel', role: 'cancel'}, {label: '强制退出', id: 'quit', role: 'destructive'}]})
        .then(result => {
          if (closePending !== attempt) return
          if (result.action === 'quit') Application.quit()
          else { closePending = undefined; web.postMessage(`inkmark:resume:${attempt}`) }
        })
        .catch(() => { if (closePending === attempt) { closePending = undefined; web.postMessage(`inkmark:resume:${attempt}`) } })
    }, 10000)
  }
  if (isAvailable) {
    const win = currentWindow()
    win.set({closeOnPress: false})
    win.on('closePress', requestClose)
    Menu.setApplicationMenu([
      {label: 'InkMark', submenu: [{label: '退出 InkMark', shortcut: 'mod+q', onSelect: requestClose}]},
      {label: '编辑', submenu: [{role: 'undo'}, {role: 'redo'}, {type: 'separator'}, {role: 'cut'}, {role: 'copy'}, {role: 'paste'}, {role: 'selectAll'}]},
    ])
  }

  const send = (response: HostResponse): void => web.postMessage(JSON.stringify(response))
  const receive = async (message: string): Promise<void> => {
    if (message === 'inkmark:ready') { ready = true; return }
    if (message === 'inkmark:flush-saved' || message === 'inkmark:flush-failed') return
    if (closePending && message === `inkmark:close-ready:${closePending}` && isAvailable) { clearTimeout(closeTimer); Application.quit(); return }
    if (closePending && message === `inkmark:close-cancelled:${closePending}`) { clearTimeout(closeTimer); closePending = undefined; return }
    let request
    try { request = parseRequest(message) }
    catch {
      // The producer validates too, but a malformed envelope with an identifiable ID must settle.
      const id = /^\{"id":"([a-z0-9-]{1,64})"/.exec(message)?.[1]
      if (id) send({id, status: 'error', message: '宿主拒绝了无效或过大的请求'})
      return
    }
    const transfer = request.operation === 'files.save' || request.operation === 'files.pick' || request.operation === 'clipboard.image'
    if (transfer && transferPending) { send({id: request.id, status: 'error', message: '请先完成当前文件操作'}); return }
    if (transfer) transferPending = true
    try {
      let value: Extract<HostResponse, {status: 'ok'}>['value'] = null
      switch (request.operation) {
        case 'links.open': {
          if (!['https:', 'http:', 'mailto:'].includes(new URL(request.url).protocol)) throw new Error('不支持的链接类型')
          await openUrl(request.url)
          break
        }
        case 'files.save': value = await props.files.saveFile(request.file); break
        case 'files.pick': value = await props.files.pickFiles(request.options); break
        case 'clipboard.write': await Clipboard.writeText(request.text); break
        case 'clipboard.image': {
          if (props.files.readClipboardImage) { value = await props.files.readClipboardImage(); break }
          const image = await Clipboard.readImage()
          value = []
          if (image) {
            const blob = await (await fetch(image.url)).blob()
            if (blob.size > 12 * 1024 * 1024) throw new Error('图片超过 12 MB，请缩小后再导入')
            const type = blob.type || 'image/png'
            const extension = type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : type === 'image/bmp' ? 'bmp' : 'png'
            value.push({name: `粘贴图片.${extension}`, type, base64: encodeBytes(new Uint8Array(await blob.arrayBuffer()))})
          }
          break
        }
      }
      send({id: request.id, status: 'ok', value})
    } catch (cause) {
      send({id: request.id, status: 'error', message: (cause instanceof Error ? cause.message : '原生文件操作失败').slice(0, 1000)})
    } finally { if (transfer) transferPending = false }
  }
  return <View style={{flex: 1, backgroundColor: '#faf9f6'}}>
    {() => error() ? <Text style={{padding: 24, color: '#9f1239'}}>{error()}</Text> : null}
    <WebView ref={web} testID="workspace" html={props.document.html} baseUrl={props.document.baseUrl} style={{flex: 1}}
      injectedJavaScriptBeforeContentLoaded={`window.inkmarkHost = {directories: ${isAvailable}};`}
      onMessage={event => void receive(event.data)}
      onError={() => error.set('工作台无法加载。请确认系统 WebView 可用，再重新打开 InkMark。')} />
  </View>
}
