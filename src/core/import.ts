/** 文件导入管线：分类（文本 / 会话 JSON / W3C JSON）→ 解析 → 聚合结果。
 * 纯数据管线：无 DOM、不持有应用状态（文件读取是输入边界），主进程按结果应用。
 *
 * 语义约定：W3C 批注锚定在「导入开始时的活动文档」上——不论会话 JSON 是否
 * 在同批次里先切换了活动文档，都以此为锚，避免隐式的顺序耦合。
 */

import { SESSION_VERSION } from './types'
import { fromW3C } from './w3c'
import type { Annotation, DocItem, Workspace } from './types'

const TEXT_SUFFIX = /\.(txt|md|markdown)$/i
const MAX_DOC_CHARS = 400_000 // 单文档上限，超出截断

export interface ImportOutcome {
  /** 文本文件 → 新文档 */
  textDocs: DocItem[]
  /** 会话 JSON → 新文档（整体合并） */
  sessionDocs: DocItem[]
  /** W3C JSON → 并入当前文档的批注 */
  w3cAnnotations: Annotation[]
  /** 识别为 W3C 的文件数（0 条命中也计入，用于提示） */
  w3cFiles: number
  /** W3C 锚不上被跳过的条数 */
  w3cUnmatched: number
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
  currentDoc: DocItem | undefined,
): Promise<ImportOutcome> {
  const outcome: ImportOutcome = {
    textDocs: [],
    sessionDocs: [],
    w3cAnnotations: [],
    w3cFiles: 0,
    w3cUnmatched: 0,
    skipped: 0,
    truncated: 0,
  }
  for (const file of Array.from(files)) {
    if (file.name.endsWith('.json')) {
      if (await trySessionFile(file, outcome)) continue
      if (await tryW3CFile(file, currentDoc, outcome)) continue
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

/** 会话 JSON（version 2）→ 新文档集；不是会话格式返回 false 交给 W3C 处理链 */
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

/** W3C Web Annotation JSON → 并入当前文档的批注；解析失败或 0 条返回 false */
async function tryW3CFile(
  file: File,
  currentDoc: DocItem | undefined,
  outcome: ImportOutcome,
): Promise<boolean> {
  if (!currentDoc) return false
  try {
    const parsed = JSON.parse(await file.text()) as unknown
    const result = fromW3C(parsed, currentDoc.text)
    if (result.total === 0) return false
    outcome.w3cFiles++
    outcome.w3cAnnotations.push(...result.annotations)
    outcome.w3cUnmatched += result.unmatched
    return true
  } catch {
    return false
  }
}
