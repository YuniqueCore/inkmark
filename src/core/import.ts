/** 文件导入管线：分类（文本 / 会话 JSON / W3C JSON）→ 解析 → 聚合结果。
 * 纯数据管线：无 DOM、不持有应用状态（文件读取是输入边界），主进程按结果应用。
 *
 * W3C 路由语义：本地 target.source 明确指定文档身份；缺失或多个候选时拒绝匹配。
 * 同批会话先解析，再以全部候选路由，输入文件顺序不影响归属。
 * 只有外部无本地身份的条目才使用调用方明确提供的当前文档。
 */

import { collectW3CItems, fromImageW3C, fromW3C, parseW3CSource } from './w3c'
import { parseWorkspace } from './session'
import type { DocItem, ReviewDocument, ReviewAnnotation } from './types'
import type { TrashEntry } from './types'
import { uniqueDocumentName } from './import-conflict'
import { newId, importedAnnotationId } from './identity'
import { isImageDocument } from './types'
import { remapAnnotationIds } from './document'

const TEXT_SUFFIX = /\.(txt|md|markdown)$/i
export const MAX_DOC_CHARS = 400_000 // 单文档上限；文件导入超出时会提示截断

export interface ImportContext {
  /** 工作区全部文档：W3C 按 source 分发的重锚目标池 */
  docs: ReviewDocument[]
  /** 当前文档：无 inkmark 来源条目的回落目标 */
  currentDoc?: ReviewDocument
}

export interface W3CRouted {
  /** 已确定的目标文档 id；null = 外部来源且没有可用目标 */
  docId: string | null
  annotations: ReviewAnnotation[]
  /** 该组锚不上被跳过的条数 */
  unmatched: number
}

export interface ImportOutcome {
  /** 文本文件 → 新文档 */
  textDocs: DocItem[]
  /** 会话 JSON → 新文档（整体合并） */
  sessionDocs: ReviewDocument[]
  /** 识别为 W3C 的文件数（0 条命中也计入，用于提示） */
  w3cFiles: number
  /** W3C 条目按来源文档分组的重锚结果 */
  w3cRouted: W3CRouted[]
  /** 无法识别 / 空内容而跳过的文件数 */
  skipped: number
  /** 超限被截断的文本文件数 */
  truncated: number
  /** Merge import only includes live documents; complete recovery is a separate command. */
  omittedTrash: number
}

export function newDocId(): string {
  return newId('doc')
}

/** 合并会话文档时保留不同文档，避免 ID 或路径名称冲突。 */
export function prepareSessionDocs(incoming: ReviewDocument[], existing: ReviewDocument[], trash: TrashEntry[]): ReviewDocument[] {
  const docs = [...existing]
  const docIds = new Set([...existing.map((d) => d.id), ...trash.map((t) => t.type === 'doc' ? t.doc.id : t.docId)])
  const annIds = new Set([
    ...existing.flatMap((d) => d.annotations.map((a) => a.id)),
    ...trash.flatMap((t) => t.type === 'doc' ? t.doc.annotations.map((a) => a.id) : [t.annotation.id]),
  ])
  const added: ReviewDocument[] = []
  for (const doc of incoming) {
    let id = doc.id
    while (docIds.has(id)) id = newDocId()
    docIds.add(id)
    const name = uniqueDocumentName(doc.name, doc.path, docs)
    const mapped = remapAnnotationIds(doc, (oldId) => {
      const annId = importedAnnotationId(oldId, id, annIds)
      annIds.add(annId)
      return annId
    })
    const next = {...mapped, id, name}
    docs.push(next)
    added.push(next)
  }
  return added
}

export async function importFileList(
  files: FileList | File[],
  ctx: ImportContext,
): Promise<ImportOutcome> {
  const outcome: ImportOutcome = {
    textDocs: [],
    sessionDocs: [],
    w3cFiles: 0,
    w3cRouted: [],
    skipped: 0,
    truncated: 0,
    omittedTrash: 0,
  }
  const annotationFiles: File[] = []
  for (const file of Array.from(files)) {
    if (file.name.endsWith('.json')) {
      if (await trySessionFile(file, outcome)) continue
      annotationFiles.push(file)
      continue
    }
    if (!TEXT_SUFFIX.test(file.name)) {
      outcome.skipped++
      continue
    }
    let text = await file.text()
    if (text.length > MAX_DOC_CHARS) {
      text = text.slice(0, MAX_DOC_CHARS)
      outcome.truncated++
    }
    if (text.trim() === '') {
      outcome.skipped++
      continue
    }
    const rel = (file as File & {webkitRelativePath?: string}).webkitRelativePath ?? ''
    outcome.textDocs.push({
      id: newDocId(),
      name: file.name,
      path: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '',
      text,
      annotations: [],
      addedAt: Date.now(),
    })
  }
  for (const file of annotationFiles) if (!await tryW3CFile(file, ctx, outcome)) outcome.skipped++
  return outcome
}

/** 会话 JSON（v1/v2/v3，统一经 parseWorkspace 迁移）→ 新文档集；不是会话格式返回 false 交给 W3C 处理链 */
async function trySessionFile(file: File, outcome: ImportOutcome): Promise<boolean> {
  try {
    const ws = parseWorkspace(await file.text())
    if (!ws) return false
    outcome.sessionDocs.push(...ws.docs)
    outcome.omittedTrash += ws.trash.length
    return true
  } catch {
    return false
  }
}

/** W3C JSON → 条目按 source 分发回各自文档重锚；0 条目返回 false（非 W3C 文件） */
async function tryW3CFile(file: File, ctx: ImportContext, outcome: ImportOutcome): Promise<boolean> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await file.text()) as unknown
  } catch {
    return false
  }
  const items = collectW3CItems(parsed)
  if (items.length === 0) return false
  outcome.w3cFiles++

  const candidates = [...ctx.docs, ...outcome.sessionDocs]
  // Explicit local identity is authoritative. Multiple candidates are ambiguous, never a fallback.
  const groups = new Map<string | null, unknown[]>()
  for (const item of items) {
    const source = (item as {target?: {source?: unknown}} | null)?.target?.source
    const { docId } = parseW3CSource(source)
    const key = docId
    const list = groups.get(key) ?? []
    list.push(item)
    groups.set(key, list)
  }
  for (const [docId, groupItems] of groups) {
    const matches = candidates.filter((d) => d.id === docId)
    const target = docId ? (matches.length === 1 ? matches[0] : undefined) : ctx.currentDoc
    if (!target) {
      // 无处可锚（无当前文档的回落组）：条目计入未匹配
      outcome.w3cRouted.push({ docId, annotations: [], unmatched: groupItems.length })
      continue
    }
    const result = isImageDocument(target) ? fromImageW3C(groupItems, target) : fromW3C(groupItems, target.text, { revisedText: target.revised, identityScope: target.id })
    outcome.w3cRouted.push({ docId: target.id, annotations: result.annotations, unmatched: result.unmatched })
  }
  return true
}
