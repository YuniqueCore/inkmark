import {reportCategoryCounts} from '../core/slop'
import type {SlopBand, SlopReport, SlopSample} from '../core/types'

export const BAND_LABEL: Record<SlopBand, string> = {clean: '干净', light: '轻微', noticeable: '明显', heavy: '严重'}

/** Summary shared by renderers; candidate ranges remain with the document. */
export function summarizeSlop(report: SlopReport, history: SlopSample[]) {
  const previous = history[history.length - 2]
  return {score: report.score, units: report.units, band: BAND_LABEL[report.band], candidates: report.hits.length,
    categories: reportCategoryCounts(report.hits), history: history.map(sample => sample.score),
    delta: previous ? +(report.score - previous.score).toFixed(1) : null}
}
