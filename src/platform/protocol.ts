import * as v from 'valibot'

/** Only user-mediated transfers cross the host boundary. Paths and executable code never do. */
export const MAX_FILE_BYTES = 32 * 1024 * 1024
export const MAX_MESSAGE_CHARS = Math.ceil(MAX_FILE_BYTES / 3) * 4 + 4096
const id = v.pipe(v.string(), v.regex(/^[a-z0-9-]{1,64}$/))
const filename = v.pipe(v.string(), v.minLength(1), v.maxLength(255), v.check(value => value !== '.' && value !== '..'), v.regex(/^[^/\\\u0000-\u001f\u007f]+$/))
// QuickJS retains a backtracking entry per character for a greedy base64 regexp.
// Scan for invalid characters and validate padding separately: bounded auxiliary memory.
function validBase64(value: string): boolean {
  if (value.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(value)) return false
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return value.indexOf('=') === (padding ? value.length - padding : -1)
}
const file = v.strictObject({
  name: filename,
  type: v.pipe(v.string(), v.maxLength(128)),
  base64: v.pipe(v.string(), v.maxLength(MAX_MESSAGE_CHARS - 4096), v.check(validBase64)),
  relativePath: v.optional(v.pipe(v.string(), v.maxLength(2048))),
})
export type TransferFile = v.InferOutput<typeof file>
export const filesSchema = v.pipe(v.array(file), v.maxLength(100))
export const receiptSchema = v.picklist(['saved', 'shared', 'downloaded', 'cancelled'])
export type SaveReceipt = v.InferOutput<typeof receiptSchema>
const options = v.strictObject({
  multiple: v.boolean(),
  directory: v.boolean(),
  extensions: v.array(v.pipe(v.string(), v.regex(/^[a-z0-9]{1,16}$/))),
})
export type PickOptions = v.InferOutput<typeof options>
export const requestSchema = v.variant('operation', [
  v.strictObject({id, operation: v.literal('files.pick'), options}),
  v.strictObject({id, operation: v.literal('files.save'), file}),
  v.strictObject({id, operation: v.literal('clipboard.write'), text: v.pipe(v.string(), v.maxLength(MAX_FILE_BYTES))}),
  v.strictObject({id, operation: v.literal('clipboard.image')}),
  v.strictObject({id, operation: v.literal('links.open'), url: v.pipe(v.string(), v.maxLength(2048), v.url())}),
])
export type HostRequest = v.InferOutput<typeof requestSchema>
export type HostOperation = HostRequest extends infer R ? R extends HostRequest ? Omit<R, 'id'> : never : never
export const responseSchema = v.variant('status', [
  v.strictObject({id, status: v.literal('ok'), value: v.union([v.null(), receiptSchema, filesSchema])}),
  v.strictObject({id, status: v.literal('error'), message: v.pipe(v.string(), v.maxLength(1000))}),
])
export type HostResponse = v.InferOutput<typeof responseSchema>

export function parseRequest(message: string): HostRequest {
  if (message.length > MAX_MESSAGE_CHARS) throw new Error('文件超过原生传输上限（32 MB）')
  return v.parse(requestSchema, JSON.parse(message))
}

export function encodeBytes(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768))
  return btoa(binary)
}

export function decodeBytes(base64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0))
}
