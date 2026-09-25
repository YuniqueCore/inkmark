import { describe, expect, it } from 'vitest'
import { scanSlopReport } from '../src/core/slop'
import type { SlopLexicon } from '../src/core/types'

const lex = (entries: SlopLexicon['categories']): SlopLexicon => ({
  meta: { lang: 'zh', version: 't' },
  categories: entries,
})

describe('scanSlopReport 评分分档（对齐 slop_check.py）', () => {
  it('score = 证据权重合计 / 千单位；band 分档正确', () => {
    const packs = lex([
      { id: 'a', label: 'A', entries: [{ p: '众所周知', w: 3 }] },
    ])
    // 文本：触发词 4 个 CJK + 文言文 3 个 = 7 单位（句号不算 CJK 汉字）
    const text = '众所周知文言文。' // 7 个 CJK
    const r = scanSlopReport(text, [packs])
    expect(r.units).toBe(7)
    expect(r.hits).toHaveLength(1)
    expect(r.hits[0]!.weight).toBe(3)
    expect(r.score).toBe(Math.round((3 * 1000) / 7 * 10) / 10)
    expect(r.band).toBe('heavy') // ≈428.6 > 5
  })

  it('干净文本 clean', () => {
    const packs = lex([{ id: 'a', label: 'A', entries: [{ p: '众所周知', w: 5 }] }])
    const r = scanSlopReport('这里什么都没有', [packs])
    expect(r.hits).toHaveLength(0)
    expect(r.score).toBe(0)
    expect(r.band).toBe('clean')
  })

  it('evidence: false 的命中计入 findings 但不计入评分', () => {
    const packs = lex([
      { id: 'a', label: 'A', entries: [{ p: '顺便说一句', w: 4, evidence: false }] },
    ])
    const r = scanSlopReport('顺便说一句而已', [packs])
    expect(r.hits).toHaveLength(1)
    expect(r.score).toBe(0)
    expect(r.band).toBe('clean')
  })

  it('cluster 升级后计 cluster_w，density 计 density_w（缺省回落 w）', () => {
    const packs = lex([
      {
        id: 'j',
        label: 'J',
        entries: [
          { p: '赋能', mode: 'cluster', cluster_min: 2, w: 1, cluster_w: 3 },
          { p: '抓手', mode: 'cluster', cluster_min: 2, w: 1, cluster_w: 3 },
          { p: '可能', mode: 'density', density_min: 2, w: 2 },
        ],
      },
    ])
    const r = scanSlopReport('赋能业务找抓手，可能行可能不行。', [packs])
    // cluster：赋能+抓手 是同段两个不同词条 → 各计 cluster_w=3
    const clusterHits = r.hits.filter((h) => h.matched === '赋能' || h.matched === '抓手')
    expect(clusterHits).toHaveLength(2)
    expect(clusterHits.every((h) => h.weight === 3)).toBe(true)
    // density：可能 ×2 ≥ 2 → 各计 density_w（缺省 = w = 2）
    const densityHits = r.hits.filter((h) => h.matched === '可能')
    expect(densityHits).toHaveLength(2)
    expect(densityHits.every((h) => h.weight === 2)).toBe(true)
  })

  it('拉丁词按词计数（score 单位与 slop_check 一致）', () => {
    const packs = lex([{ id: 'a', label: 'A', entries: [{ p: 'delve', w: 1 }] }])
    const r = scanSlopReport('please delve into the deep delve', [packs])
    expect(r.units).toBe(6) // please/delve/into/the/deep/delve = 6 个拉丁词
    expect(r.hits).toHaveLength(2)
    expect(r.score).toBe(Math.round((2 * 1000) / 6 * 10) / 10)
    expect(r.band).toBe('heavy')
  })

  it('band 边界：light < 2，noticeable < 5', () => {
    const mk = (w: number): SlopLexicon =>
      lex([{ id: 'a', label: 'A', entries: [{ p: '触发词', w }] }])
    // 触发词×1（w=1）在 600 个 CJK 单位 → score ≈ 1.7 → light
    const longText = '触发词' + '字'.repeat(598)
    expect(scanSlopReport(longText, [mk(1)]).band).toBe('light')
    // 同文本 w=2 → ≈3.3 → noticeable
    expect(scanSlopReport(longText, [mk(2)]).band).toBe('noticeable')
    // 同文本 w=3 → ≈5.0 → heavy（5.0 不小于 5）
    expect(scanSlopReport(longText, [mk(3)]).band).toBe('heavy')
  })
})
