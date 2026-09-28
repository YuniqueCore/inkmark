/** 三种导出格式：原文+批注（行内标记）、片段+批注、评审引用块（贴回给 AI）。全部纯函数。
 * 每条批注都带 `@start-end` 字符偏移（0-based、右端开区间，与 W3C TextPositionSelector
 * 语义一致）：改稿侧批注的偏移相对改稿文本，输出中已注明。 */

import { splitBlocks, snippet } from './text'
import { KIND_LABEL } from './types'
import type { Annotation, AnnotationKind } from './types'

export interface ExportOptions {
  /** 默认 false：已解决的批注不出现在导出里 */
  includeResolved?: boolean
  /** 行内标记里摘录锚点原文的长度上限 */
  maxSnippetLen?: number
  /** AI 改稿全文：存在时，改稿侧批注（target === 'revised'）参与导出 */
  revisedText?: string
  /** 文件信息：提供时在导出顶部标注来源「文件：{name}」，多文档场景区分出处 */
  fileName?: string
}

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'

/** 评审引用块里的前缀符号（纯文本标记，不用 emoji） */
export const KIND_MARK: Record<AnnotationKind, string> = {
  issue: '[!]',
  slop: '[!]',
  suggestion: '[~]',
  question: '[?]',
  highlight: '[*]',
  praise: '[+]',
}

/** 按文档位置排序并编号：①②③…（超过 20 用 (21) 形式）。返回 id → 标号。 */
export function numberAnnotations(anns: Annotation[]): Map<string, string> {
  const sorted = [...anns].sort((a, b) => a.start - b.start || a.end - b.end)
  const map = new Map<string, string>()
  sorted.forEach((a, i) => {
    map.set(a.id, i < CIRCLED.length ? CIRCLED[i]! : `(${i + 1})`)
  })
  return map
}

function visible(anns: Annotation[], opts: ExportOptions): Annotation[] {
  return anns.filter((a) => opts.includeResolved || a.status !== 'resolved')
}

function anchorText(a: Annotation, text: string, opts: ExportOptions): string {
  return a.target === 'revised' ? (opts.revisedText ?? text) : text
}

function marker(a: Annotation, num: string): string {
  const label = KIND_LABEL[a.kind]
  const lost = a.anchorLost ? '·失锚' : ''
  return `【批注${num}·${label} @${a.start}-${a.end}${lost}】${a.comment.trim()}${replacementNote(a)}`
}

/** 批量批注的建议替换词：机器可执行的指令片段（三种文本导出共用） */
function replacementNote(a: Annotation): string {
  return a.replacement ? ` → 替换为「${a.replacement}」` : ''
}

/**
 * 格式一：完整原文 + 行内批注。
 * 批注标记插在锚点范围结束处；同一位置多个批注按序并列。
 * 改稿侧批注无法在原文中定位，单独列在文末。
 */
export function exportInline(text: string, anns: Annotation[], opts: ExportOptions = {}): string {
  const picked = visible(anns, opts)
  const inlineAnns = picked.filter((a) => a.target !== 'revised')
  const revisedAnns = picked.filter((a) => a.target === 'revised')
  const head = opts.fileName ? `文件：${opts.fileName}\n\n` : ''
  if (picked.length === 0) return head + text
  const numbers = numberAnnotations(picked)
  const blocks = splitBlocks(text)
  const out: string[] = []
  let cursor = 0
  for (const block of blocks) {
    // 块前的分隔空行原样保留
    out.push(text.slice(cursor, block.start))
    const blockEnd = block.start + block.text.length
    const here = inlineAnns
      .filter((a) => a.end > block.start && a.start < blockEnd)
      .sort((a, b) => a.end - b.end || a.start - b.start)
    let pos = block.start
    for (const a of here) {
      const clipEnd = Math.min(a.end, blockEnd)
      if (clipEnd > pos) {
        out.push(text.slice(pos, clipEnd))
        pos = clipEnd
      }
      const num = numbers.get(a.id)!
      out.push(marker(a, num))
    }
    out.push(text.slice(pos, blockEnd))
    cursor = blockEnd
  }
    out.push(text.slice(cursor))
  if (revisedAnns.length > 0) {
    out.push(`\n\n—— 以下 ${revisedAnns.length} 条批注针对 AI 改稿（偏移相对改稿文本，不在原文中定位）——`)
    for (const a of revisedAnns) {
      const num = numbers.get(a.id)!
      out.push(`\n${marker(a, num)}`)
    }
  }
  return head + out.join('')
}

/**
 * 格式二：批注片段 + 批注。逐条列出锚点原文和批注内容。
 */
export function exportSnippets(text: string, anns: Annotation[], opts: ExportOptions = {}): string {
  const picked = visible(anns, opts)
  const numbers = numberAnnotations(picked)
  const maxLen = opts.maxSnippetLen ?? 200
  if (picked.length === 0) return opts.fileName ? `文件：${opts.fileName}` : ''
  const body = picked
    .map((a) => {
      const num = numbers.get(a.id)!
      const quote = snippet(anchorText(a, text, opts), a.start, a.end, maxLen)
      const sideMark = a.target === 'revised' ? '（改稿）' : ''
      const lost = a.anchorLost ? '·失锚' : ''
      return `【片段${num} @${a.start}-${a.end}${lost}】${sideMark}${quote}\n【批注${num}·${KIND_LABEL[a.kind]}】${a.comment.trim()}${replacementNote(a)}`
    })
    .join('\n\n')
  return opts.fileName ? `文件：${opts.fileName}\n\n${body}` : body
}

/**
 * 格式三：评审引用块（Markdown 引用，贴回给 AI agent）。
 * 头部一行统计；每条批注 = 引用的原文行 + 批注行。
 */
export function exportReview(text: string, anns: Annotation[], opts: ExportOptions = {}): string {
  const picked = visible(anns, opts)
  const numbers = numberAnnotations(picked)
  const maxLen = opts.maxSnippetLen ?? 160
  const lines: string[] = [`批注反馈（共 ${picked.length} 条）：`]
  for (const a of picked) {
    const num = numbers.get(a.id)!
    const quote = snippet(anchorText(a, text, opts), a.start, a.end, maxLen).replace(/\n+/g, ' ')
    const sideLabel = a.target === 'revised' ? '改稿' : '原文'
    lines.push(`> ${sideLabel} @${a.start}-${a.end}${a.anchorLost ? '·失锚' : ''}：${quote}`)
    lines.push(`> ${KIND_MARK[a.kind]} 批注${num}（${KIND_LABEL[a.kind]}）：${a.comment.trim()}${replacementNote(a)}`)
    lines.push('')
  }
  const head = opts.fileName ? `文件：${opts.fileName}\n\n` : ''
  return head + lines.join('\n').trimEnd()
}

export type ExportFormat = 'inline' | 'snippets' | 'review'

export function exportAs(
  format: ExportFormat,
  text: string,
  anns: Annotation[],
  opts: ExportOptions = {},
): string {
  switch (format) {
    case 'inline':
      return exportInline(text, anns, opts)
    case 'snippets':
      return exportSnippets(text, anns, opts)
    case 'review':
      return exportReview(text, anns, opts)
  }
}

/** 下载文件名：`{原文件名去扩展名}-批注-{format}-{日期}.{md|json}`。
 * 来源文件名打头，多文档场景一眼分清是哪份文件的批注；
 * 清洗文件系统非法字符，去扩展名后为空则退回 untitled。 */
export function exportFileName(
  docName: string,
  format: ExportFormat | 'w3c',
  date = new Date(),
): string {
  const base =
    docName.replace(/\.[a-z0-9]+$/i, '').replace(/[/\\:*?"<>|]/g, '-').trim() || 'untitled'
  const stamp = date.toISOString().slice(0, 10)
  return `${base}-批注-${format}-${stamp}.${format === 'w3c' ? 'json' : 'md'}`
}

/** 多文档 zip 的条目名：同名文档追加 -2、-3 序号，绝不互相覆盖。 */
export function zipEntryNames(
  docNames: string[],
  format: ExportFormat | 'w3c',
  date = new Date(),
): string[] {
  const used = new Map<string, number>()
  return docNames.map((name) => {
    const stem = exportFileName(name, format, date)
    const n = used.get(stem) ?? 1
    used.set(stem, n + 1)
    return n === 1 ? stem : stem.replace(/(\.(?:md|json))$/, `-${n}$1`)
  })
}

/** 多文档合并导出的最小文档形状 */
export interface ExportableDoc {
  name: string
  text: string
  annotations: Annotation[]
  revised?: string
}

/** 多文档合并导出：每份文档一节，节首强制「文件：{name}」（合并输出里文件信息
 * 是区分出处的唯一线索，不随开关关闭），节间以水平线分隔。 */
export function exportCombined(
  format: ExportFormat,
  docs: ExportableDoc[],
  opts: ExportOptions = {},
): string {
  return docs
    .map((d) =>
      exportAs(format, d.text, d.annotations, {
        ...opts,
        fileName: d.name,
        revisedText: d.revised,
      }),
    )
    .join('\n\n---\n\n')
}
