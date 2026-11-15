// @vitest-environment happy-dom
import {expect, it, vi} from 'vitest'
import {NativeChannel} from '../../../platform/native/channel'
import {NativeInteractions} from '../../../platform/native/interactions'
import {nativeTrash} from '../../../platform/native/panels'
import {parseShellOutput} from '../../../workbench/shell-protocol'
import type {TrashEntry} from '../../../core/types'

it('an oversized native edit is rejected atomically, keeps its draft and can still cancel or open another session', async () => {
  const post = vi.fn()
  window.nsh = {postMessage: post}
  const channel = new NativeChannel()
  const interactions = new NativeInteractions(channel)
  const handle = vi.fn()
  const editor = {type: 'text' as const, title: 'Source', description: '', inputLabel: 'Text', placeholder: '', value: 'Draft retained', confirmText: 'Save'}
  const id = interactions.open<'text'>(editor, handle)
  // Valid field length, but escaped JSON exceeds the total transport budget.
  expect(() => interactions.update(id, 'text', {value: '\0'.repeat(8 * 1024 * 1024)})).toThrow('传输上限')
  expect(interactions.get(id, 'text')?.value).toBe('Draft retained')
  interactions.close(id)
  expect(() => interactions.open<'text'>({...editor, value: 'x'.repeat(8 * 1024 * 1024 + 1)}, handle)).toThrow('无法打开')
  expect(channel.view.interactions).toEqual([])
  const next = interactions.open<'text'>(editor, handle)
  const command = JSON.stringify({type: 'shell.command', session: channel.session, request: 1, command: {type: 'text', id: next, action: 'cancel'}})
  window.dispatchEvent(new MessageEvent('message', {data: command}))
  await vi.waitFor(() => expect(handle).toHaveBeenCalledOnce())
  window.dispatchEvent(new MessageEvent('message', {data: command}))
  await Promise.resolve()
  expect(handle).toHaveBeenCalledOnce()
  expect(post.mock.calls.map(([message]) => parseShellOutput(message)).some(value => value.type === 'shell.result' && value.error)).toBe(true)
})

it('native trash pages preserve filtered bulk scope and prune selections after a search', async () => {
  window.nsh = {postMessage: () => {}}
  const channel = new NativeChannel()
  const interactions = new NativeInteractions(channel)
  const restore = vi.fn()
  const trash = nativeTrash(interactions, {onClose: () => trash.close(), onRestore: restore, onPurge: vi.fn(), onClearAll: vi.fn()})
  const entries: TrashEntry[] = Array.from({length: 101}, (_, i) => ({type: 'doc', deletedAt: i, doc: {id: `doc-${i}`, name: `Document ${i}`, path: '', text: '', annotations: [], addedAt: 0}}))
  trash.open(entries, 101)
  const id = channel.view.interactions[0]!.id
  const view = () => interactions.get(id, 'trash')!
  let request = 0
  const send = async (action: 'next' | 'all' | 'search' | 'restore', query = '', keys = view().selected) => {
    window.dispatchEvent(new MessageEvent('message', {data: JSON.stringify({type: 'shell.command', session: channel.session, request: ++request, command: {type: 'trash', id, action, query, keys}})}))
    await Promise.resolve(); await Promise.resolve()
  }
  expect(view().rows).toHaveLength(100)
  await send('next'); expect(view().rows).toHaveLength(1)
  await send('all'); expect(view().selected).toHaveLength(101)
  await send('search', 'Document 100')
  expect(view().selected).toEqual(['doc:doc-100'])
  expect(view().page).toBe(0); expect(view().pages).toBe(1)
  await send('restore', 'Document 100', ['doc:doc-100', 'doc:doc-0'])
  expect(restore).toHaveBeenCalledWith(['doc:doc-100'])
  trash.close(); expect(channel.view.interactions).toEqual([])
})
