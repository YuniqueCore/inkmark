/** 领域类型。核心模块（core/）不允许依赖 DOM —— 全部可独立测试。 */

/** 批注类型：问题、建议、疑问、重点、认可（写得好 + 原因）、slop 预扫描 */
export type AnnotationKind = 'issue' | 'suggestion' | 'question' | 'highlight' | 'praise' | 'slop'

/** 各批注类型的快捷批注语：撰写卡与编辑弹层的可点选 chips（与 KIND_LABEL 同源）。
 * 点击 = 切换（已含则移除，否则以「；」追加），支持组合多条。 */
export const QUICK_PHRASES: Record<AnnotationKind, readonly string[]> = {
  issue: ['表述含糊，建议给出明确结论', '逻辑跳跃，缺少过渡', '论点缺少依据', '与上下文重复', '因果关系不成立'],
  suggestion: ['建议直接给结论', '建议拆分长句', '建议补充示例', '建议删减铺垫', '建议换更具体的表述'],
  question: ['依据是什么？', '是否与上文重复？', '指代对象不明确', '这个结论必然成立吗？'],
  highlight: ['核心论点', '关键数据', '值得展开', '需要记住'],
  praise: ['论证有力', '表达清晰', '结构严谨', '例证恰当', '有启发性'],
  slop: ['用词过于华丽', '辞藻过于丰富', '句式空洞', '省略过多，语义不完整', '语句结构有问题', '套话空话'],
}

const PHRASE_SEP = '；'

/** 批注语里是否已含该快捷短语（chips 的 on 态） */
export function hasQuickPhrase(comment: string, phrase: string): boolean {
  return comment.split(PHRASE_SEP).some((p) => p.trim() === phrase)
}

/** 切换快捷短语：已含则移除，否则追加到末尾。纯函数。 */
export function toggleQuickPhrase(comment: string, phrase: string): string {
  const parts = comment
    .split(PHRASE_SEP)
    .map((p) => p.trim())
    .filter(Boolean)
  const i = parts.indexOf(phrase)
  if (i >= 0) parts.splice(i, 1)
  else parts.push(phrase)
  return parts.join(PHRASE_SEP)
}

/** 各批注类型的规范中文标签。导出（core）与 UI 共用的单一来源 */
export const KIND_LABEL: Record<AnnotationKind, string> = {
  issue: '问题',
  suggestion: '建议',
  question: '疑问',
  highlight: '重点',
  praise: '认可',
  slop: 'AI 味',
}

export type AnnotationStatus = 'open' | 'resolved'

export interface Annotation {
  id: string
  /** 规范文本中的字符偏移：[start, end) */
  start: number
  end: number
  kind: AnnotationKind
  comment: string
  status: AnnotationStatus
  /** manual = 人工划词；slop = 词库预扫描 */
  source: 'manual' | 'slop'
  /** 锚定侧：缺省 = 原文；'revised' = AI 改稿（对照视图的新增行，偏移相对 doc.revised） */
  target?: 'revised'
  /** slop 命中的词库元数据 */
  meta?: SlopMeta
  /** 失锚标记：原文编辑后引文已不在原文中，批注被钳到改动处（重锚成功时清除） */
  anchorLost?: true
  createdAt: number
  updatedAt: number
}

export interface SlopMeta {
  categoryId: string
  label: string
  matched: string
  fix?: string
  note?: string
}

export interface AnnotationInput {
  start: number
  end: number
  kind: AnnotationKind
  comment: string
  source?: 'manual' | 'slop'
  /** 缺省锚定原文；'revised' = 对照视图改稿侧 */
  target?: 'revised'
  meta?: SlopMeta
}

/** 工作区文档：一个可批注的文本单元 */
export interface DocItem {
  id: string
  name: string
  /** 相对路径（文件夹导入时含目录层级），单文件导入为 '' */
  path: string
  text: string
  annotations: Annotation[]
  addedAt: number
  /** AI 改稿全文（对照视图）：存在时可在「原文 vs 改稿」diff 视图里复核批注 */
  revised?: string
  /** slop 评分历史（每次扫描追加，保留最近 20 个采样点），侧栏趋势用 */
  slopHistory?: SlopSample[]
}

/** slop 评分历史采样点：同文档跨次扫描的趋势数据 */
export interface SlopSample {
  at: number
  score: number
  band: SlopBand
  units: number
}

/** 工作区会话格式版本：构造与运行时校验共用此常量 */
export const SESSION_VERSION = 2 as const

/** 工作区会话 v2：多文档。localStorage 持久化单元 */
export interface Workspace {
  version: typeof SESSION_VERSION
  docs: DocItem[]
  activeDocId: string
  savedAt: number
}

/** v1 旧会话（单文档），迁移用 */
export interface SessionV1 {
  version: 1
  text: string
  annotations: Annotation[]
  savedAt: number
}

// ---------------------------------------------------------------- slop 词库

/** 与 anti-slop-kit scripts/data/*.json 同构的最小词库 schema */
export interface SlopLexicon {
  meta: { lang: string; version: string }
  categories: SlopCategory[]
}

export interface SlopCategory {
  id: string
  label: string
  entries: SlopEntry[]
}

export interface SlopEntry {
  /** 正则源码 */
  p: string
  /** python re flag 名（IGNORECASE / MULTILINE / DOTALL），与 slop_check.py 同源 */
  flags?: string[]
  /** plain 每次命中都报；cluster 同段 ≥2 个同类词条才报；density 全文 ≥N 次才报 */
  mode?: 'plain' | 'cluster' | 'density'
  cluster_min?: number
  density_min?: number
  /** 权重与计分（对齐 slop_check.py）：w 缺省 0，cluster_w/density_w 缺省 = w */
  w?: number
  cluster_w?: number
  density_w?: number
  /** false = 仅清晰度建议，不计入评分（缺省 true） */
  evidence?: boolean
  fix?: string
  note?: string
}

export interface SlopHit {
  start: number
  end: number
  matched: string
  categoryId: string
  label: string
  /** 达标后计的权重（plain=w；cluster=cluster_w；density=density_w） */
  weight?: number
  /** false = 仅清晰度建议，不计入评分 */
  evidence?: boolean
  fix?: string
  note?: string
}

/** 评分分档（对齐 slop_check.py SCORE_BANDS） */
export type SlopBand = 'clean' | 'light' | 'noticeable' | 'heavy'

export interface SlopReport {
  hits: SlopHit[]
  /** 评分单位：CJK 字符 + 拉丁词 */
  units: number
  /** 证据权重合计 / 千单位，保留 1 位小数 */
  score: number
  band: SlopBand
}
