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

/** 匹配方式（VSCode 搜索的 Aa / .* 两个开关） */
export interface MatchOptions {
  /** 区分大小写（缺省不区分） */
  caseSensitive?: boolean
  /** 把查询当正则解析（缺省按字面匹配） */
  regex?: boolean
}

/** .* 模式下查询是否为有效正则；无效返回错误信息（面板描红提示），有效返回 null */
export function regexIssue(query: string): string | null {
  try {
    new RegExp(query.trim(), 'u')
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

/** 正文里 query 的全部出现位置：非重叠、按出现顺序。
 * 缺省大小写不敏感、正则元字符按字面匹配；MatchOptions 切换 Aa / .*。
 * 空白查询与无效正则返回 []；正则模式的零长命中跳过（批注区间必须非空）。 */
export function findMatches(text: string, query: string, options: MatchOptions = {}): MatchRange[] {
  const q = query.trim()
  if (q === '') return []
  const source = options.regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let re: RegExp
  try {
    re = new RegExp(source, `g${options.caseSensitive ? '' : 'i'}u`)
  } catch {
    return [] // 无效正则：无命中（面板经 regexIssue 描红提示）
  }
  return [...text.matchAll(re)]
    .filter((m) => m[0]!.length > 0)
    .map((m) => ({
      start: m.index!,
      end: m.index! + m[0]!.length,
    }))
}

/** 由匹配区间构造一批共享 groupId 的批注（comment / kind / replacement 全组一致）。 */
export function buildBatchAnnotations(
  matches: MatchRange[],
  input: { kind: AnnotationKind; comment: string; replacement?: string },
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
    ...(input.replacement ? { replacement: input.replacement } : {}),
    createdAt: now,
    updatedAt: now,
  }))
}
