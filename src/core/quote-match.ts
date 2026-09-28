/** 引文锚定匹配：多策略候选 + 加权评分 + 按引文长度分级的置信度门控。纯函数。
 *
 * 候选搜索与评分移植自 Hypothesis 客户端的生产锚定（hypothesis/client
 * `anchoring/match-quote.ts`，MIT）：approx-string-match 容错搜索（快速精确
 * 命中优先，否则允许 quote.length/2 次编辑），候选按引文相似度 50 / 前后文
 * 各 20 / 位置提示 2 加权归一。
 *
 * 与 Hypothesis 的差异（本应用刻意为之）：Hypothesis 永远返回最优候选，
 * 而「失锚」在这里是刻意的用户语义——短引文（如单字「调」）几乎处处可命中，
 * 上下文已变时宁可判失锚也不接受可疑锚点。门控按引文长度分级：
 * ≤2 字上下文必须全部吻合（0.95）；3–7 字至少近似一侧吻合（0.70，
 * 全文改写后引文唯一存活靠位置提示权重拉回）；≥8 字引文自证（0.55，
 * 模糊候选凭相似度与上下文竞争同一阈值）。
 * 期望上下文为空串表示「引文原来就在边界」，匹配点邻文非空即失配。
 */

import approxSearch from 'approx-string-match'
import type { Match as StringMatch } from 'approx-string-match'

export interface TextQuote {
  exact: string
  prefix?: string
  suffix?: string
}

export interface QuoteAnchor {
  start: number
  end: number
  /** 归一化匹配分 0..1（Hypothesis 加权） */
  score: number
  /** 引文相似度 1 - errors/len（fuzzy 候选 < 1） */
  similarity: number
  /** exact = 引文逐字命中；fuzzy = 引文被小改后按编辑距离回锚 */
  via: 'exact' | 'fuzzy'
}

const WEIGHT = {quote: 50, prefix: 20, suffix: 20, pos: 2} as const
const MAX_SCORE = WEIGHT.quote + WEIGHT.prefix + WEIGHT.suffix + WEIGHT.pos
const MAX_ERRORS_CAP = 256
/** 模糊回锚的最低相似度：Hypothesis 允许到 50% 编辑距离，但「失锚」在
 * 本应用是用户语义——相似度不足（引文丢字超过 15%）视为已被改掉，
 * 走 diff 钳制标失锚 */
const FUZZY_MIN_SIMILARITY = 0.85

/** 置信度门控阈值（按引文长度分级，见模块注释） */
function minScore(quoteLen: number): number {
  if (quoteLen <= 2) return 0.95
  if (quoteLen <= 7) return 0.7
  return 0.55
}

/** 锚定一条引文：候选搜索 → 加权评分择优 → 门控。无可信锚点返回 null。
 * 位置提示只作为评分信号（靠近旧位置加分），不构成「旧偏移处文本未变即锚定」
 * 的快速通道——否则单字引文在原位被局部改写（调→调节）时会绕过门控错锚。 */
export function anchorQuote(
  text: string,
  quote: TextQuote,
  hint?: {start?: number; end?: number},
): QuoteAnchor | null {
  if (quote.exact === '') return null
  const prefix = quote.prefix ?? ''
  const suffix = quote.suffix ?? ''

  // 候选搜索：有精确命中就只用精确候选（同 Hypothesis），否则容错搜索
  const maxErrors = Math.min(MAX_ERRORS_CAP, Math.floor(quote.exact.length / 2))
  const candidates = searchCandidates(text, quote.exact, maxErrors)
  let best: QuoteAnchor | null = null
  let bestScore = -1
  for (const m of candidates) {
    // 期望上下文为空串 = 「引文原来在文档边界」：匹配点不在边界即失配
    // （否则零长切片恒等于期望，调→调节 这类「文末引文后长了字」的场景漏判）
    const prefixScore =
      prefix === ''
        ? m.start === 0
          ? 1
          : 0
        : contextScore(text.slice(Math.max(0, m.start - prefix.length), m.start), prefix)
    const suffixScore =
      suffix === ''
        ? m.end >= text.length
          ? 1
          : 0
        : contextScore(text.slice(m.end, m.end + suffix.length), suffix)
    const posScore =
      typeof hint?.start === 'number'
        ? Math.max(0, 1 - Math.abs(m.start - hint.start) / Math.max(text.length, 1))
        : 1
    const quoteScore = 1 - m.errors / quote.exact.length
    const score =
      (WEIGHT.quote * quoteScore +
        WEIGHT.prefix * prefixScore +
        WEIGHT.suffix * suffixScore +
        WEIGHT.pos * posScore) /
      MAX_SCORE
    if (score > bestScore) {
      bestScore = score
      best = {
        start: m.start,
        end: m.end,
        score,
        similarity: quoteScore,
        via: m.errors === 0 ? 'exact' : 'fuzzy',
      }
      if (m.errors === 0 && prefixScore === 1 && suffixScore === 1) break // 已满分，无需再扫
    }
  }
  if (!best) return null
  if (best.via === 'fuzzy' && best.similarity < FUZZY_MIN_SIMILARITY) return null
  // 门控：按引文长度分级；唯一精确命中是强证据（全文改写后引文唯一存活、
  // 原引文即全文而后文在其前后增内容的导入场景），放宽到 0.5——但短引文
  // （≤2 字）不放宽，区分度不足。
  const len = quote.exact.length
  const gate =
    candidates.length === 1 && best.via === 'exact' && len >= 3
      ? Math.min(minScore(len), 0.5)
      : minScore(len)
  return bestScore >= gate ? best : null
}

/** 快速精确搜索优先（全部命中）；无精确命中时按编辑距离容错搜索 */
function searchCandidates(text: string, pattern: string, maxErrors: number): StringMatch[] {
  const exact: StringMatch[] = []
  let at = text.indexOf(pattern)
  while (at !== -1) {
    exact.push({start: at, end: at + pattern.length, errors: 0})
    at = text.indexOf(pattern, at + 1)
  }
  if (exact.length > 0) return exact
  return maxErrors > 0 ? approxSearch(text, pattern, maxErrors) : []
}

/** 期望上下文与实际邻文的相似度。期望为空 = 「原来在边界」：实际邻文非空即失配。 */
function contextScore(actual: string, expected: string): number {
  if (expected === '') return actual === '' ? 1 : 0
  if (actual === '') return 0
  const matches = searchCandidates(actual, expected, expected.length)
  return matches.length === 0 ? 0 : 1 - matches[0]!.errors / expected.length
}
