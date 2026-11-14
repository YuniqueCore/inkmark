/** Adapter boundary: the drawing library owns interaction, InkMark owns persisted geometry. */
import type { ShapeType, ImageAnnotation, RectangleGeometry } from '@annotorious/annotorious'
import { normalizeRegion, validRegion } from '../core/image'
import type { ImageRegion, RasterImage, RegionAnnotation } from '../core/types'

export function toCanvasAnnotation(ann: RegionAnnotation): ImageAnnotation {
  const {x, y, width: w, height: h} = ann.selector
  return {
    id: ann.id, bodies: [],
    target: {annotation: ann.id, selector: {type: 'RECTANGLE' as ShapeType,
      geometry: {x, y, w, h, bounds: {minX: x, minY: y, maxX: x + w, maxY: y + h}} as RectangleGeometry}},
  }
}

export function fromCanvasAnnotation(ann: ImageAnnotation, image: RasterImage, editing = false): ImageRegion | null {
  if (ann.target.selector.type !== 'RECTANGLE') return null
  const {x, y, w, h, rot} = ann.target.selector.geometry as RectangleGeometry
  if (rot !== undefined && rot !== 0) return null
  if (editing) {
    const region: ImageRegion = {type: 'rectangle', x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h)}
    return validRegion(region, image) ? region : null
  }
  return normalizeRegion(x, y, w, h, image)
}
