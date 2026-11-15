import {expect, it} from 'vitest'
import * as v from 'valibot'
import {Search} from '../../workbench/search'
import {ReviewList, reviewListItems} from '../../workbench/review-list'
import {SelectionDrafts, canSubmitComposition} from '../../workbench/composition'
import {presentAnnotations} from '../../workbench/annotation-presentation'
import {shellCommandSchema, nativeViewSchema} from '../../workbench/shell-protocol'
import type {Annotation, DocItem} from '../../core/types'

it('search navigation and grouped review keep one visible selection through resolution and re-filtering', () => {
  const search = new Search()
  search.docs = [{id: 'a', name: 'A', text: 'stable / stable'}, {id: 'b', name: 'B', text: 'stable'}]
  search.activeDocId = 'a'; search.query = 'stable'
  expect(search.navigate(1)).toEqual({docId: 'a', start: 0, end: 6})
  expect(search.navigate(-1)).toEqual({docId: 'a', start: 9, end: 15})
  search.crossDoc = true
  expect(search.navigate(1)?.docId).toBe('b')
  search.query = '['; search.useRegex = true
  expect(search.invalid()).toBe(true)
  expect(search.navigate(1)).toBeUndefined()
  search.reset(); search.useRegex = false; search.crossDoc = false; search.query = 'stable'
  const annotations: Annotation[] = search.hits().map((hit, index) => ({id: `ann-${index}`, start: hit.start, end: hit.end,
    kind: 'suggestion', comment: 'Clarify this claim', status: 'open', source: 'manual', groupId: 'batch', createdAt: 1, updatedAt: 1}))
  const doc: DocItem = {addedAt: 1, id: 'a', name: 'A', path: '', text: search.docs[0]!.text, annotations}
  const model = new ReviewList()
  const presented = presentAnnotations(doc)
  model.includeKind('suggestion')
  expect(model.kinds.size).toBe(0) // An all-types lens stays all-types after creating a review.
  expect(model.selectMatching(presented, 'open')).toBe(2)
  expect(reviewListItems(model.visible(presented)).map(item => item.kind === 'group' ? item.members.map(a => a.id) : item.ann.id)).toEqual([['ann-0', 'ann-1']])
  model.filter = 'open'
  doc.annotations[0] = {...doc.annotations[0]!, status: 'resolved'}
  model.reconcile(presentAnnotations(doc))
  expect([...model.selected]).toEqual(['ann-1'])
  model.filter = 'resolved'; model.reconcile(presentAnnotations(doc))
  expect([...model.selected]).toEqual([])
  model.selectMatching(presentAnnotations(doc), 'resolved')
  expect(model.visible(presentAnnotations(doc)).map(a => ({id: a.id, status: a.status, excerpt: a.excerpt}))).toMatchSnapshot()
})

it('retained selection drafts belong to a document, revision, range and side; cancellation never discards another owner', () => {
  const drafts = new SelectionDrafts()
  const owner = {docId: 'a', start: 0, end: 6, sourceText: 'stable'}
  const value = {kind: 'suggestion' as const, comment: 'Keep this draft', replacement: ''}
  drafts.write(owner, value)
  value.comment = 'caller changed'
  expect(drafts.read(owner)?.comment).toBe('Keep this draft')
  expect(drafts.read({...owner, docId: 'b'})).toBeUndefined()
  expect(drafts.read({...owner, sourceText: 'stable revised'})).toBeUndefined()
  expect(drafts.read({...owner, side: 'b'})).toBeUndefined()
  drafts.write({...owner, side: 'b'}, {...value, comment: 'Revision draft'})
  drafts.discard(new Set(['a']), 'a')
  expect(drafts.has(new Set(['a']), 'a')).toBe(false)
  expect(drafts.has(new Set(['a']), 'b')).toBe(true)
  expect(canSubmitComposition({kind: 'suggestion', comment: '  ', replacement: 'alone'})).toBe(false)
  expect(canSubmitComposition({kind: 'praise', comment: '', replacement: ''})).toBe(true)
})

it('native cancellation is independent of invalid edits; command boundaries reject extra authority and non-finite coordinates', () => {
  for (const [type, action] of [['text', 'cancel'], ['annotation', 'cancel'], ['annotation', 'dismiss'], ['search', 'close'], ['export', 'close'], ['settings', 'close'], ['trash', 'close'], ['import', 'cancel']] as const) {
    expect(v.parse(shellCommandSchema, {type, id: 'owned-session', action})).toEqual({type, id: 'owned-session', action})
  }
  expect(v.safeParse(shellCommandSchema, {type: 'text', id: 'owned-session', action: 'submit'}).success).toBe(false)
  expect(v.safeParse(shellCommandSchema, {type: 'workspace', action: 'new', script: 'arbitrary authority'}).success).toBe(false)
  expect(v.safeParse(shellCommandSchema, {type: 'annotation', id: 'owned-session', action: 'submit', value: {kind: 'praise', comment: '', replacement: ''}, region: {type: 'rectangle', x: Infinity, y: 0, width: 1, height: 1}}).success).toBe(false)
  const path = '/deep'.repeat(200)
  expect(v.parse(shellCommandSchema, {type: 'document', action: 'directory', id: path})).toEqual({type: 'document', action: 'directory', id: path})
  expect(v.safeParse(nativeViewSchema, {documents: [], arbitrary: true}).success).toBe(false)
})
