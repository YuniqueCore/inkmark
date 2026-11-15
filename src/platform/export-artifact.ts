import {strToU8, zipSync} from 'fflate'
import type {ReviewExport} from '../core/review-export'

/** Both shells save the exact artifact that supplied the review preview. */
export function artifactFile(artifact: ReviewExport): File {
  const blob = artifact.kind === 'bundle'
    ? new Blob([zipSync(Object.fromEntries(Object.entries(artifact.entries).map(([name, value]) => [name, typeof value === 'string' ? strToU8(value) : value])))], {type: 'application/zip'})
    : new Blob([artifact.preview], {type: artifact.mediaType})
  return new File([blob], artifact.name, {type: blob.type})
}
