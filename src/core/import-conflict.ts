/** 导入冲突判定与导入计划：纯函数，无 DOM。
 *
 * 边界（用户定稿）：冲突键 = 相对路径 + 文件名（与 DocItem 的 path/name 对齐，
 * 单文件导入 path 为 ''，与文件夹根层文件天然可比）；覆盖 = 保留批注并重锚到
 * 新文本（编辑原文同款管线）；同名同文标「无变化」固定跳过；重命名插扩展名前
 * 递增（report-1.txt）避开工作区与本次导入的其余落点。
 *
 * 计划模型：每份新文件一行、行动唯一 —— direct 直接进 / rename 改名进 /
 * overwrite 覆盖重锚 / skip 跳过 / identical 无变化跳过。
 * 诊断树（ui/import-conflict-dialog.ts）只改行动，main 据最终行动落盘。
 */

import type { DocItem } from './types'

export type ImportAction = 'direct' | 'rename' | 'overwrite' | 'skip' | 'identical'

/** 诊断树批量预设：把匹配行的行动设为覆盖（identical 永不触碰，其余行不动） */
export type ConflictPreset = 'overwrite-all' | 'overwrite-unannotated' | 'overwrite-annotated'

export interface IncomingDoc {
  name: string
  path: string
  text: string
}

export interface ImportRow {
  incoming: IncomingDoc
  action: ImportAction
  /** 冲突的现有文档（direct 行为空） */
  existing?: DocItem
  /** rename 行的目标文件名（插扩展名前递增到空闲） */
  renameTo?: string
}

export interface ImportPlan {
  rows: ImportRow[]
  /** 存在同名且内容不同的冲突（identical 不算）——决定是否弹诊断树 */
  hasConflicts: boolean
  /** 同名同文被标「无变化」的行数（toast 提示用） */
  identicalCount: number
}

/** 冲突键：相对路径 + 文件名（根层文件与单文件导入共用 '' 路径空间） */
export function conflictKey(d: {name: string; path: string}): string {
  return d.path === '' ? d.name : `${d.path}/${d.name}`
}

/** 初次判定：无同名 → direct；同名同文 → identical；同名异文 → rename（默认动作） */
export function buildImportPlan(incoming: IncomingDoc[], existing: DocItem[]): ImportPlan {
  const byKey = new Map(existing.map((d) => [conflictKey(d), d]))
  const rows = incoming.map((inc): ImportRow => {
    const hit = byKey.get(conflictKey(inc))
    if (!hit) return {incoming: inc, action: 'direct'}
    if (hit.text === inc.text) return {incoming: inc, action: 'identical', existing: hit}
    return {incoming: inc, action: 'rename', existing: hit}
  })
  return finalize(rows, existing)
}

/** 诊断树逐行改行动（仅覆盖 / 重命名 / 跳过三选一），重排重命名落点后返回新行集 */
export function setRowAction(rows: ImportRow[], existing: DocItem[], index: number, action: ImportAction): ImportRow[] {
  return finalize(
    rows.map((r, i) => (i === index ? {...r, action, renameTo: undefined} : r)),
    existing,
  ).rows
}

/** 批量预设：匹配行（有冲突、非 identical、按批注有无筛选）统一设为覆盖 */
export function applyPreset(rows: ImportRow[], existing: DocItem[], preset: ConflictPreset): ImportRow[] {
  return finalize(
    rows.map((r) => {
      if (!r.existing || r.action === 'identical') return r
      const annotated = r.existing.annotations.length > 0
      const hit =
        preset === 'overwrite-all' || (preset === 'overwrite-annotated' ? annotated : !annotated)
      return hit ? {...r, action: 'overwrite' as const, renameTo: undefined} : r
    }),
    existing,
  ).rows
}

/** 行动定稿：重命名目标按行序分配，避开现有文档与其余行的落点 */
function finalize(rows: ImportRow[], existing: DocItem[]): ImportPlan {
  const taken = new Set<string>()
  existing.forEach((d) => taken.add(conflictKey(d)))
  rows.forEach((r) => {
    if (r.action !== 'rename') taken.add(conflictKey(r.incoming))
  })
  const out = rows.map((r): ImportRow => {
    if (r.action !== 'rename') return r
    const renameTo = renameTarget(r.incoming.name, r.incoming.path, taken)
    taken.add(conflictKey({name: renameTo, path: r.incoming.path}))
    return {...r, renameTo}
  })
  return {
    rows: out,
    hasConflicts: out.some((r) => r.action === 'rename' || r.action === 'overwrite' || r.action === 'skip'),
    identicalCount: out.filter((r) => r.action === 'identical').length,
  }
}

/** report.txt → report-1.txt → report-2.txt …（无扩展名 / 隐藏文件整体当词干） */
function renameTarget(name: string, path: string, taken: Set<string>): string {
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let i = 1; ; i++) {
    const candidate = `${stem}-${i}${ext}`
    if (!taken.has(conflictKey({name: candidate, path}))) return candidate
  }
}
