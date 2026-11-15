import type {AnnotationKind} from '../core/types'

export interface ComposerState {kind: AnnotationKind; comment: string; replacement: string}
export function canSubmitComposition(state: ComposerState): boolean { return state.kind === 'praise' || state.comment.trim() !== '' }
export function hasComposition(state: ComposerState): boolean { return state.comment.trim() !== '' || state.replacement.trim() !== '' || state.kind !== 'suggestion' }

export interface SelectionOwner {docId: string; start: number; end: number; sourceText: string; side?: 'b'}

/** Draft identity includes source revision; matching offsets in another revision never inherit it. */
export class SelectionDrafts {
  private entries = new Map<string, Map<string, {owner: SelectionOwner; value: ComposerState}>>()
  private key(owner: SelectionOwner): string { return `${owner.docId}:${owner.side ?? 'a'}:${owner.start}:${owner.end}` }
  read(owner: SelectionOwner): ComposerState | undefined { return this.entries.get(this.key(owner))?.get(owner.sourceText)?.value }
  write(owner: SelectionOwner, value: ComposerState): void {
    const versions = this.entries.get(this.key(owner)) ?? new Map()
    versions.set(owner.sourceText, {owner, value: {...value}})
    this.entries.set(this.key(owner), versions)
  }
  remove(owner: SelectionOwner): void {
    const key = this.key(owner)
    const versions = this.entries.get(key)
    versions?.delete(owner.sourceText)
    if (!versions?.size) this.entries.delete(key)
  }
  has(docIds?: ReadonlySet<string>, side?: 'a' | 'b'): boolean {
    return [...this.entries.values()].some(versions => [...versions.values()].some(({owner, value}) =>
      (!docIds || docIds.has(owner.docId)) && (!side || (owner.side ?? 'a') === side) && hasComposition(value)))
  }
  discard(docIds: ReadonlySet<string>, side?: 'a' | 'b'): void {
    for (const [key, versions] of this.entries) {
      for (const [text, {owner}] of versions) if (docIds.has(owner.docId) && (!side || (owner.side ?? 'a') === side)) versions.delete(text)
      if (versions.size === 0) this.entries.delete(key)
    }
  }
}
