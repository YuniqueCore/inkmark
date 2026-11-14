// @vitest-environment happy-dom
import {expect, test} from 'vitest'
import {parseRequest, encodeBytes, decodeBytes, MAX_FILE_BYTES} from '../../platform/protocol'

test('bounded transfer accepts binary boundaries and rejects executable envelopes, paths and corrupt encoding', () => {
  const bytes = new Uint8Array(MAX_FILE_BYTES); bytes[0] = 255; bytes[bytes.length - 1] = 42
  const file = {name: '审阅.json', type: 'application/json', base64: encodeBytes(bytes)}
  const request = {id: 'request-1', operation: 'files.save', file}
  expect(parseRequest(JSON.stringify(request)).operation).toBe('files.save')
  const decoded = decodeBytes(file.base64)
  expect(Buffer.from(decoded).equals(Buffer.from(bytes))).toBe(true)
  for (const name of ['../secret', 'a\\b', 'a\n/../b', 'x'.repeat(256)]) {
    expect(() => parseRequest(JSON.stringify({...request, file: {...file, name, base64: ''}}))).toThrow()
  }
  expect(() => parseRequest(JSON.stringify({...request, file: {...file, base64: 'a==='}}))).toThrow()
  expect(() => parseRequest(JSON.stringify({...request, eval: 'alert(1)'}))).toThrow()
  expect(() => parseRequest(JSON.stringify({id: '1', operation: 'execute', code: 'x'}))).toThrow()
}, 15000)

test('native request ownership: malformed reply, send failure, concurrency, close cancellation and late completions', async () => {
  const sent: string[] = []
  window.nsh = {postMessage: message => { sent.push(message) }}
  const {callHost, bindHostLifecycle, hostRequestPending} = await import('../../platform/host')
  const respond = (data: unknown) => window.dispatchEvent(new MessageEvent('message', {data: typeof data === 'string' ? data : JSON.stringify(data)}))
  const first = callHost({operation: 'clipboard.write', text: 'review'})
  const firstId = JSON.parse(sent.pop()!).id
  respond({id: firstId, status: 'ok', value: {unexpected: true}})
  await expect(first).rejects.toThrow('无效数据')
  expect(hostRequestPending()).toBe(false)
  window.nsh.postMessage = () => { throw new Error('host gone') }
  await expect(callHost({operation: 'clipboard.image'})).rejects.toThrow('host gone')
  expect(hostRequestPending()).toBe(false)
  window.nsh.postMessage = message => { sent.push(message) }
  const inFlight = Array.from({length: 8}, () => callHost({operation: 'clipboard.image'}))
  await expect(callHost({operation: 'clipboard.image'})).rejects.toThrow('请先完成')
  for (const message of sent.splice(0)) respond({id: JSON.parse(message).id, status: 'ok', value: []})
  await Promise.all(inFlight)
  const resolutions: ((value: boolean) => void)[] = []
  bindHostLifecycle(() => new Promise(resolve => resolutions.push(resolve)), async () => false)
  respond('inkmark:prepare-close:1'); expect(document.body.inert).toBe(true)
  respond('inkmark:resume:1'); expect(document.body.inert).toBe(false)
  respond('inkmark:prepare-close:2'); expect(document.body.inert).toBe(true)
  resolutions[0]!(false); await Promise.resolve()
  expect(document.body.inert).toBe(true)
  expect(sent).not.toContain('inkmark:close-cancelled:1')
  resolutions[1]!(true); await Promise.resolve()
  expect(sent).toContain('inkmark:close-ready:2')
  respond('inkmark:resume:2'); expect(document.body.inert).toBe(false)
  document.body.innerHTML = '<a href="#heading">local</a><a href="https://example.org/review">external</a>'
  document.querySelectorAll('a')[0]!.click()
  expect(hostRequestPending()).toBe(false)
  document.querySelectorAll('a')[1]!.click()
  const external = JSON.parse(sent.pop()!)
  expect(external).toMatchObject({operation: 'links.open', url: 'https://example.org/review'})
  respond({id: external.id, status: 'ok', value: null})
})
