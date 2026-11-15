import * as v from 'valibot'
import {interactionSchema} from '../../workbench/shell-protocol'
import type {NativeInteraction, InteractionOf, ShellCommand} from '../../workbench/shell-protocol'
import type {NativeChannel} from './channel'

type InteractionCommand = Extract<ShellCommand, {id: string; type: NativeInteraction['type']}>

/** Sessions are registered before native focus. Confirmation can overlay a still-owned draft. */
export class NativeInteractions {
  private nextId = 0
  private handlers = new Map<string, (command: InteractionCommand) => void | Promise<void>>()
  constructor(private channel: NativeChannel) {
    for (const type of ['choice', 'text', 'annotation', 'settings', 'search', 'export', 'trash', 'import'] as const) {
      channel.on(type, command => {
        const interaction = channel.view.interactions.find(item => item.id === command.id)
        if (!interaction || interaction.type !== command.type) throw new Error('此编辑会话已结束，输入未提交')
        return this.handlers.get(command.id)!(command)
      })
    }
  }
  open<T extends NativeInteraction['type']>(view: Omit<InteractionOf<T>, 'id' | 'error'>, handle: (command: Extract<InteractionCommand, {type: T}>, id: string) => void | Promise<void>): string {
    if (this.channel.view.interactions.length >= 8) throw new Error('请先完成当前对话框')
    const id = `interaction-${++this.nextId}`
    const result = v.safeParse(interactionSchema, {...view, id, error: ''})
    if (!result.success) throw new Error('无法打开编辑窗口：内容超过限制或格式无效。单个文本字段最多 8 MiB 字符。')
    const parsed = result.output
    this.channel.assertPublishable({...this.channel.view, interactions: [...this.channel.view.interactions, parsed]})
    this.handlers.set(id, command => handle(command as Extract<InteractionCommand, {type: T}>, id))
    this.channel.view.interactions.push(parsed)
    this.channel.publish()
    return id
  }
  get<T extends NativeInteraction['type']>(id: string, type: T): InteractionOf<T> | undefined {
    return this.channel.view.interactions.find(item => item.id === id && item.type === type) as InteractionOf<T> | undefined
  }
  update<T extends NativeInteraction['type']>(id: string, type: T, patch: Partial<Omit<InteractionOf<T>, 'type' | 'id'>>): void {
    const item = this.get(id, type)
    if (!item) return
    const updated = v.parse(interactionSchema, {...item, ...patch})
    this.channel.assertPublishable({...this.channel.view, interactions: this.channel.view.interactions.map(current => current === item ? updated : current)})
    Object.assign(item, updated)
    this.channel.publish()
  }
  close(id: string): void {
    this.handlers.delete(id)
    this.channel.view.interactions = this.channel.view.interactions.filter(item => item.id !== id)
    this.channel.publish()
  }
}
