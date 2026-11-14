/** 内部实体 ID 与不可信外部身份的稳定映射。 */
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

export function newId(prefix: string): string {
  return `${prefix}-${bytesToHex(crypto.getRandomValues(new Uint8Array(16)))}`
}

export function stableId(prefix: string, parts: unknown[]): string {
  return `${prefix}-${bytesToHex(sha256(utf8ToBytes(JSON.stringify(parts))))}`
}

export function availableId(id: string, used: ReadonlySet<string>): string {
  if (!used.has(id)) return id
  let index = 1
  while (used.has(`${id}-${index}`)) index++
  return `${id}-${index}`
}

/** Same external identity in a different document becomes a stable, independently owned entity. */
export function importedAnnotationId(id: string, documentId: string, occupied: ReadonlySet<string>, owned: ReadonlySet<string> = new Set()): string {
  if (owned.has(id)) return id
  const scoped = stableId('ann', [documentId, id])
  // A previous collision may have disappeared from another document or expired from trash.
  // Retain the identity already owned here, including a suffix allocated for a secondary collision.
  for (const existing of owned) {
    if (existing === scoped || (existing.startsWith(`${scoped}-`) && /^[1-9]\d*$/.test(existing.slice(scoped.length + 1)))) return existing
  }
  return occupied.has(id) ? availableId(scoped, occupied) : id
}
