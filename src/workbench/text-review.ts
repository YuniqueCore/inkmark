import {BAND_LABEL} from './slop-summary'
import {appendSample, hitsToAnnotations, scanSlopReport} from '../core/slop'
import {reanchorAnnotations} from '../core/reanchor'
import {normalizeLineEndings, restoreLineEndings} from '../core/text'
import type {DocItem, SlopLexicon, SlopReport} from '../core/types'
import type {Presentation, SelectionPresentation, AnnotationEditor, SearchPresentation} from './presentation'
import type {WorkspaceMode} from './shell-state'
import type {ConfirmOptions} from '../ui/confirm'
import zhLexicon from '../../skill/references/anti-slop-kit/scripts/data/zh.json'
import enLexicon from '../../skill/references/anti-slop-kit/scripts/data/en.json'

interface TextReviewBindings {
  mode: WorkspaceMode
  active(): DocItem | undefined
  canLeave(): boolean
  search: SearchPresentation
  annotation: AnnotationEditor
  selection: SelectionPresentation
  presentation: Pick<Presentation, 'sourceEditor' | 'text'>
  render(): void
  confirm(options: ConfirmOptions): Promise<boolean>
  textError(text: string): string | null
  reports: Map<string, SlopReport>
  mutate(update: (doc: DocItem) => DocItem): void
  notify(message: string): void
}

export function createTextReview(ctx: TextReviewBindings) {
const LEXICONS = [zhLexicon, enLexicon] as unknown as SlopLexicon[]
// ---------------------------------------------------------------- slop 预扫描

function runSlopScan(): void {
  if (!ctx.canLeave()) return
  const doc = ctx.active()
  if (!doc || doc.text.trim() === '') {
    ctx.notify('先导入或载入一段文本')
    return
  }
  const existing = new Set(
    doc.annotations.filter((a) => a.source === 'slop').map((a) => `${a.start}:${a.end}`),
  )
  const report = scanSlopReport(doc.text, LEXICONS)
  ctx.reports.set(doc.id, report)
  const hits = report.hits.filter((h) => !existing.has(`${h.start}:${h.end}`))
  const anns = hitsToAnnotations(hits)
  // 评分历史随文档持久化（appendSample 处理去重与封顶）
  const history = appendSample(doc.slopHistory ?? [], {
    at: Date.now(),
    score: report.score,
    band: report.band,
    units: report.units,
  })
  ctx.mutate((d) => ({ ...d, annotations: [...d.annotations, ...anns], slopHistory: history }))
  const parts = [`评分 ${report.score}/千单位（${BAND_LABEL[report.band]}）`]
  parts.push(anns.length === 0 ? '没有新的候选信号' : `新增 ${anns.length} 条候选批注`)
  ctx.notify(parts.join('，'))
}

/** 分档中文名（评分 toast 用） */


// ---------------------------------------------------------------- 编辑原文（重锚）

function toggleEdit(): void {
  const doc = ctx.active()
  if (!doc) {
    ctx.notify('先导入或载入一段文本')
    return
  }
  if (ctx.mode === 'edit') return
  if (!ctx.canLeave()) return
  if (ctx.search.isOpen()) ctx.search.close()
  ctx.annotation.close()
  ctx.selection.dismiss()
  ctx.presentation.sourceEditor.open(normalizeLineEndings(doc.text), {
    onSave: saveTextEdit,
    onCancel: () => {
      ctx.mode = 'annotate'
      ctx.render()
    },
  })
  ctx.mode = 'edit'
  ctx.render()
}

async function saveTextEdit(newText: string): Promise<void> {
  const doc = ctx.active()
  if (!doc) return
  newText = normalizeLineEndings(newText)
  if (newText === normalizeLineEndings(doc.text)) {
    ctx.mode = 'annotate'
    ctx.render()
    return
  }
  if (newText.trim() === '') {
    ctx.notify('文本不能为空') // 留在编辑态改正
    return
  }
  // 预演重锚；仅在保存实际变更时处理失锚和草稿，取消编辑不影响草稿。
  const restored = restoreLineEndings(newText, doc.text)
  const preview = reanchorAnnotations(doc.text, restored.text, doc.annotations)
  const docIds = new Set([doc.id])
  const hasDrafts = ctx.selection.hasDrafts(docIds, 'a')
  if (preview.clamped > 0 || hasDrafts || restored.mixed) {
    const details = [
      ...(preview.clamped > 0 ? [`有 ${preview.clamped} 条批注的引文被改掉，保存后将失锚（把原文改回来会自动恢复）。`] : []),
      ...(hasDrafts ? ['保存会放弃此原文上未提交的划词草稿；取消后可重新选中取回。'] : []),
      ...(restored.mixed ? ['原文混用了不同换行格式；保存后换行将统一为 LF。'] : []),
    ]
    const ok = await ctx.confirm({
      title: '保存编辑？',
      description: details.join(' '),
      confirmText: '保存',
      danger: true,
    })
    if (!ok) return
    if (ctx.mode !== 'edit' || ctx.active() !== doc || normalizeLineEndings(ctx.presentation.sourceEditor.value() ?? '') !== newText) {
      ctx.notify('工作区在操作期间发生变化，请重试')
      return
    }
    if (hasDrafts) ctx.selection.discardDrafts(docIds, 'a')
  }
  applyTextEdit(restored.text, preview)
}

function applyTextEdit(
  newText: string,
  preview: ReturnType<typeof reanchorAnnotations>,
): void {
  ctx.mode = 'annotate'
  ctx.reports.delete(ctx.active()?.id ?? '') // 文本已变，上一次评分失效
  ctx.mutate((d) => ({ ...d, text: newText, annotations: preview.annotations }))
  const parts = ['已保存编辑']
  if (preview.moved > 0) parts.push(`${preview.moved} 条批注重新锚定`)
  if (preview.clamped > 0) parts.push(`${preview.clamped} 条失锚（标记在改动处）`)
  ctx.notify(parts.join('，'))
}

// ---------------------------------------------------------------- 对照视图（原文 vs AI 改稿）

function toggleDiff(): void {
  const doc = ctx.active()
  if (!doc) {
    ctx.notify('先导入或载入一段文本')
    return
  }
  if (ctx.mode === 'edit') {
    ctx.notify('先完成或取消原文编辑')
    return
  }
  if (!ctx.canLeave()) return
  if (ctx.mode === 'diff') {
    ctx.mode = 'annotate'
    ctx.render()
    return
  }
  if (!doc.revised) {
    ctx.presentation.text({
      title: `贴入「${doc.name}」的 AI 改稿`,
      description: '粘贴 AI 改写后的全文，生成原文 vs 改稿的行级对照。两侧都可以划选写批注。',
      placeholder: '把 AI 改稿的完整文本粘贴到这里…',
      confirmText: '生成对照',
      validate: value => ctx.active() !== doc
        ? '原文档已发生变化。输入已保留，请先复制内容，再取消并重新打开对照。'
        : ctx.textError(value),
      onSubmit: text => {
        ctx.mode = 'diff'
        ctx.mutate((d) => ({ ...d, revised: text }))
      },
    })
    return
  }
  ctx.mode = 'diff'
  ctx.render()
}

async function clearRevised(): Promise<void> {
  const doc = ctx.active()
  if (!doc?.revised) return
  const revisedCount = doc.annotations.filter((a) => a.target === 'revised').length
  const docIds = new Set([doc.id])
  const draftNote = ctx.selection.hasDrafts(docIds, 'b') ? ' 未提交的改稿划词草稿也会被放弃。' : ''
  const ok = await ctx.confirm({
    title: '清除 AI 改稿？',
    description:
      revisedCount > 0
        ? `改稿上的 ${revisedCount} 条批注会一并删除；原文和原文批注保留。${draftNote}`
        : `只移除改稿文本与对照视图，文档原文和批注都会保留。${draftNote}`,
    confirmText: '清除',
    danger: true,
  })
  if (!ok) return
  if (ctx.active() !== doc) {
    ctx.notify('工作区在操作期间发生变化，请重试')
    return
  }
  ctx.selection.discardDrafts(docIds, 'b')
  ctx.mode = 'annotate'
  ctx.mutate((d) => ({
    ...d,
    revised: undefined,
    annotations: d.annotations.filter((a) => a.target !== 'revised'),
  }))
  ctx.notify('已清除改稿')
}

// ---------------------------------------------------------------- 导入

return {runSlopScan, toggleEdit, toggleDiff, clearRevised}
}
