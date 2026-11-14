import { describe, expect, it } from 'vitest'
import { annotationFits, normalizeRegion, validRaster, validRegion } from '../src/core/image'
import { fromImageW3C, fromW3C, toW3C } from '../src/core/w3c'
import { parseWorkspace } from '../src/core/session'
import { entryKey, restoreFromTrash, trashFromDoc } from '../src/core/trash'
import { prepareSessionDocs } from '../src/core/import'
import { presentAnnotations } from '../src/ui/annotation-presentation'
import type { Annotation, DocItem, ImageDocument, RegionAnnotation } from '../src/core/types'

const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII='
const region: RegionAnnotation = {id: 'a', selector: {type: 'rectangle', x: 0, y: 0, width: 1, height: 1}, kind: 'suggestion', comment: 'Increase contrast', status: 'open', source: 'manual', createdAt: 1, updatedAt: 2}
const image: ImageDocument = {kind: 'image', id: 'image-one', name: 'screen.png', path: '', image: {dataUrl, width: 1, height: 1}, annotations: [region], addedAt: 1}
const textAnn: Annotation = {id: 'text-ann', start: 6, end: 10, kind: 'question', comment: 'Why?', status: 'open', source: 'manual', createdAt: 1, updatedAt: 2}
const text: DocItem = {id: 'text-one', name: 'note.md', path: '', text: 'alpha beta', annotations: [textAnn], addedAt: 1}
const session = (docs: unknown[], trash: unknown[] = []) => JSON.stringify({version: 3, docs, activeDocId: (docs[0] as {id: string} | undefined)?.id ?? '', trash, savedAt: 2})

describe('image review primitives and portable boundaries', () => {
  it('keeps pixels, annotation bodies and selectors separate across storage, presentation and W3C', () => {
    expect(parseWorkspace(session([text, image]))?.docs).toEqual([text, image])
    expect(presentAnnotations(image)[0]).toMatchObject({excerpt: '区域 (0, 0) · 1 × 1 px', order: 0, comment: 'Increase contrast'})
    const emptyPraise = {...region, kind: 'praise' as const, comment: '', createdAt: 0, updatedAt: 0}
    expect(fromImageW3C(toW3C({...image, annotations: [emptyPraise]}), image).annotations).toEqual([emptyPraise])
    const exported = toW3C(image)
    expect(exported).toMatchSnapshot()
    expect(fromImageW3C(exported, image)).toEqual({annotations: [region], unmatched: 0})
    expect(fromImageW3C(exported, {...image, id: 'other'})).toEqual({annotations: [], unmatched: 1})
    expect(fromImageW3C(exported, {...image, image: {...image.image, width: 2}}).unmatched).toBe(1)
    expect(annotationFits(text, region)).toBe(false)
    expect(annotationFits(image, textAnn)).toBe(false)
  })

  it('validates untrusted selectors instead of silently clamping them; only pointer geometry is normalized', () => {
    const raster = {...image.image, width: 200, height: 100}
    expect(normalizeRegion(90.2, 80.1, -50.7, -120, raster)).toEqual({type: 'rectangle', x: 39, y: 0, width: 52, height: 81})
    for (const patch of [{x: -1}, {y: Infinity}, {width: 0}, {height: NaN}, {width: 2}, {x: 0.1}]) {
      const selector = {...region.selector, ...patch}
      expect(validRegion(selector, image.image)).toBe(false)
      expect(parseWorkspace(session([{...image, annotations: [{...region, selector}]}]))).toBeNull()
    }
    expect(normalizeRegion(0, 0, 0, 1, raster)).toBeNull()
    expect(normalizeRegion(300, 0, 2, 2, raster)).toBeNull()
    expect(validRaster({...image.image, dataUrl: 'data:image/svg+xml;base64,PHN2Zz4='})).toBe(false)
    expect(validRaster({...image.image, dataUrl: dataUrl.replace('image/png', 'image/jpeg')})).toBe(false)
    expect(validRaster({...image.image, width: 20000})).toBe(false)
    expect(parseWorkspace(session([{...image, annotations: [textAnn]}]))).toBeNull()
    expect(parseWorkspace(session([{...text, annotations: [region]}]))).toBeNull()
  })

  it('rejects malformed or wrong-image W3C while preserving valid items and stable replay identity', () => {
    const original = toW3C(image)[0]!
    const bad = (value: string) => ({...original, target: {...original.target, selector: [{type: 'FragmentSelector', conformsTo: 'http://www.w3.org/TR/media-frags/', value}]}})
    const results = fromImageW3C([original, bad('xywh=pixel:0,0,0,1'), bad('xywh=pixel:0,0,2,1'), bad('xywh=pixel:NaN,0,1,1'), bad('xywh=percent:0,0,1,1')], image)
    expect(results).toEqual({annotations: [region], unmatched: 4})
    expect(fromW3C([{target: {source: 'urn:inkmark:doc:missing#image=image-bad', selector: [{type: 'TextQuoteSelector', exact: 'alpha'}]}}], text.text).unmatched).toBe(1)
    const external = {...original, id: '<unsafe-external-id>'}
    expect(fromImageW3C(external, image).annotations[0]?.id).toBe(fromImageW3C(external, image).annotations[0]?.id)
    expect(toW3C({...image, annotations: [{...region, status: 'resolved'}]})).toEqual([])
    expect(toW3C({...image, annotations: [{...region, status: 'resolved'}]}, {includeResolved: true})).toHaveLength(1)
  })
})

describe('trash target identity and workspace integrity', () => {
  it('restores exact image targets; changed pixels, text and missing revised sides stay recoverable in trash', () => {
    const removed = trashFromDoc(image, new Set(['a']), 3)
    const key = new Set(removed.trashed.map(entryKey))
    const restored = restoreFromTrash(removed.trashed, [removed.doc], key)
    expect(restored.docs[0]).toEqual(image)
    expect(parseWorkspace(session(restored.docs, restored.trash))).not.toBeNull()
    const changed = {...image, image: {...image.image, width: 2}, annotations: []}
    expect(restoreFromTrash(removed.trashed, [changed], key)).toMatchObject({restored: 0, stranded: 1, trash: removed.trashed})

    const deleted = trashFromDoc(text, new Set([textAnn.id]), 3)
    const selection = new Set(deleted.trashed.map(entryKey))
    for (const content of ['a', 'gamma zeta']) {
      const result = restoreFromTrash(deleted.trashed, [{...text, text: content, annotations: []}], selection)
      expect(result).toMatchObject({restored: 0, stranded: 1})
      expect(parseWorkspace(session(result.docs, result.trash))).not.toBeNull()
    }
    const relocated = restoreFromTrash(deleted.trashed, [{...text, text: 'prefix alpha beta', annotations: []}], selection)
    expect(relocated).toMatchObject({restored: 1, stranded: 0})
    expect(relocated.docs[0]?.annotations[0]).toMatchObject({start: 13, end: 17})
    expect(restoreFromTrash(deleted.trashed.map((t) => ({...t, targetIdentity: undefined, textQuote: undefined})), [text], selection)).toMatchObject({restored: 0, stranded: 1})
    expect(restoreFromTrash(deleted.trashed, [{...text, text: 'unrelated beta', annotations: []}], selection)).toMatchObject({restored: 0, stranded: 1})
    const revised = trashFromDoc({...text, revised: text.text, annotations: [{...textAnn, target: 'revised'}]}, new Set([textAnn.id]), 3)
    expect(restoreFromTrash(revised.trashed, [{...text, annotations: []}], selection)).toMatchObject({restored: 0, stranded: 1})
  })

  it('reserves orphaned trash document IDs when merging backups and gives copies independent identities', () => {
    const {trashed} = trashFromDoc(image, new Set(['a']), 3)
    const [copy] = prepareSessionDocs([image], [], trashed)
    expect(copy?.id).not.toBe(image.id)
    expect(copy?.annotations[0]?.id).not.toBe(region.id)
    expect(restoreFromTrash(trashed, [copy!], new Set(trashed.map(entryKey)))).toMatchObject({restored: 0, stranded: 1})
    expect(copy).toMatchObject({kind: 'image', image: image.image})
  })
})
