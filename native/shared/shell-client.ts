import {signal} from 'nsh'
import {isComposing} from './ui/input-state'
import * as v from 'valibot'
import {MAX_SHELL_MESSAGE, parseShellOutput, shellCommandSchema, type NativeView, type ShellCommand} from '../../src/workbench/shell-protocol'

export function createShellClient(post: (message: string) => void, onError: (message: string) => void) {
  const view = signal<NativeView | null>(null)
  let session: string | null = null
  const retired = new Set<string>()
  const pending = new Set<number>()
  let sequence = 0
  let request = 0
  return {
    view,
    pending: () => pending.size > 0,
    send(command: ShellCommand): void {
      if (!session) { onError('工作区尚未载入'); return }
      if (isComposing() && !('action' in command && command.action === 'change')) { onError('请先完成输入法候选，再执行操作'); return }
      try {
        const parsed = v.parse(shellCommandSchema, command)
        const next = ++request
        const encoded = JSON.stringify({type: 'shell.command', session, request: next, command: parsed})
        if (encoded.length > MAX_SHELL_MESSAGE) throw new Error('输入超过传输上限，请缩小内容范围；草稿仍保留')
        pending.add(next)
        try { post(encoded) }
        catch (error) { pending.delete(next); throw error }
      } catch (error) { onError(error instanceof Error ? error.message : '操作参数无效') }
    },
    receive(message: string): boolean {
      if (!message.startsWith('{"type":"shell.')) return false
      try {
        const envelope = parseShellOutput(message)
        if (envelope.type === 'shell.view') {
          if (retired.has(envelope.session)) return true
          if (session !== envelope.session) { if (session) retired.add(session); session = envelope.session; sequence = 0; request = 0; pending.clear() }
          if (envelope.sequence <= sequence) return true
          sequence = envelope.sequence
          view.set(envelope.view)
        } else if (envelope.session === session) {
          if (envelope.type === 'shell.result') pending.delete(envelope.request)
          if (envelope.error) onError(envelope.error)
        }
      } catch (error) { onError(error instanceof Error ? error.message : '原生界面收到无效数据') }
      return true
    },
  }
}
