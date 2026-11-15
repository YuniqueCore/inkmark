import {SelectionDrafts, canSubmitComposition} from '../../workbench/composition'
import type {SelectionPresentation, AnnotationEditor} from '../../workbench/presentation'
import type {PinCallbacks, SelectionInfo} from '../../ui/selection-pin'
import type {PopupCallbacks} from '../../ui/annotation-popup'
import type {Annotation} from '../../core/types'
import type {NativeChannel} from './channel'
import type {NativeInteractions} from './interactions'

export function nativeSelection(channel: NativeChannel, interactions: NativeInteractions, callbacks: PinCallbacks): SelectionPresentation {
  const drafts = new SelectionDrafts()
  let selection: SelectionInfo | null = null
  let editor: {id: string; owner: SelectionInfo} | null = null
  const dismiss = (): void => {
    selection = null
    channel.view.selection = null
    window.getSelection()?.removeAllRanges()
    callbacks.onDismiss()
    channel.publish()
  }
  window.addEventListener('resize', dismiss)
  document.getElementById('editor-wrap')?.addEventListener('scroll', () => { if (!editor) dismiss() }, true)
  channel.on('selection', command => {
    if (command.action === 'dismiss') { dismiss(); return }
    if (!selection) throw new Error('请重新选择要批注的文字')
    if (command.action === 'copy') { callbacks.onCopySelection(selection.quoted); return }
    if (editor) return
    const owner = selection
    const value = drafts.read(owner) ?? {kind: 'suggestion', comment: '', replacement: ''}
    const id = interactions.open<'annotation'>({type: 'annotation', title: '添加批注', excerpt: owner.quoted, image: false, dismissal: 'retain', value}, (command, id) => {
      if (command.action === 'cancel' || command.action === 'dismiss') { if (command.action === 'cancel') drafts.remove(owner); interactions.close(id); editor = null; dismiss(); return }
      drafts.write(owner, command.value)
      interactions.update(id, 'annotation', {value: command.value, error: ''})
      if (command.action === 'change') return
      if (!canSubmitComposition(command.value)) { interactions.update(id, 'annotation', {error: '请填写批注内容；认可可不写描述'}); return }
      if (!callbacks.onCreate(owner, command.value.kind, command.value.comment.trim(), command.value.replacement.trim() || undefined)) {
        interactions.update(id, 'annotation', {error: '原文已变化，请保留内容并重新选择后提交'})
        return
      }
      drafts.remove(owner)
      interactions.close(id)
      editor = null
      dismiss()
    })
    editor = {id, owner}
  })
  return {
    showFor(info): void {
      if (!info.quoted.trim() || info.start === info.end) { dismiss(); return }
      selection = info
      channel.view.selection = {excerpt: info.quoted.slice(0, 4000), x: Math.max(8, Math.min(info.mouse.x + 8, window.innerWidth - 200)), y: Math.max(8, Math.min(info.mouse.y + 10, window.innerHeight - 52))}
      channel.publish()
    },
    dismiss,
    hasDrafts(docIds, side): boolean {
      return Boolean(editor && (!docIds || docIds.has(editor.owner.docId)) && (!side || (editor.owner.side ?? 'a') === side)) || drafts.has(docIds, side)
    },
    discardDrafts(docIds, side): void {
      drafts.discard(docIds, side)
      if (editor && docIds.has(editor.owner.docId) && (!side || (editor.owner.side ?? 'a') === side)) {
        interactions.close(editor.id); editor = null
      }
      if (selection && docIds.has(selection.docId) && (!side || (selection.side ?? 'a') === side)) dismiss()
    },
  }
}

export function nativeAnnotationEditor(interactions: NativeInteractions, callbacks: PopupCallbacks): AnnotationEditor {
  let editing: {id: string; owner: Annotation; source: string} | null = null
  let current: Annotation[] = []
  let text = ''
  let revised: string | undefined
  const close = (): void => { if (editing) interactions.close(editing.id); editing = null }
  return {
    setAnchorRect(): void {}, // Native inspector placement does not depend on DOM geometry.
    openFor(id, source, annotations): void {
      if (editing) return
      const owner = annotations.find(ann => ann.id === id)
      if (!owner) return
      current = annotations
      text = owner.target === 'revised' ? text : source
      revised = owner.target === 'revised' ? source : revised
      const interactionId = interactions.open<'annotation'>({type: 'annotation', title: '编辑批注', excerpt: source.slice(owner.start, owner.end), image: false, dismissal: 'discard',
        value: {kind: owner.kind, comment: owner.comment, replacement: owner.replacement ?? ''}}, (command, sessionId) => {
        if (command.action === 'cancel' || command.action === 'dismiss') { close(); return }
        interactions.update(sessionId, 'annotation', {value: command.value, error: ''})
        if (command.action === 'change') return
        if (!canSubmitComposition(command.value)) { interactions.update(sessionId, 'annotation', {error: '请填写批注内容；认可可不写描述'}); return }
        if (current.find(ann => ann.id === owner.id) !== owner || (owner.target === 'revised' ? revised : text) !== source) {
          interactions.update(sessionId, 'annotation', {error: '原批注或原文已变化，输入已保留，请取消后重新编辑'})
          return
        }
        callbacks.onUpdate(owner.id, command.value.kind, command.value.comment, command.value.replacement || undefined)
        close()
      })
      editing = {id: interactionId, owner, source}
    },
    sync(source, annotations, revision): void { current = annotations; text = source; revised = revision },
    close,
    hasDraft(): boolean { return editing !== null },
  }
}
