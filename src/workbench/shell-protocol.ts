import * as v from 'valibot'
import {ALL_KINDS} from '../core/types'
import {THEME_META, TEXTURE_META, FONT_META, FONT_WEIGHT_META, FONT_SIZE} from '../core/prefs'

const text = v.pipe(v.string(), v.maxLength(8 * 1024 * 1024))
const label = v.pipe(v.string(), v.maxLength(4096))
const id = v.pipe(v.string(), v.minLength(1))
const count = v.pipe(v.number(), v.integer(), v.minValue(0))
const ids = v.array(id)
const kind = v.picklist(ALL_KINDS)
const status = v.picklist(['all', 'open', 'resolved'])
const readingMode = v.picklist(['source', 'split', 'preview'])
const format = v.picklist(['inline', 'snippets', 'review', 'w3c'])
const action = v.picklist(['new', 'files', 'folder', 'paste-image', 'sample', 'scan', 'edit', 'diff', 'clear-revised', 'export', 'search', 'trash', 'backup', 'recovery', 'restore', 'remove', 'settings', 'theme', 'raw-backup', 'reset-storage', 'legacy-backup'])
export const compositionSchema = v.strictObject({kind, comment: text, replacement: text})
const finite = v.pipe(v.number(), v.finite())
const regionSchema = v.strictObject({type: v.literal('rectangle'), x: finite, y: finite, width: finite, height: finite})
const color = v.nullable(v.pipe(v.string(), v.regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i)))
export const prefsSchema = v.strictObject({
  theme: v.picklist(Object.keys(THEME_META) as (keyof typeof THEME_META)[]),
  texture: v.picklist(Object.keys(TEXTURE_META) as (keyof typeof TEXTURE_META)[]),
  font: v.picklist(Object.keys(FONT_META) as (keyof typeof FONT_META)[]),
  fontWeight: v.picklist(Object.keys(FONT_WEIGHT_META) as (keyof typeof FONT_WEIGHT_META)[]),
  fontSize: v.pipe(v.number(), v.minValue(FONT_SIZE.min), v.maxValue(FONT_SIZE.max)), customText: color, customBg: color,
})
const documentSchema = v.strictObject({id, name: text, path: text, kind: v.picklist(['text', 'image']), annotationCount: count, openCount: count})
const rowSchema = v.strictObject({key: id, title: label, depth: count, directory: v.boolean(), collapsed: v.boolean(), doc: v.optional(documentSchema)})
const annotationSchema = v.strictObject({id, key: id, rowType: v.picklist(['annotation', 'group']), count, expanded: v.boolean(), selected: v.boolean(), kind, comment: label, excerpt: label, status: v.picklist(['open', 'resolved']), groupId: v.optional(id), anchorLost: v.boolean(), revised: v.boolean(), replacement: label, category: label})
const base = {id, title: label, error: label}
export const interactionSchema = v.variant('type', [
  v.strictObject({...base, type: v.literal('choice'), description: text, confirmText: label, cancelText: label, altText: v.optional(label), danger: v.boolean()}),
  v.strictObject({...base, type: v.literal('text'), description: text, inputLabel: label, placeholder: label, value: text, confirmText: label}),
  v.strictObject({...base, type: v.literal('annotation'), excerpt: text, image: v.boolean(), dismissal: v.picklist(['retain', 'discard']), value: compositionSchema, region: v.optional(regionSchema), bounds: v.optional(v.strictObject({width: count, height: count}))}),
  v.strictObject({...base, type: v.literal('settings'), prefs: prefsSchema}),
  v.strictObject({...base, type: v.literal('search'), query: label, caseSensitive: v.boolean(), regex: v.boolean(), crossDoc: v.boolean(), hits: count, invalid: v.boolean(), value: compositionSchema}),
  v.strictObject({...base, type: v.literal('export'), format, includeResolved: v.boolean(), includeFileInfo: v.boolean(), hasImages: v.boolean(), description: text, preview: text, suffix: label, busy: v.boolean()}),
  v.strictObject({...base, type: v.literal('trash'), query: label, rows: v.array(v.strictObject({key: id, name: label, description: label, remainingDays: count})), selected: ids, total: count, page: count, pages: count}),
  v.strictObject({...base, type: v.literal('import'), rows: v.array(v.strictObject({index: count, name: text, path: text, action: v.picklist(['direct', 'rename', 'overwrite', 'skip', 'identical']), renameTo: text, annotationCount: count, lost: count, moved: count})), canSubmit: v.boolean()}),
])
export type NativeInteraction = v.InferOutput<typeof interactionSchema>
export type InteractionOf<T extends NativeInteraction['type']> = Extract<NativeInteraction, {type: T}>

export const nativeViewSchema = v.strictObject({
  chrome: v.nullable(v.strictObject({ready: v.boolean(), active: v.nullable(documentSchema), mode: v.picklist(['annotate', 'diff', 'edit']), readingMode, hasRevised: v.boolean(), trashCount: count, legacyRecovery: v.boolean(), prefs: prefsSchema})),
  save: v.strictObject({status: v.picklist(['saved', 'dirty', 'error']), message: label, rawRecovery: v.boolean()}),
  documents: v.strictObject({rows: v.array(rowSchema), selected: ids, activeId: v.string(), total: count, page: count, pages: count}),
  reviews: v.strictObject({rows: v.array(annotationSchema), selected: ids, activeId: v.nullable(id), filter: status, kinds: v.array(kind), highlightFiltered: v.boolean(), availableKinds: v.array(kind), total: count, page: count, pages: count, report: v.nullable(v.strictObject({score: finite, units: count, band: label, candidates: count, categories: v.array(v.strictObject({categoryId: label, label, count})), history: v.array(finite), delta: v.nullable(finite)}))}),
  image: v.nullable(v.strictObject({name: label, width: count, height: count, count, usable: v.boolean(), selected: v.boolean(), scale: v.number()})),
  selection: v.nullable(v.strictObject({excerpt: label, x: v.number(), y: v.number()})),
  interactions: v.pipe(v.array(interactionSchema), v.maxLength(8)),
  notice: label,
})
export type NativeView = v.InferOutput<typeof nativeViewSchema>

const editAction = v.picklist(['change', 'submit'])
export const shellCommandSchema = v.variant('type', [
  v.strictObject({type: v.literal('workspace'), action}),
  v.strictObject({type: v.literal('reading'), mode: readingMode}),
  v.strictObject({type: v.literal('document'), action: v.picklist(['open', 'remove', 'export', 'select', 'directory']), id}),
  v.strictObject({type: v.literal('documents'), action: v.picklist(['all', 'invert', 'clear', 'export', 'delete', 'next', 'previous'])}),
  v.strictObject({type: v.literal('review'), action: v.picklist(['focus', 'edit', 'select', 'resolve', 'delete', 'export']), id}),
  v.strictObject({type: v.literal('review-group'), id, action: v.picklist(['expand', 'select', 'resolve', 'delete', 'export'])}),
  v.strictObject({type: v.literal('review-quick'), selection: v.picklist(['lost', 'revised', 'open', 'resolved', ...ALL_KINDS.map(kind => `kind:${kind}` as const)])}),
  v.strictObject({type: v.literal('reviews'), action: v.picklist(['all', 'invert', 'clear', 'export', 'resolve', 'delete', 'next', 'previous'])}),
  v.strictObject({type: v.literal('filter'), status, kinds: v.array(kind), highlightFiltered: v.boolean()}),
  v.strictObject({type: v.literal('selection'), action: v.picklist(['annotate', 'copy', 'dismiss'])}),
  v.strictObject({type: v.literal('choice'), id, choice: v.picklist(['confirm', 'cancel', 'alt'])}),
  v.variant('action', [v.strictObject({type: v.literal('text'), id, action: v.literal('cancel')}), v.strictObject({type: v.literal('text'), id, action: editAction, value: text})]),
  v.variant('action', [v.strictObject({type: v.literal('annotation'), id, action: v.literal('cancel')}), v.strictObject({type: v.literal('annotation'), id, action: v.literal('dismiss')}), v.strictObject({type: v.literal('annotation'), id, action: editAction, value: compositionSchema, region: v.optional(regionSchema)})]),
  v.variant('action', [v.strictObject({type: v.literal('settings'), id, action: v.literal('close')}), v.strictObject({type: v.literal('settings'), id, action: v.picklist(['change']), prefs: prefsSchema})]),
  v.variant('action', [v.strictObject({type: v.literal('search'), id, action: v.literal('close')}), v.strictObject({type: v.literal('search'), id, action: v.picklist(['change', 'submit', 'next', 'previous']), query: label, caseSensitive: v.boolean(), regex: v.boolean(), crossDoc: v.boolean(), value: compositionSchema})]),
  v.variant('action', [v.strictObject({type: v.literal('export'), id, action: v.literal('close')}), v.strictObject({type: v.literal('export'), id, action: v.picklist(['change', 'copy', 'save', 'import']), format, includeResolved: v.boolean(), includeFileInfo: v.boolean()})]),
  v.variant('action', [v.strictObject({type: v.literal('trash'), id, action: v.literal('close')}), v.strictObject({type: v.literal('trash'), id, action: v.picklist(['search', 'select', 'all', 'invert', 'restore', 'purge', 'clear', 'next', 'previous']), query: label, keys: ids})]),
  v.variant('action', [v.strictObject({type: v.literal('import'), id, action: v.literal('cancel')}), v.strictObject({type: v.literal('import'), id, action: v.picklist(['row', 'preset', 'submit']), index: count, decision: v.picklist(['overwrite', 'rename', 'skip']), preset: v.picklist(['overwrite-all', 'overwrite-unannotated', 'overwrite-annotated'])})]),
  v.strictObject({type: v.literal('image'), action: v.picklist(['coordinates', 'edit', 'in', 'out', 'fit', 'original'])}),
])
export type ShellCommand = v.InferOutput<typeof shellCommandSchema>
const envelope = {session: id, request: count}
export const shellInputSchema = v.strictObject({...envelope, type: v.literal('shell.command'), command: shellCommandSchema})
export const shellOutputSchema = v.variant('type', [
  v.strictObject({type: v.literal('shell.view'), session: id, sequence: count, view: nativeViewSchema}),
  v.strictObject({...envelope, type: v.literal('shell.result'), error: v.optional(label)}),
  v.strictObject({type: v.literal('shell.error'), session: id, error: label}),
])
export type ShellOutput = v.InferOutput<typeof shellOutputSchema>
export const MAX_SHELL_MESSAGE = 32 * 1024 * 1024
export function parseShellOutput(message: string): ShellOutput {
  if (message.length > MAX_SHELL_MESSAGE) throw new Error('Shell message is too large')
  return v.parse(shellOutputSchema, JSON.parse(message))
}
