/** Export content and file layout. Encoding, ZIP compression and downloads belong to the UI boundary. */
import { exportAs, exportFileName, zipEntryNames, type ExportFormat } from './export'
import { filterAnnotations } from './document'
import { imageBytes } from './image'
import { toW3C } from './w3c'
import { isImageDocument, KIND_LABEL, SESSION_VERSION, type ImageDocument, type ReviewDocument } from './types'

export type ReviewFormat = ExportFormat | 'w3c'
export type ReviewExport = { preview: string } & (
  | { kind: 'file'; name: string; mediaType: string }
  | { kind: 'bundle'; name: string; entries: Record<string, string | Uint8Array> }
)

export function buildReviewExport(
  docs: ReviewDocument[],
  format: ReviewFormat,
  options: { includeResolved?: boolean; includeFileInfo?: boolean; date?: Date } = {},
): ReviewExport {
  if (docs.length === 0) throw new Error('Choose at least one document to export')
  const date = options.date ?? new Date()
  const stamp = date.toISOString().slice(0, 10)
  // Apply selection once: previews, W3C and every review-package entry share the same scope.
  const selected = docs.map((doc) => filterAnnotations(doc, (a) => options.includeResolved || a.status === 'open'))
  const multi = selected.length > 1
  if (format === 'w3c') {
    return {
      kind: 'file',
      name: multi ? `批注-w3c-${selected.length}文档-${stamp}.json` : exportFileName(selected[0]!.name, format, date),
      mediaType: 'application/json;charset=utf-8',
      preview: JSON.stringify(selected.flatMap((doc) => toW3C(doc, {includeResolved: true})), null, 2),
    }
  }
  const hasImages = selected.some(isImageDocument)
  const effectiveFormat = hasImages ? 'review' : format
  const contents = selected.map((doc, i) => isImageDocument(doc)
    ? imageReview(doc, imageName(doc, i))
    : exportAs(effectiveFormat, doc.text, doc.annotations, {
      includeResolved: true,
      revisedText: doc.revised,
      fileName: multi || options.includeFileInfo ? doc.name : undefined,
    }))
  const preview = contents.join('\n\n---\n\n')
  if (!multi && !hasImages) return {
    kind: 'file', name: exportFileName(selected[0]!.name, effectiveFormat, date),
    mediaType: 'text/markdown;charset=utf-8', preview,
  }
  const entries: Record<string, string | Uint8Array> = {}
  const names = zipEntryNames(selected.map((doc) => doc.name), effectiveFormat, date)
  selected.forEach((doc, i) => {
    entries[names[i]!] = contents[i]!
    if (isImageDocument(doc)) entries[imageName(doc, i)] = imageBytes(doc.image)
  })
  if (hasImages) entries['inkmark-documents.json'] = JSON.stringify({
    version: SESSION_VERSION, docs: selected, activeDocId: selected[0]!.id, trash: [], savedAt: date.getTime(),
  })
  return {kind: 'bundle', name: `批注-${effectiveFormat}-${selected.length}文档-${stamp}.zip`, preview, entries}
}

function imageName(doc: ImageDocument, index: number): string {
  const extension = doc.image.dataUrl.startsWith('data:image/jpeg;') ? 'jpg' : doc.image.dataUrl.startsWith('data:image/webp;') ? 'webp' : 'png'
  return `image-${index + 1}.${extension}`
}

function imageReview(doc: ImageDocument, imageName: string): string {
  return [`# ${doc.name}`, `![原图](${imageName})`,
    `原图尺寸：${doc.image.width} × ${doc.image.height} px。坐标原点在左上角，区域为 x, y, width, height。`,
    ...doc.annotations.map((a, i) => {
      const r = a.selector
      return `## ${i + 1}. ${KIND_LABEL[a.kind]}${a.status === 'resolved' ? ' · 已解决' : ''}\n\n区域：(${r.x}, ${r.y}, ${r.width}, ${r.height}) px\n\n${a.comment}`
    }),
  ].join('\n\n')
}
