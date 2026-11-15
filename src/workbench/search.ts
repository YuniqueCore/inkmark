import {findMatches, regexIssue, type MatchOptions, type MatchRange} from '../core/batch'

export interface SearchHit {docId: string; start: number; end: number}
export interface BatchTarget {docId: string; matches: MatchRange[]}
export interface SearchDocument {id: string; name: string; text: string}

/** Search scope and navigation are shared by native and browser presentations. */
export class Search {
  query = ''
  caseSensitive = false
  useRegex = false
  crossDoc = false
  navIndex = -1
  docs: SearchDocument[] = []
  activeDocId = ''

  options(): MatchOptions { return {caseSensitive: this.caseSensitive, regex: this.useRegex} }
  invalid(): boolean { return this.useRegex && this.query.trim() !== '' && regexIssue(this.query) !== null }
  targets(): BatchTarget[] {
    return this.docs.filter(doc => this.crossDoc || doc.id === this.activeDocId)
      .map(doc => ({docId: doc.id, matches: findMatches(doc.text, this.query, this.options())}))
      .filter(target => target.matches.length > 0)
  }
  hits(): SearchHit[] { return this.targets().flatMap(target => target.matches.map(match => ({docId: target.docId, ...match}))) }
  navigate(delta: 1 | -1): SearchHit | undefined {
    const hits = this.hits()
    if (hits.length === 0) { this.navIndex = -1; return undefined }
    const initial = this.navIndex < 0 ? (delta > 0 ? -1 : 0) : this.navIndex
    this.navIndex = (initial + delta + hits.length) % hits.length
    return hits[this.navIndex]
  }
  reset(): void { this.query = ''; this.navIndex = -1 }
}
