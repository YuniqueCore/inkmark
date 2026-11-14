/** 不可信会话的边界校验：字段与内部领域类型保持一致。 */
import * as v from 'valibot'
import { validRaster, validRegion } from './image'

const safeId = v.pipe(v.string(), v.regex(/^[A-Za-z0-9_.:-]+$/))
export const isSafeId = (value: unknown): value is string => v.is(safeId, value)
const timestamp = v.pipe(v.number(), v.finite(), v.minValue(-8_640_000_000_000_000), v.maxValue(8_640_000_000_000_000))
const offset = v.pipe(v.number(), v.integer(), v.minValue(0))
const annotationBody = {
  id: safeId,
  kind: v.picklist(['issue', 'suggestion', 'question', 'highlight', 'praise', 'slop']),
  comment: v.string(),
  status: v.picklist(['open', 'resolved']),
  source: v.picklist(['manual', 'slop']),
  groupId: v.optional(safeId),
  createdAt: timestamp,
  updatedAt: timestamp,
}
const annotation = v.pipe(v.object({
  ...annotationBody,
  start: offset,
  end: offset,
  target: v.optional(v.literal('revised')),
  meta: v.optional(v.object({categoryId: v.string(), label: v.string(), matched: v.string(), fix: v.optional(v.string()), note: v.optional(v.string())})),
  anchorLost: v.optional(v.literal(true)),
  replacement: v.optional(v.string()),
}), v.check((a) => a.end >= a.start))
const regionAnnotation = v.object({
  ...annotationBody,
  selector: v.object({type: v.literal('rectangle'), x: offset, y: offset, width: v.pipe(offset, v.minValue(1)), height: v.pipe(offset, v.minValue(1))}),
})
const imageDoc = v.pipe(v.object({
  kind: v.literal('image'), id: safeId, name: v.string(), path: v.string(), addedAt: timestamp,
  image: v.pipe(v.object({dataUrl: v.string(), width: offset, height: offset}), v.check(validRaster)),
  annotations: v.array(regionAnnotation),
}), v.check((doc) => doc.annotations.every((a) => validRegion(a.selector, doc.image))))

const textDoc = v.object({
  kind: v.optional(v.literal('text')),
  id: safeId,
  name: v.string(),
  path: v.string(),
  text: v.string(),
  annotations: v.array(annotation),
  addedAt: timestamp,
  revised: v.optional(v.string()),
  slopHistory: v.optional(v.array(v.object({at: timestamp, score: v.pipe(v.number(), v.finite()), band: v.picklist(['clean', 'light', 'noticeable', 'heavy']), units: v.pipe(v.number(), v.finite())}))),
})
const doc = v.union([imageDoc, textDoc])
const trash = v.variant('type', [
  v.object({type: v.literal('doc'), doc, deletedAt: timestamp}),
  v.object({type: v.literal('annotation'), annotation: v.union([regionAnnotation, annotation]), targetIdentity: v.optional(safeId), textQuote: v.optional(v.object({exact: v.string(), prefix: v.string(), suffix: v.string()})), docId: safeId, docName: v.string(), deletedAt: timestamp}),
])
const activeDocId = v.union([safeId, v.literal('')])
export const sessionSchema = v.variant('version', [
  v.object({version: v.literal(1), text: v.string(), annotations: v.array(annotation), savedAt: timestamp}),
  v.object({version: v.literal(2), docs: v.array(textDoc), activeDocId, savedAt: timestamp}),
  v.object({version: v.literal(3), docs: v.array(doc), activeDocId, trash: v.array(trash), savedAt: timestamp}),
])
