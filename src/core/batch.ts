/** 搜索批量批注：正文查找 + 批量批注构造。纯函数，无 DOM。

 * 模型：一次批量批注产生 N 条共享 groupId 的一阶批注——每条仍是独立的
 * [start,end)，编辑器高亮、三种导出、W3C、重锚全部按单条批注工作，
 * 分组只是侧栏的展示聚合（派生状态，不复制可变状态）。
 */

import type { Annotation, AnnotationKind } from './types'

export interface MatchRange {
  start: number
  end: number
}

/** 正文里 query 的全部出现位置：非重叠、按出现顺序。
 * 拉丁字母大小写不敏感；query 为空白返回 []；正则元字符按字面匹配。 */
export function findMatches(text: string, query: string): MatchRange[] {
  const q = query.trim()
  if (q === '') return []
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(escaped, 'giu')
  re.lastIndex = 0
  return [...text.matchAll(re)].map((m) => ({
    start: m.index!,
    end: m.index! + m[0]!.length,
  }))
}

/** 由匹配区间构造一批共享 groupId 的批注（comment / kind 全组一致）。 */
export function buildBatchAnnotations(
  matches: MatchRange[],
  input: { kind: AnnotationKind; comment: string },
  now = Date.now(),
): Annotation[] {
  if (matches.length === 0) return []
  const groupId = `batch-${now}`
  return matches.map((m, i) => ({
    id: `${groupId}-${i}`,
    start: m.start,
    end: m.end,
    kind: input.kind,
    comment: input.comment,
    status: 'open' as const,
    source: 'manual' as const,
    groupId,
    createdAt: now,
    updatedAt: now,
  }))
}
