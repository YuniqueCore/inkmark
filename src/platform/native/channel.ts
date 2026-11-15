import * as v from 'valibot'
import {MAX_SHELL_MESSAGE, shellInputSchema, type NativeView, type ShellCommand, type ShellOutput} from '../../workbench/shell-protocol'

/** One page session owns state. The host is a renderer with no persistence or domain mutations. */
export class NativeChannel {
  readonly session = crypto.randomUUID()
  readonly view: NativeView = {
    chrome: null, save: {status: 'saved', message: '正在载入', rawRecovery: false},
    documents: {rows: [], selected: [], activeId: '', total: 0, page: 0, pages: 1},
    reviews: {rows: [], selected: [], activeId: null, filter: 'all', kinds: [], highlightFiltered: false, availableKinds: [], total: 0, page: 0, pages: 1, report: null},
    image: null, selection: null, interactions: [], notice: '',
  }
  private sequence = 0
  private request = -1
  private scheduled = false
  private handlers = new Map<ShellCommand['type'], (command: ShellCommand) => void | Promise<void>>()

  constructor() {
    window.addEventListener('message', event => {
      if (typeof event.data !== 'string' || event.data.length > MAX_SHELL_MESSAGE) return
      let data: unknown
      try { data = JSON.parse(event.data) } catch { return }
      const parsed = v.safeParse(shellInputSchema, data)
      if (!parsed.success || parsed.output.session !== this.session) return
      const {request, command} = parsed.output
      if (request <= this.request) { this.send({type: 'shell.result', session: this.session, request, error: '操作已处理，请刷新当前界面后重试'}); return }
      this.request = request
      void this.dispatch(command).then(() => this.send({type: 'shell.result', session: this.session, request}))
        .catch(error => {
          const message = error instanceof Error ? error.message.slice(0, 4096) : '操作失败，请重试'
          this.view.notice = message
          this.publish()
          this.send({type: 'shell.result', session: this.session, request, error: message})
        })
    })
  }

  on<T extends ShellCommand['type']>(type: T, handler: (command: Extract<ShellCommand, {type: T}>) => void | Promise<void>): void {
    if (this.handlers.has(type)) throw new Error(`Duplicate shell command owner: ${type}`)
    // The discriminant is validated before dispatch and is also the map key.
    this.handlers.set(type, command => handler(command as Extract<ShellCommand, {type: T}>))
  }
  private async dispatch(command: ShellCommand): Promise<void> {
    if (document.body.inert) throw new Error('工作区正在保存或恢复，请稍候')
    const handler = this.handlers.get(command.type)
    if (!handler) throw new Error('当前操作不可用')
    this.view.notice = ''
    await handler(command)
    this.publish()
  }
  private send(message: ShellOutput): void {
    const encoded = JSON.stringify(message)
    if (encoded.length > MAX_SHELL_MESSAGE) throw new Error('界面内容超过传输上限，请减少导出范围')
    window.nsh?.postMessage(encoded)
  }
  assertPublishable(view: NativeView): void {
    if (JSON.stringify({type: 'shell.view', session: this.session, sequence: this.sequence + 1, view}).length > MAX_SHELL_MESSAGE) {
      throw new Error('界面内容超过传输上限，请关闭其他编辑窗口后重试')
    }
  }
  publish(): void {
    if (this.scheduled) return
    this.scheduled = true
    queueMicrotask(() => {
      this.scheduled = false
      try { this.send({type: 'shell.view', session: this.session, sequence: ++this.sequence, view: this.view}) }
      catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 4096) : '无法更新原生界面，当前数据仍保留'
        try { this.send({type: 'shell.error', session: this.session, error: message}) }
        catch { console.error('无法向原生界面传送状态', error) }
      }
    })
  }
}
