/** 领域类型。核心模块（core/）不允许依赖 DOM —— 全部可独立测试。 */

/** 批注类型：问题（AI slop / 错误）、建议、疑问、重点、slop 预扫描 */
export type AnnotationKind = 'issue' | 'suggestion' | 'question' | 'highlight' | 'slop'

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
  meta?: SlopMeta
}

/** 工作台会话（localStorage 持久化单元） */
export interface Session {
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
  /** plain 每次命中都报；cluster 同段 ≥2 个同类词条才报；density 全文 ≥N 次才报 */
  mode?: 'plain' | 'cluster' | 'density'
  cluster_min?: number
  density_min?: number
  fix?: string
  note?: string
}

export interface SlopHit {
  start: number
  end: number
  matched: string
  categoryId: string
  label: string
  fix?: string
  note?: string
}
