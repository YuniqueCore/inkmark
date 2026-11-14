# Image review architecture

InkMark reviews text and images in one workspace. An image is a document with its own immutable raster content and region annotations; it never receives empty text or artificial text offsets.

| Primitive | Responsibility | Consumers |
| --- | --- | --- |
| `DocumentIdentity` | Workspace identity, name and path | File tree, import, trash |
| `RasterImage` | Original PNG/JPEG/WebP data and decoded dimensions | Image surface, persistence, export |
| Text range / `ImageRegion` | Content-local selection | Text renderers / Annotorious adapter |
| `AnnotationBody` | Opinion, kind, status, identity and timestamps | Composer, sidebar, export |
| `AnnotationPresentation` | Excerpt and ordering for a list | Shared sidebar |
| Review export artifact | Preview and file layout from one selected scope | Export dialog, downloads |
| Workspace snapshot | Atomic persistence and complete recovery | IndexedDB, recovery JSON |

Text analysis, replacements, revised text and Markdown mapping remain text capabilities. Shared document operations preserve the content/selector relationship. Images do not inherit text-only fields or business rules.

## Interaction and coordinates

Annotorious owns rectangle pointer interaction and SVG scaling. InkMark converts its geometry at a narrow adapter boundary; library bounds, view transforms and internal IDs are not persistence state. Coordinates are integer, half-open rectangles in the browser-decoded image orientation. New drawing is clipped to image bounds. Editing rounds position and dimensions independently, preventing repeated fractional-scale moves from enlarging a rectangle; out-of-bounds adjustments are rejected and reverted. Rotation is disabled and rejected by the adapter.

A new rectangle and its opinion commit together. Cancelling leaves neither an empty annotation nor a stale overlay. An edit retains its expected original annotation and cannot recreate a deleted object or overwrite a newer status. Coordinate input supports keyboard operation; select and pan remain available during a draft. Image drafts block document navigation until saved or cancelled.

Original raster bytes are embedded in the snapshot instead of persisted object URLs. This deliberately favors portable, atomic backup over a separate asset database and reference-cleanup protocol. Input is limited to 12 MB, 32 million pixels and 16384 pixels per side. Files are checked by signature and decoded before import; imported backups also verify dimensions. SVG and GIF are not accepted.

## Durability and recovery

`idb-keyval` commits a serialized snapshot in IndexedDB. The save coordinator debounces writes, skips obsolete queued revisions, and reports success only after transaction completion. Each write compares the stored snapshot with the last observed value in the same read/write transaction. A divergent tab cannot overwrite another tab silently; its in-memory state remains downloadable. Merely opening a second tab does not write a new snapshot.

Complete recovery includes live documents, original images and trash. Restoring a complete backup is an explicit replacement, waits for pending saves, freezes interaction during the transaction and warns that drafts are excluded. Document-only merge import remains a separate operation. Legacy localStorage is never automatically removed: old tabs cannot participate in an IndexedDB transaction. A visible download action reads its latest value; when IndexedDB cannot be read, available legacy data remains readable and downloadable while writes remain blocked. Ordinary merge import reports omitted trash and directs users to complete recovery.

Deleted annotations retain target identity. Text additionally retains quote context: after edits, restoration requires a unique exact quote and matching retained context. Unverified, missing or changed targets remain in trash instead of corrupting the workspace. Imported document IDs also avoid IDs referenced by orphaned trash annotations.

## Export contracts

Image review ZIPs contain unchanged image bytes, Markdown opinions with pixel coordinates, and document JSON. The resolved toggle applies to every review-package entry, including JSON. Complete backups use the separate recovery action and preserve all statuses and trash. `buildReviewExport` owns preview and artifact layout; the UI only encodes, compresses and downloads. Sidebar selection is limited to visible annotations. A selected export includes selected resolved annotations, without changing the default of subsequent document exports.

Image W3C exports use `FragmentSelector` (`xywh=pixel:x,y,width,height`). Source includes document identity and a cached immutable-image digest. Import requires both to match; it does not guess a destination from the active text document or another copy of an image. Multiple documents produce one merged W3C JSON, identical to the preview. Same-batch session documents are parsed before W3C routing; missing or ambiguous explicit document identities are rejected. Existing-document imports participate in overwrite reanchoring; new-document imports attach after identity allocation. Backup and W3C annotation identity collisions use the same stable document scope. W3C JSON does not carry image bytes. Reimporting the same annotation into its original image document is idempotent.

## Verification and references

Business tests cover mixed text/image review, reverse drawing, coordinate editing and validation, repeated moves at 125%, out-of-bounds rejection, narrow-view zoom, shared filters/status/trash, exact image bytes in exported ZIPs, W3C replay, complete recovery, failed transactions, concurrent tabs and touch pan. Tests also cover mixed multi-selection, keyboard focus, filtered export/deletion, same-batch W3C routing and replay, stale confirmations, in-flight imports during recovery and concurrent legacy writes. Structural/W3C snapshots are portable; screenshot baselines use macOS Chrome. No claim is made for Safari, Firefox or native system clipboard automation beyond browser ClipboardEvent integration.

EditHere supplied a behavioral reference for screenshot feedback; no source was copied. Its license is [PolyForm Noncommercial 1.0.0](https://github.com/Inginnng/EditHere/blob/2a94cc8b46d0bbb2065287eb612af8b0dc19ce10/LICENSE). The drawing dependency is [Annotorious](https://annotorious.dev/api-reference/image-annotator/) (BSD-3-Clause). Persistence uses [idb-keyval](https://github.com/jakearchibald/idb-keyval). Interchange follows [W3C Web Annotation](https://www.w3.org/TR/annotation-model/#fragment-selector) and [Media Fragments](https://www.w3.org/TR/media-frags/).
