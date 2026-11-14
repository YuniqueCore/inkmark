import type { Annotation, AnnotationBody, ReviewAnnotation, ReviewDocument } from './types'
import { isImageDocument, isRegionAnnotation } from './types'

/** Shared document operations preserve the relationship between content and selector type. */
export function filterAnnotations(doc: ReviewDocument, keep: (ann: ReviewAnnotation) => boolean): ReviewDocument {
  return isImageDocument(doc)
    ? {...doc, annotations: doc.annotations.filter(keep)}
    : {...doc, annotations: doc.annotations.filter(keep)}
}

export function patchAnnotationBodies(doc: ReviewDocument, ids: ReadonlySet<string>, patch: Partial<Omit<AnnotationBody, 'id' | 'createdAt'>>): ReviewDocument {
  const update = <A extends AnnotationBody>(ann: A): A => ids.has(ann.id) ? {...ann, ...patch} : ann
  return isImageDocument(doc)
    ? {...doc, annotations: doc.annotations.map(update)}
    : {...doc, annotations: doc.annotations.map(update)}
}

export function appendAnnotations(doc: ReviewDocument, annotations: ReviewAnnotation[]): ReviewDocument {
  if (isImageDocument(doc)) {
    if (!annotations.every(isRegionAnnotation)) throw new Error('Image document requires region selectors')
    return {...doc, annotations: [...doc.annotations, ...annotations]}
  }
  const textAnnotations = annotations.filter((a): a is Annotation => !isRegionAnnotation(a))
  if (textAnnotations.length !== annotations.length) throw new Error('Text document requires text selectors')
  return {...doc, annotations: [...doc.annotations, ...textAnnotations]}
}

export function remapAnnotationIds(doc: ReviewDocument, mapId: (id: string) => string): ReviewDocument {
  const update = <A extends AnnotationBody>(ann: A): A => ({...ann, id: mapId(ann.id)})
  return isImageDocument(doc)
    ? {...doc, annotations: doc.annotations.map(update)}
    : {...doc, annotations: doc.annotations.map(update)}
}
