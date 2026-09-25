/** 领域类型。核心模块（core/）不允许依赖 DOM —— 全部可独立测试。 */

/** 批注类型：问题、建议、疑问、重点、认可（写得好 + 原因）、slop 预扫描 */
export type AnnotationKind = 'issue' | 'suggestion' | 'question' | 'highlight' | 'praise' | 'slop'

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
}

/** 工作区会话 v2：多文档。localStorage 持久化单元 */
export interface Workspace {
  version: 2
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
