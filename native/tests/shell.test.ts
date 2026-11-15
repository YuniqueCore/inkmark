import {expect, test} from 'nsh/test'
import {createShellClient} from '../shared/shell-client'
import {setComposing} from '../shared/ui/input-state'
import type {NativeView} from '../../src/workbench/shell-protocol'

const view: NativeView = {
  chrome: null, save: {status: 'saved', message: 'saved', rawRecovery: false},
  documents: {rows: [], selected: [], activeId: '', total: 0, page: 0, pages: 1},
  reviews: {rows: [], selected: [], activeId: null, filter: 'all', kinds: [], availableKinds: [], highlightFiltered: false, total: 0, page: 0, pages: 1, report: null},
  image: null, selection: null, interactions: [], notice: '',
}

test('native client ignores retired pages and duplicate projections; IME and failed posts cannot create false pending work', () => {
  const sent: string[] = [], errors: string[] = []
  let fail = false
  const client = createShellClient(message => { if (fail) throw new Error('Disconnected'); sent.push(message) }, message => errors.push(message))
  const projection = (session: string, sequence: number, notice: string) => JSON.stringify({type: 'shell.view', session, sequence, view: {...view, notice}})
  client.receive(projection('first', 1, 'first'))
  client.send({type: 'workspace', action: 'new'})
  expect(client.pending()).toBe(true)
  client.receive(projection('second', 1, 'second'))
  expect(client.pending()).toBe(false)
  client.receive(projection('first', 99, 'stale'))
  client.receive(projection('second', 1, 'duplicate'))
  expect(client.view()?.notice).toBe('second')
  const input = Symbol('marked text')
  setComposing(input, true)
  client.send({type: 'workspace', action: 'export'})
  expect(sent.length).toBe(1)
  setComposing(input, false)
  fail = true; client.send({type: 'workspace', action: 'export'})
  expect(client.pending()).toBe(false)
  expect(errors.length).toBe(2)
  fail = false; client.send({type: 'workspace', action: 'export'})
  const request = JSON.parse(sent[1]!)
  client.receive(JSON.stringify({type: 'shell.result', session: 'first', request: request.request}))
  expect(client.pending()).toBe(true)
  client.receive(JSON.stringify({type: 'shell.result', session: 'second', request: request.request}))
  expect(client.pending()).toBe(false)
})
