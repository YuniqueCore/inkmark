/** 文件导入管线：分类（文本 / 会话 JSON / W3C JSON）→ 解析 → 聚合结果。
 * 纯数据管线：无 DOM、不持有应用状态（文件读取是输入边界），主进程按结果应用。
 *
 * W3C 路由语义：inkmark 导出的 target.source 带 urn:inkmark:doc:<docId>，
 * 条目按 source 分发回各自的文档重锚；无 inkmark 来源（外部标注工具）或
 * 来源文档已不在工作区的条目回落到当前文档。锚定以「导入开始时的工作区
 * 快照」为准，避免隐式的顺序耦合。
 */

import { collectW3CItems, fromW3C, parseW3CSource } from './w3c'
import { SESSION_VERSION } from './types'
import type { Annotation, DocItem, Workspace } from './types'

const TEXT_SUFFIX = /\.(txt|md|markdown)$/i
const MAX_DOC_CHARS = 400_000 // 单文档上限，超出截断

export interface ImportContext {
  /** 工作区全部文档：W3C 按 source 分发的重锚目标池 */
  docs: DocItem[]
  /** 当前文档：无 inkmark 来源条目的回落目标 */
  currentDoc?: DocItem
}

export interface W3CRouted {
  /** 目标文档 id；null = 回落到当前文档 */
  docId: string | null
  annotations: Annotation[]
  /** 该组锚不上被跳过的条数 */
  unmatched: number
}

export interface ImportOutcome {
  /** 文本文件 → 新文档 */
  textDocs: DocItem[]
  /** 会话 JSON → 新文档（整体合并） */
  sessionDocs: DocItem[]
  /** 识别为 W3C 的文件数（0 条命中也计入，用于提示） */
  w3cFiles: number
  /** W3C 条目按来源文档分组的重锚结果 */
  w3cRouted: W3CRouted[]
  /** 无法识别 / 空内容而跳过的文件数 */
  skipped: number
  /** 超限被截断的文本文件数 */
  truncated: number
}

export function newDocId(): string {
  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
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
  }
  for (const file of Array.from(files)) {
    if (file.name.endsWith('.json')) {
      if (await trySessionFile(file, outcome)) continue
      if (await tryW3CFile(file, ctx, outcome)) continue
      outcome.skipped++
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
  return outcome
}

/** 会话 JSON（v2）→ 新文档集；不是会话格式返回 false 交给 W3C 处理链 */
async function trySessionFile(file: File, outcome: ImportOutcome): Promise<boolean> {
  try {
    const parsed = JSON.parse(await file.text()) as Partial<Workspace>
    if (parsed.version !== SESSION_VERSION || !Array.isArray(parsed.docs)) return false
    outcome.sessionDocs.push(...parsed.docs)
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

  // 按 source 文档分组：来源在工作区 → 该文档；否则 null → 当前文档回落
  const groups = new Map<string | null, unknown[]>()
  for (const item of items) {
    const source = (item as {target?: {source?: unknown}} | null)?.target?.source
    const { docId } = parseW3CSource(source)
    const key = docId && ctx.docs.some((d) => d.id === docId) ? docId : null
    const list = groups.get(key) ?? []
    list.push(item)
    groups.set(key, list)
  }
  for (const [docId, groupItems] of groups) {
    const target = docId ? ctx.docs.find((d) => d.id === docId)! : ctx.currentDoc
    if (!target) {
      // 无处可锚（无当前文档的回落组）：条目计入未匹配
      outcome.w3cRouted.push({ docId, annotations: [], unmatched: groupItems.length })
      continue
    }
    const result = fromW3C(groupItems, target.text, { revisedText: target.revised })
    outcome.w3cRouted.push({ docId, annotations: result.annotations, unmatched: result.unmatched })
  }
  return true
}
