import { stableId } from './identity'
import type { ImageRegion, RasterImage, ReviewAnnotation, ReviewDocument } from './types'
import { isImageDocument, isRegionAnnotation } from './types'

export const MAX_IMAGE_BYTES = 12 * 1024 * 1024
export const MAX_IMAGE_PIXELS = 32_000_000
export const MAX_IMAGE_SIDE = 16_384

export function rasterMediaType(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp'
  return null
}

export function imageBytes(image: RasterImage): Uint8Array {
  return Uint8Array.from(atob(image.dataUrl.slice(image.dataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0))
}

export function validImageSize(width: number, height: number): boolean {
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 &&
    width <= MAX_IMAGE_SIDE && height <= MAX_IMAGE_SIDE && width * height <= MAX_IMAGE_PIXELS
}

export function validRaster(image: RasterImage): boolean {
  if (!validImageSize(image.width, image.height) || image.dataUrl.length > MAX_IMAGE_BYTES * 4 / 3 + 64) return false
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(image.dataUrl)
  if (!match || match[2]!.length % 4 !== 0) return false
  try { return rasterMediaType(imageBytes(image)) === match[1] } catch { return false }
}

export function validRegion(region: ImageRegion, image: Pick<RasterImage, 'width' | 'height'>): boolean {
  const {x, y, width, height} = region
  return [x, y, width, height].every(Number.isSafeInteger) && x >= 0 && y >= 0 && width > 0 && height > 0 &&
    x + width <= image.width && y + height <= image.height
}

/** Interaction boundary: clamp and round outward once; stored/imported regions must already be valid. */
export function normalizeRegion(x: number, y: number, width: number, height: number, image: RasterImage): ImageRegion | null {
  if (![x, y, width, height].every(Number.isFinite) || width === 0 || height === 0) return null
  const left = Math.max(0, Math.floor(Math.min(x, x + width)))
  const top = Math.max(0, Math.floor(Math.min(y, y + height)))
  const right = Math.min(image.width, Math.ceil(Math.max(x, x + width)))
  const bottom = Math.min(image.height, Math.ceil(Math.max(y, y + height)))
  const region: ImageRegion = {type: 'rectangle', x: left, y: top, width: right - left, height: bottom - top}
  return validRegion(region, image) ? region : null
}

export const describeRegion = (r: ImageRegion): string => `区域 (${r.x}, ${r.y}) · ${r.width} × ${r.height} px`

const imageIdentities = new WeakMap<RasterImage, string>()
export function imageIdentity(image: RasterImage): string {
  let identity = imageIdentities.get(image)
  if (!identity) { identity = stableId('image', [image]); imageIdentities.set(image, identity) }
  return identity
}

export function targetIdentity(doc: ReviewDocument, ann: ReviewAnnotation): string | null {
  if (isImageDocument(doc)) return isRegionAnnotation(ann) ? imageIdentity(doc.image) : null
  if (isRegionAnnotation(ann)) return null
  const text = ann.target === 'revised' ? doc.revised : doc.text
  return text === undefined ? null : stableId('text', [ann.target ?? 'original', text])
}

export function annotationFits(doc: ReviewDocument, ann: ReviewAnnotation): boolean {
  if (isImageDocument(doc)) return isRegionAnnotation(ann) && validRegion(ann.selector, doc.image)
  if (isRegionAnnotation(ann)) return false
  const text = ann.target === 'revised' ? doc.revised : doc.text
  return text !== undefined && ann.start >= 0 && ann.end >= ann.start && ann.end <= text.length
}
