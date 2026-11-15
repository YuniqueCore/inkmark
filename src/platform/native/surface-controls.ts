import type {SourceEditing, SourceEditCallbacks, ImageControls, ImageControlState, ImageAction, RegionDraft, RegionDraftActions} from '../../workbench/surface-controls'
import type {NativeInteractions} from './interactions'
import type {NativeChannel} from './channel'
import type {ImageRegion} from '../../core/types'
import {canSubmitComposition} from '../../workbench/composition'

export class NativeSourceEditor implements SourceEditing {
  private id: string | null = null
  constructor(private interactions: NativeInteractions) {}
  open(text: string, callbacks: SourceEditCallbacks): void {
    if (this.id) return
    this.id = this.interactions.open<'text'>({type: 'text', title: '编辑原文', description: '保存后按引文重新锚定批注；取消保留原文。', inputLabel: '原文内容', placeholder: '', value: text, confirmText: '完成并重锚批注'}, async (command, id) => {
      if (command.action === 'cancel') { callbacks.onCancel(); return }
      this.interactions.update(id, 'text', {value: command.value, error: ''})
      if (command.action === 'submit') await callbacks.onSave(command.value)
    })
  }
  value(): string | null { return this.id ? this.interactions.get(this.id, 'text')?.value ?? null : null }
  close(): void { if (this.id) this.interactions.close(this.id); this.id = null }
}

export class NativeImageControls implements ImageControls {
  private id: string | null = null
  private act: ((action: ImageAction) => void) | null = null
  constructor(private channel: NativeChannel, private interactions: NativeInteractions) {
    channel.on('image', command => {
      if (!this.act || !channel.view.image) throw new Error('请先打开图片')
      this.act(command.action)
    })
  }
  mount(_root: HTMLElement, act: (action: ImageAction) => void): void { this.act = act }
  render(state: ImageControlState): void { this.channel.view.image = {...state, name: state.name.slice(0, 4000)}; this.channel.publish() }
  compose(draft: RegionDraft, actions: RegionDraftActions): void {
    if (this.id) throw new Error('请先完成当前区域批注')
    this.id = this.interactions.open<'annotation'>({type: 'annotation', title: draft.editing ? '编辑区域批注' : '新建区域批注', excerpt: '坐标以原图像素为单位。', image: true, dismissal: 'discard', value: draft.value, region: draft.region, bounds: draft.bounds}, (command, id) => {
      if (command.action === 'cancel' || command.action === 'dismiss') { actions.cancel(); return }
      if (!command.region) throw new Error('请输入完整的区域坐标')
      this.interactions.update(id, 'annotation', {value: command.value, region: command.region, error: ''})
      if (command.action === 'change') { actions.change(command.value, command.region); return }
      if (!canSubmitComposition(command.value)) { this.interactions.update(id, 'annotation', {error: '请填写批注内容；认可可不写描述'}); return }
      if (!actions.save(command.value, command.region)) this.interactions.update(id, 'annotation', {error: '未保存。请检查图片范围内的整数坐标及批注是否已变化；输入已保留。'})
    })
  }
  region(region: ImageRegion): void { if (this.id) this.interactions.update(this.id, 'annotation', {region}) }
  closeComposer(): void { if (this.id) this.interactions.close(this.id); this.id = null }
  dispose(): void { this.closeComposer(); this.act = null; this.channel.view.image = null; this.channel.publish() }
}
