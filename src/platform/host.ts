import * as v from 'valibot'
import {responseSchema, requestSchema, MAX_MESSAGE_CHARS, type HostOperation, type HostResponse} from './protocol'

declare global {
  interface Window { nsh?: {postMessage: (message: string) => void} }
  interface Window { inkmarkHost?: {directories: boolean} }
}

export function supportsDirectories(): boolean { return !__NATIVE_HOST__ || window.inkmarkHost?.directories === true }

type ResponseValue = Extract<HostResponse, {status: 'ok'}>['value']
const pending = new Map<string, {resolve: (value: ResponseValue) => void; reject: (error: Error) => void}>()
let nextId = 0
export function hostRequestPending(): boolean { return pending.size > 0 }

if (__NATIVE_HOST__) {
  document.addEventListener('click', event => {
    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
    if (anchor?.getAttribute('href')?.startsWith('#')) return
    if (!anchor || !['https:', 'http:', 'mailto:'].includes(new URL(anchor.href).protocol)) return
    event.preventDefault()
    void callHost({operation: 'links.open', url: anchor.href}).catch(error => {
      window.dispatchEvent(new CustomEvent('inkmark:host-error', {detail: error.message}))
    })
  })
  window.addEventListener('message', event => {
    if (typeof event.data !== 'string') return
    let envelope: unknown
    try { envelope = JSON.parse(event.data) } catch { return }
    let response: HostResponse
    try { response = v.parse(responseSchema, envelope) }
    catch {
      if (envelope && typeof envelope === 'object' && 'id' in envelope && typeof envelope.id === 'string') {
        pending.get(envelope.id)?.reject(new Error('宿主返回了无效数据，请重试'))
        pending.delete(envelope.id)
      }
      return
    }
    const request = pending.get(response.id)
    if (!request) return
    pending.delete(response.id)
    if (response.status === 'error') request.reject(new Error(response.message))
    else request.resolve(response.value)
  })
  window.addEventListener('pagehide', () => {
    for (const request of pending.values()) request.reject(new Error('页面已关闭，操作未完成'))
    pending.clear()
  })
}

export function callHost(operation: HostOperation): Promise<ResponseValue> {
  return new Promise((resolve, reject) => {
    if (!window.nsh) { reject(new Error('原生宿主连接不可用')); return }
    if (pending.size >= 8) { reject(new Error('请先完成当前文件操作')); return }
    const id = `request-${++nextId}`
    const message = JSON.stringify(v.parse(requestSchema, {id, ...operation}))
    if (message.length > MAX_MESSAGE_CHARS) { reject(new Error('传输内容超过 32 MB')); return }
    pending.set(id, {resolve, reject})
    try { window.nsh.postMessage(message) }
    catch (error) { pending.delete(id); reject(error) }
  })
}

/** Close is a request to the document owner, never permission to discard pending edits. */
export function bindHostLifecycle(prepare: () => Promise<boolean>, flush: () => Promise<boolean>): void {
  if (!__NATIVE_HOST__) return
  let closing: string | undefined
  window.addEventListener('message', event => {
    if (typeof event.data !== 'string') return
    if (event.data.startsWith('inkmark:resume:')) {
      if (closing === event.data.slice('inkmark:resume:'.length)) { closing = undefined; document.body.inert = false }
      return
    }
    if (event.data === 'inkmark:flush') {
      void flush().then(saved => window.nsh?.postMessage(saved ? 'inkmark:flush-saved' : 'inkmark:flush-failed'))
        .catch(() => window.nsh?.postMessage('inkmark:flush-failed'))
      return
    }
    const attempt = /^inkmark:prepare-close:([0-9]+)$/.exec(event.data)?.[1]
    if (!attempt || closing) return
    closing = attempt
    document.body.inert = true
    void prepare().then(ready => {
      if (closing !== attempt) return
      window.nsh?.postMessage(`inkmark:close-${ready ? 'ready' : 'cancelled'}:${attempt}`)
      if (!ready) { closing = undefined; document.body.inert = false }
    }).catch(() => {
      if (closing !== attempt) return
      closing = undefined
      document.body.inert = false
      window.nsh?.postMessage(`inkmark:close-cancelled:${attempt}`)
    })
  })
}
