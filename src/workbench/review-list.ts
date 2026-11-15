import type {AnnotationBody, AnnotationKind} from '../core/types'
import type {AnnotationPresentation} from './annotation-presentation'

export type StatusFilter = 'all' | 'open' | 'resolved'
export type ReviewListItem = {kind: 'single'; ann: AnnotationPresentation} | {kind: 'group'; members: AnnotationPresentation[]}

/** Review selection always refers to annotations, including members of a grouped row. */
export class ReviewList {
  filter: StatusFilter = 'all'
  kinds = new Set<AnnotationKind>()
  highlightFiltered = false
  activeId: string | null = null
  expanded = new Set<string>()
  selected = new Set<string>()

  visible<A extends AnnotationBody>(annotations: readonly A[]): A[] {
    return annotations.filter(a => (this.filter === 'all' || a.status === this.filter) &&
      (this.kinds.size === 0 || this.kinds.has(a.kind)))
  }

  includeKind(kind: AnnotationKind): Set<AnnotationKind> {
    if (this.kinds.size > 0) this.kinds = new Set([...this.kinds, kind])
    return this.kinds
  }

  selectMatching(annotations: readonly AnnotationPresentation[], selection: string): number {
    const matches = this.visible(annotations).filter(a => selection === 'lost' ? a.anchorLost :
      selection === 'revised' ? a.target === 'revised' : selection.startsWith('kind:') ? a.kind === selection.slice(5) : a.status === selection)
    for (const ann of matches) this.selected.add(ann.id)
    return matches.length
  }

  reconcile(annotations: readonly AnnotationBody[]): void {
    const visible = new Set(this.visible(annotations).map(a => a.id))
    this.selected = new Set([...this.selected].filter(id => visible.has(id)))
    const groups = new Set(annotations.flatMap(a => a.groupId ? [a.groupId] : []))
    this.expanded = new Set([...this.expanded].filter(id => groups.has(id)))
    if (!annotations.some(a => a.id === this.activeId)) this.activeId = null
  }
}

export function reviewListItems(shown: readonly AnnotationPresentation[]): ReviewListItem[] {
  const singles: ReviewListItem[] = []
  const groups = new Map<string, AnnotationPresentation[]>()
  for (const ann of shown) {
    if (ann.groupId === undefined) singles.push({kind: 'single', ann})
    else {
      const members = groups.get(ann.groupId) ?? []
      members.push(ann)
      groups.set(ann.groupId, members)
    }
  }
  const items: ReviewListItem[] = [...singles, ...[...groups.values()].map(members => ({
    kind: 'group' as const, members: [...members].sort((a, b) => a.order - b.order),
  }))]
  const order = (item: ReviewListItem): number => item.kind === 'single' ? item.ann.order : item.members[0]!.order
  return items.sort((a, b) => order(a) - order(b))
}
