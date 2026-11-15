import {expect, type Page} from '@playwright/test'
import {readFile} from 'node:fs/promises'
import type {NativeView, ShellCommand, ShellOutput} from '../../../src/workbench/shell-protocol'
import type {TransferFile} from '../../../src/platform/protocol'

interface NativeHarness {
  view: NativeView | null
  messages: string[]
  results: Record<number, Extract<ShellOutput, {type: 'shell.result'}>>
  session: string
  request: number
  files: TransferFile[]
  clipboard: TransferFile[]
}
declare global {interface Window {nativeHarness: NativeHarness}}

/** Runs the sealed, canvas-only production artifact; host file I/O is the sole fake boundary. */
export async function openNativeCanvas(page: Page): Promise<void> {
  const html = await readFile('.local-build/native-web/index.html', 'utf8')
  await page.route('https://inkmark.localhost/', route => route.fulfill({contentType: 'text/html', body: html}))
  await page.addInitScript(() => {
    window.nativeHarness = {view: null, messages: [], results: {}, session: '', request: 0, files: [], clipboard: []}
    window.inkmarkHost = {directories: true}
    window.nsh = {postMessage: message => {
      const h = window.nativeHarness
      if (!message.startsWith('{')) { h.messages.push(message); return }
      const value = JSON.parse(message)
      if (value.type === 'shell.view') { h.view = value.view; h.session = value.session; return }
      if (value.type === 'shell.result') { h.results[value.request] = value; return }
      const result = value.operation === 'files.pick' ? h.files : value.operation === 'clipboard.image' ? h.clipboard : 'saved'
      queueMicrotask(() => window.dispatchEvent(new MessageEvent('message', {data: JSON.stringify({id: value.id, status: 'ok', value: result})})))
    }}
  })
  await page.goto('https://inkmark.localhost/')
  await expect.poll(async () => (await nativeView(page))?.chrome?.ready).toBe(true)
}
export const nativeView = (page: Page): Promise<NativeView> => page.evaluate(() => window.nativeHarness.view!)
export async function nativeCommand(page: Page, command: ShellCommand): Promise<void> {
  const request = await page.evaluate(command => {
    const h = window.nativeHarness, request = ++h.request
    window.dispatchEvent(new MessageEvent('message', {data: JSON.stringify({type: 'shell.command', session: h.session, request, command})}))
    return request
  }, command)
  await expect.poll(() => page.evaluate(id => window.nativeHarness.results[id], request)).toBeTruthy()
  const result = await page.evaluate(id => window.nativeHarness.results[id], request)
  expect(result?.error).toBeUndefined()
}
export async function nativeFiles(page: Page, files: TransferFile[], action: 'files' | 'folder' | 'restore' = 'files'): Promise<void> {
  await page.evaluate(files => { window.nativeHarness.files = files }, files)
  await nativeCommand(page, {type: 'workspace', action})
}
export const transfer = (name: string, text: string, relativePath?: string): TransferFile => ({name, type: 'text/plain', base64: Buffer.from(text).toString('base64'), ...(relativePath ? {relativePath} : {})})
