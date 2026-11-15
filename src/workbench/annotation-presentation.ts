import type { AnnotationBody, ReviewDocument, SlopMeta } from '../core/types'
import { isImageDocument } from '../core/types'
import { describeRegion } from '../core/image'
import { snippet } from '../core/text'

/** Sidebar input is a presentation, independent of coordinate systems and content rendering. */
export interface AnnotationPresentation extends AnnotationBody {
  excerpt: string
  order: number
  target?: 'revised'
  meta?: SlopMeta
  anchorLost?: true
  replacement?: string
}

export function presentAnnotations(doc: ReviewDocument): AnnotationPresentation[] {
  if (isImageDocument(doc)) return doc.annotations.map((ann, order) => ({
    ...ann, order, excerpt: describeRegion(ann.selector),
  }))
  return doc.annotations.map((ann) => ({
    ...ann, order: ann.start,
    excerpt: snippet(ann.target === 'revised' ? (doc.revised ?? '') : doc.text, ann.start, ann.end, 90),
  }))
}
