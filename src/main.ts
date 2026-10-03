/** 应用装配：多文档工作区状态、事件接线、持久化。UI 模块各自只管画。 */

import { numberAnnotations } from './core/export'
import { diffLines, diffStats } from './core/diff'
import { importFileList, newDocId } from './core/import'
import type { W3CRouted } from './core/import'
import { reanchorAnnotations } from './core/reanchor'
import { buildBatchAnnotations, findMatches } from './core/batch'
import type { MatchOptions } from './core/batch'
import { buildImportPlan } from './core/import-conflict'
import { importConflictDialog } from './ui/import-conflict-dialog'
import { splitBlocks } from './core/text'
import { appendSample, hitsToAnnotations, scanSlopReport } from './core/slop'
import type { SlopReport } from './core/types'
import type { Annotation, AnnotationInput, DocItem, SlopLexicon } from './core/types'
import { EditorView } from './ui/editor'
import { ExporterView } from './ui/exporter'
import { FileTreeView } from './ui/filetree'
import { AnnotationPopup } from './ui/annotation-popup'
import { SelectionPin } from './ui/selection-pin'
import { SearchPanelView } from './ui/search-panel'
import { choiceDialog, confirmDialog, textDialog } from './ui/confirm'
import { TrashDialog } from './ui/trash-dialog'
import { wireHeaderMenu } from './ui/header-menu'
import { purgeExpired, purgeForever, restoreFromTrash, trashDocs, trashFromDoc } from './core/trash'
import type { TrashEntry } from './core/types'
import { flipPolarity } from './core/prefs'
import type { ReadingPrefs } from './core/prefs'
import { applyPrefs, loadPrefs, savePrefs } from './ui/prefs'
import { ReadingFab } from './ui/reading-fab'
import { settingsDialog } from './ui/settings-dialog'
import { SidebarView } from './ui/sidebar'
import { initResizers } from './ui/resizer'
import { icon } from './ui/icons'
import { initSaveStatus } from './ui/save-status'
import { toast } from './ui/toast'
import { rectOfAnnotation, resolveSelection } from './ui/selection-offsets'
import { SAMPLE_TEXT } from './ui/sample'
import { SESSION_VERSION } from './core/types'
import { loadWorkspace } from './ui/storage'
import zhLexicon from '../skill/references/anti-slop-kit/scripts/data/zh.json'
import enLexicon from '../skill/references/anti-slop-kit/scripts/data/en.json'

const LEXICONS = [zhLexicon, enLexicon] as unknown as SlopLexicon[]

// ---------------------------------------------------------------- 状态

interface AppState {
  docs: DocItem[]
  activeDocId: string
  /** 已删除批注与文档：7 天保留，过期清理；恢复 / 彻底删除走回收站弹层 */
  trash: TrashEntry[]
}

let state: AppState = { docs: [], activeDocId: '', trash: [] }
/** 筛选透镜：正文高亮与侧栏列表共用 */
let onlyHighlightFiltered = false
/** 应用模式：批注视图 / 对照视图 / 编辑原文——三者互斥，用联合类型让
 * 「边编辑边对照」这类非法组合无法表达（替代原 viewMode + editingText 布尔对） */
let mode: 'annotate' | 'diff' | 'edit' = 'annotate'
/** 各文档最近一次 slop 扫描报告（侧栏统计卡）：派生数据缓存，文本变化即失效 */
const slopReports = new Map<string, SlopReport>()

/** 阅读偏好（主题/纹理/字体/字号）：独立于工作区的第二状态域，改动即应用并持久化 */
let prefs: ReadingPrefs = loadPrefs()
const setPrefs = (next: ReadingPrefs): void => {
  prefs = next
  applyPrefs(prefs)
  savePrefs(prefs)
}

/** 编辑器实际渲染的批注：关闭"仅高亮筛选"时显示全部 */
function editorAnnotations(): Annotation[] {
  const doc = activeDoc()
  if (!doc) return []
  if (!onlyHighlightFiltered) return doc.annotations
  return sidebar.visibleOf(doc.annotations)
}

const activeDoc = (): DocItem | undefined => state.docs.find((d) => d.id === state.activeDocId)

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector(sel)
  if (!el) throw new Error(`missing element: ${sel}`)
  return el as T
}

const editorEl = $('#editor')
const sidebarEl = $('#sidebar')
const treeEl = $('#filetree')

// ---------------------------------------------------------------- 视图

const editor = new EditorView(editorEl, {
  onSelectionChange: (e) => {
    const doc = activeDoc()
    const info = doc ? resolveSelection(e, editorEl, doc) : null
    if (info) selectionPin.showFor(info)
    else selectionPin.dismiss()
  },
  onAnnotationClick: (id, rect) => {
    openAnnotationEditor(id, rect)
    sidebar.setActive(id)
    rerender(false)
  },
})

// ---------------------------------------------------------------- 批注命令

/** 删除批注 → 回收站（7 天保留，可恢复；彻底删除在回收站里二次确认）。
 * 选中含失锚批注时给出「标记为已解决」引导：失锚批注的批语仍然完整，
 * 归档比删除更有利于保留以往的标注。弹层与侧栏共用同一命令 */
const deleteAnnotation = (ids: string[]): void => {
  void (async () => {
    const doc = activeDoc()
    const picked = doc?.annotations.filter((a) => ids.includes(a.id)) ?? []
    const lostCount = picked.filter((a) => a.anchorLost === true).length
    const choice = await choiceDialog({
      title: ids.length > 1 ? `删除这 ${ids.length} 条批注？` : '删除这条批注？',
      description:
        '删除后进入回收站，保留 7 天，可随时恢复。' +
        (lostCount > 0
          ? `其中 ${lostCount} 条已失去锚点：批语仍然完整，建议改为「标记为已解决」归档，避免丢失以往的标注。`
          : ''),
      confirmText: '删除',
      danger: true,
      ...(lostCount > 0 ? { altText: `标记为已解决（${lostCount}）` } : {}),
    })
    if (choice === 'cancel') return
    if (choice === 'alt') {
      // 引导路径：不删除，把所选批注全部归档为已解决
      const altSet = new Set(ids)
      mutateActive((doc) => ({
        ...doc,
        annotations: doc.annotations.map((a) =>
          altSet.has(a.id) ? { ...a, status: 'resolved' as const, updatedAt: Date.now() } : a,
        ),
      }))
      toast(`已将 ${ids.length} 条批注标记为已解决`)
      return
    }
    if (!doc) return
    const idSet = new Set(ids)
    const { doc: nextDoc, trashed } = trashFromDoc(doc, idSet, Date.now())
    state = {
      ...state,
      docs: state.docs.map((d) => (d.id === doc.id ? nextDoc : d)),
      trash: [...state.trash, ...trashed],
    }
    rerender()
    toast(`已删除 ${ids.length} 条批注，可在回收站恢复`)
  })()
}

// ---------------------------------------------------------------- 回收站

const trashDialog = new TrashDialog({
  onRestore: (ids) => {
    const r = restoreFromTrash(state.trash, state.docs, new Set(ids))
    state = { ...state, trash: r.trash, docs: r.docs }
    rerender()
    toast(
      r.stranded > 0
        ? `已恢复 ${r.restored} 项；${r.stranded} 条批注原文档已删除，无法恢复`
        : `已恢复 ${r.restored} 项`,
    )
    trashDialog.update(state.trash, Date.now())
  },
  onPurge: (ids) => {
    void (async () => {
      const ok = await confirmDialog({
        title: ids.length > 1 ? `彻底删除这 ${ids.length} 项？` : '彻底删除这条批注？',
        description: '彻底删除后不可恢复。',
        confirmText: '彻底删除',
        danger: true,
      })
      if (!ok) return
      state = { ...state, trash: purgeForever(state.trash, new Set(ids)) }
      rerender()
      trashDialog.update(state.trash, Date.now())
      toast(`已彻底删除 ${ids.length} 项`)
    })()
  },
  onClearAll: () => {
    void (async () => {
      const ok = await confirmDialog({
        title: '清空回收站？',
        description: `将彻底删除回收站里的 ${state.trash.length} 条批注，不可恢复。`,
        confirmText: '清空',
        danger: true,
      })
      if (!ok) return
      state = { ...state, trash: [] }
      rerender()
      trashDialog.update([], Date.now())
      toast('回收站已清空')
    })()
  },
  onClose: () => trashDialog.close(),
})

/** 打开回收站：进入前顺手清一次过期条目（长会话期间 7 天窗口会自然过期） */
function openTrash(): void {
  const { keep, purged } = purgeExpired(state.trash, Date.now())
  if (purged.length > 0) state = { ...state, trash: keep }
  trashDialog.open(keep, Date.now())
  if (purged.length > 0) rerender()
}

/** 解决 / 重开批注（支持批量）：组内有未解决就全部解决，否则全部重开 */
const toggleAnnotationStatus = (ids: string[]): void => {
  const idSet = new Set(ids)
  const anyOpen = activeDoc()?.annotations.some((a) => idSet.has(a.id) && a.status === 'open') ?? false
  mutateActive((doc) => ({
    ...doc,
    annotations: doc.annotations.map((a) =>
      idSet.has(a.id) ? { ...a, status: anyOpen ? 'resolved' : 'open', updatedAt: Date.now() } : a,
    ),
  }))
  toast(anyOpen ? `已解决 ${ids.length} 条批注` : `已重开 ${ids.length} 条批注`)
}

/** 搜索批量批注在 ⌘F 面板（search-panel.ts）里完成：main 只接线 */

/** 打开批注编辑弹层：摘录与弹出内容按锚定侧取文本。
 * rect 缺省时从高亮元素实时查询（侧栏编辑入口；高亮可能刚被重渲染）。 */
const openAnnotationEditor = (id: string, rect?: DOMRect): void => {
  const doc = activeDoc()
  if (!doc) return
  const anchorRect = rect ?? rectOfAnnotation(editorEl, id)
  if (!anchorRect) return
  const ann = doc.annotations.find((a) => a.id === id)
  const text = ann?.target === 'revised' ? (doc.revised ?? doc.text) : doc.text
  annotationPopup.setAnchorRect(anchorRect)
  // 点击 / 编辑入口直接进入编辑态
  annotationPopup.openFor(id, text, doc.annotations, true)
}

const annotationPopup = new AnnotationPopup({
  onUpdate: (id, kind, comment, replacement) => {
    mutateActive((doc) => ({
      ...doc,
      annotations: doc.annotations.map((a) =>
        a.id === id
          ? {...a, kind, comment, replacement: replacement || undefined, updatedAt: Date.now()}
          : a,
      ),
    }))
  },
  onDelete: (id) => deleteAnnotation([id]),
  onToggleStatus: (id) => toggleAnnotationStatus([id]),
  onCopySnippet: (text) => {
    void navigator.clipboard.writeText(text).then(() => toast('已复制片段'))
  },
})

const selectionPin = new SelectionPin({
  onCreate: (info, kind, comment, replacement) => {
    addAnnotation({
      start: info.start,
      end: info.end,
      kind,
      comment,
      ...(info.side === 'b' ? { target: 'revised' as const } : {}),
      ...(replacement ? { replacement } : {}),
    })
  },
  onCopySelection: (quoted) => {
    void navigator.clipboard.writeText(quoted).then(() => toast('已复制选中文本'))
  },
  onDismiss: () => {
    sidebar.setActive(null)
  },
})

const sidebar = new SidebarView(sidebarEl, {
  onFocus: (id) => {
    if (isMobileViewport()) closeDrawers()
    const doc = activeDoc()
    // 改稿侧批注只在对照视图里有正文锚点：批注模式下定位时自动切过去
    // （编辑模式不打断，避免丢掉正在编辑的文本）
    const ann = doc?.annotations.find((a) => a.id === id)
    if (ann?.target === 'revised' && doc?.revised && mode === 'annotate') {
      mode = 'diff'
    }
    sidebar.setActive(id)
    rerender(false)
    editor.focusAnnotation(id)
  },
  onEdit: (a) => {
    if (isMobileViewport()) closeDrawers()
    editor.focusAnnotation(a.id)
    openAnnotationEditor(a.id)
    sidebar.setActive(a.id)
  },
  onDelete: deleteAnnotation,
  onToggleStatus: toggleAnnotationStatus,
  onFilterChange: (f) => {
    sidebar.setFilter(f)
    rerender(false)
  },
  onKindFilterChange: (kinds) => {
    sidebar.setKindFilter(kinds)
    rerender(false)
  },
  onHighlightModeChange: (only) => {
    onlyHighlightFiltered = only
    sidebar.setHighlightMode(only)
    rerender(false)
  },
  onNotify: (msg) => toast(msg),
})

const fileTree = new FileTreeView(treeEl, {
  onOpen: (id) => {
    if (isMobileViewport()) closeDrawers()
    switchDoc(id)
  },
  onRemove: (id) => void removeDoc(id),
  onExportDoc: (id) => {
    const doc = state.docs.find((d) => d.id === id)
    if (!doc) return
    if (doc.annotations.length === 0) {
      toast('该文档还没有批注')
      return
    }
    exporter.open([doc])
  },
  onBulkExport: (ids) => {
    const idSet = new Set(ids)
    const docs = state.docs.filter((d) => idSet.has(d.id) && d.annotations.length > 0)
    if (docs.length === 0) {
      toast('所选文档都没有批注')
      return
    }
    if (docs.length < ids.length) toast(`${ids.length - docs.length} 份没有批注的文档已跳过`)
    exporter.open(docs)
  },
  onBulkDelete: (ids) => void removeDocs(ids),
})

const exporter = new ExporterView($('#export-modal'), $('#overlay'), {
  onCopy: (content) => {
    void navigator.clipboard.writeText(content).then(() => toast('已复制到剪贴板'))
  },
  onClose: () => {},
  onImportW3C: (file) => void importW3CFile(file),
})

// ---------------------------------------------------------------- 工作区操作

function addAnnotation(input: AnnotationInput): void {
  const now = Date.now()
  const ann: Annotation = {
    id: `ann-${now}-${Math.random().toString(36).slice(2, 7)}`,
    status: 'open',
    source: 'manual',
    createdAt: now,
    updatedAt: now,
    ...input,
  }
  mutateActive((doc) => ({ ...doc, annotations: [...doc.annotations, ann] }))
  // 「只高亮当前筛选」开启时，新批注若被类型筛选排除会立刻"消失"——
  // 自动把它的类型纳入筛选，保证刚写的批注可见
  if (onlyHighlightFiltered) {
    sidebar.setKindFilter(sidebar.includeKind(input.kind))
  }
}

/** 当前文档的不可变更新；无文档时静默忽略 */
function mutateActive(fn: (doc: DocItem) => DocItem): void {
  const doc = activeDoc()
  if (!doc) return
  state = {
    ...state,
    docs: state.docs.map((d) => (d.id === doc.id ? fn(doc) : d)),
  }
  rerender()
}

function switchDoc(id: string): void {
  if (state.activeDocId === id) return
  state = { ...state, activeDocId: id }
  // 编辑的是旧文档的文本，切文档即放弃（原实现编辑器滞留旧文档内容）
  if (mode === 'edit') mode = 'annotate'
  selectionPin.dismiss()
  annotationPopup.close()
  rerender(false)
}

async function removeDoc(id: string): Promise<void> {
  const doc = state.docs.find((d) => d.id === id)
  if (!doc) return
  const count = doc.annotations.length
  const ok = await confirmDialog({
    title: `移除「${doc.name}」？`,
    description:
      count > 0
        ? `其中 ${count} 条批注会一并移入回收站，保留 7 天，可随时恢复。`
        : '移入回收站后保留 7 天，可随时恢复。',
    confirmText: '移除',
    danger: true,
  })
  if (!ok) return
  await removeDocsConfirmed([id])
  toast(`已移除 ${doc.name}，可在回收站恢复`)
}

/** 多选移除入口：先统一确认，再落盘 */
async function removeDocs(ids: string[]): Promise<void> {
  const docs = state.docs.filter((d) => ids.includes(d.id))
  if (docs.length === 0) return
  const count = docs.reduce((acc, d) => acc + d.annotations.length, 0)
  // 名称清单截断展示：多文档批量删除不把确认弹层撑成长清单（弹层本身另有滚动兜底）
  const shown = docs.slice(0, 3).map((d) => d.name).join('、')
  const names = docs.length > 3 ? `${shown} 等 ${docs.length} 份文档` : shown
  const ok = await confirmDialog({
    title: `移除 ${docs.length} 个文档？`,
    description: `${names}${count > 0 ? `（共 ${count} 条批注）` : ''}——移入回收站，保留 7 天，可随时恢复。`,
    confirmText: '移除',
    danger: true,
  })
  if (!ok) return
  await removeDocsConfirmed(ids)
  toast(`已移除 ${docs.length} 个文档`)
}

/** 已确认的删除落盘：文档整份入回收站、清运行时缓存、维护活动文档、重渲染 */
async function removeDocsConfirmed(ids: string[]): Promise<void> {
  const idSet = new Set(ids)
  state.docs.filter((d) => idSet.has(d.id)).forEach((d) => slopReports.delete(d.id))
  const { docs, trashed } = trashDocs(state.docs, idSet, Date.now())
  const activeRemoved = idSet.has(state.activeDocId)
  state = {
    docs,
    activeDocId: activeRemoved ? (docs[0]?.id ?? '') : state.activeDocId,
    trash: [...state.trash, ...trashed],
  }
  if (activeRemoved) {
    // 编辑的是被移除文档的文本，随文档一起终止（与 switchDoc 同规则）
    if (mode === 'edit') mode = 'annotate'
    annotationPopup.close()
    if (state.activeDocId === '') selectionPin.dismiss()
  }
  rerender(false)
}

// ---------------------------------------------------------------- 渲染

function rerender(syncPopup = true): void {
  const doc = activeDoc()
  // 模式归一：切到没有改稿的文档时对照模式无处落脚，回落批注视图
  if (mode === 'diff' && !doc?.revised) mode = 'annotate'
  // 顶栏按钮状态始终跟随模式（原实现在编辑分支提前 return，编辑按钮从不高亮）
  const diffBtn = document.querySelector('#btn-diff')
  const inDiff = mode === 'diff'
  diffBtn?.classList.toggle('bg-secondary', inDiff)
  diffBtn?.classList.toggle('text-secondary-foreground', inDiff)
  document.querySelector('#btn-diff-clear')?.classList.toggle('hidden', !inDiff)
  const editBtn = document.querySelector('#btn-edit')
  editBtn?.classList.toggle('bg-secondary', mode === 'edit')
  editBtn?.classList.toggle('text-secondary-foreground', mode === 'edit')
  if (mode === 'edit') {
    // 编辑模式由 renderEditMode 独占渲染区，这里只同步侧栏
    sidebar.render(doc?.text ?? '', doc?.annotations ?? [], {
      revised: doc?.revised,
      slopHistory: doc?.slopHistory ?? [],
    })
    fileTree.render(state.docs, state.activeDocId)
    return
  }
  let stats = ''
  if (inDiff) {
    const rows = diffLines(doc!.text, doc!.revised!)
    editor.renderDiff(rows, editorAnnotations())
    const { added, removed } = diffStats(rows)
    stats = `+${added} / −${removed}`
  } else {
    editor.render(
      doc?.text ?? '',
      editorAnnotations(),
      loadSample,
      searchPreview ? findMatches(doc?.text ?? '', searchPreview.query, searchPreview.match) : [],
    )
  }
  const diffStatsEl = document.querySelector('#diff-stats')
  if (diffStatsEl) {
    diffStatsEl.textContent = stats
    diffStatsEl.classList.toggle('hidden', !inDiff)
  }
  sidebar.render(doc?.text ?? '', doc?.annotations ?? [], {
    revised: doc?.revised,
    slop: doc ? (slopReports.get(doc.id) ?? null) : null,
    slopHistory: doc?.slopHistory ?? [],
  })
  fileTree.render(state.docs, state.activeDocId)
  searchPanel.setDocs(
    state.docs.map((d) => ({ id: d.id, name: d.name, text: d.text })),
    state.activeDocId,
  )
  if (syncPopup && doc) annotationPopup.sync(doc.text, doc.annotations, doc.revised)
  updateTrashBadge()
  save.markDirty()
}

// ---------------------------------------------------------------- 保存

/** 头部回收站徽标：条目数 >0 时显示（99+ 封顶） */
function updateTrashBadge(): void {
  const el = document.querySelector('#trash-count')
  if (!el) return
  const n = state.trash.length
  el.textContent = n > 99 ? '99+' : String(n)
  el.classList.toggle('hidden', n === 0)
}

// 数据快照即时取自工作区状态；状态机与计时器归 ui/save-status 所有
const save = initSaveStatus(() => ({
  version: SESSION_VERSION,
  docs: state.docs,
  activeDocId: state.activeDocId,
  trash: state.trash,
  savedAt: Date.now(),
}))

// ---------------------------------------------------------------- slop 预扫描

function runSlopScan(): void {
  const doc = activeDoc()
  if (!doc || doc.text.trim() === '') {
    toast('先导入或载入一段文本')
    return
  }
  const existing = new Set(
    doc.annotations.filter((a) => a.source === 'slop').map((a) => `${a.start}:${a.end}`),
  )
  const report = scanSlopReport(doc.text, LEXICONS)
  slopReports.set(doc.id, report)
  const hits = report.hits.filter((h) => !existing.has(`${h.start}:${h.end}`))
  const anns = hitsToAnnotations(hits)
  // 评分历史随文档持久化（appendSample 处理去重与封顶）
  const history = appendSample(doc.slopHistory ?? [], {
    at: Date.now(),
    score: report.score,
    band: report.band,
    units: report.units,
  })
  mutateActive((d) => ({ ...d, annotations: [...d.annotations, ...anns], slopHistory: history }))
  const parts = [`评分 ${report.score}/千单位（${BAND_LABEL[report.band]}）`]
  parts.push(anns.length === 0 ? '没有新的候选信号' : `新增 ${anns.length} 条候选批注`)
  toast(parts.join('，'))
}

/** 分档中文名（评分 toast 用） */
const BAND_LABEL: Record<string, string> = {
  clean: '干净',
  light: '轻微',
  noticeable: '明显',
  heavy: '严重',
}

// ---------------------------------------------------------------- 编辑原文（重锚）

function toggleEdit(): void {
  const doc = activeDoc()
  if (!doc) {
    toast('先导入或载入一段文本')
    return
  }
  if (mode === 'edit') return
  mode = 'edit'
  annotationPopup.close()
  selectionPin.dismiss()
  editor.renderEditMode(doc.text, {
    onSave: (newText) => saveTextEdit(newText),
    onCancel: () => {
      mode = 'annotate'
      rerender(false)
    },
  })
  rerender(false)
}

function saveTextEdit(newText: string): void {
  const doc = activeDoc()
  if (!doc) return
  if (newText === doc.text) {
    mode = 'annotate'
    rerender(false)
    return
  }
  if (newText.trim() === '') {
    toast('文本不能为空') // 留在编辑态改正
    return
  }
  // 预演重锚：只有「引文被改掉」的失锚才是真实损失，保存前让用户知情确认；
  // 单纯位移（moved）是保护行为，不打扰
  const preview = reanchorAnnotations(doc.text, newText, doc.annotations)
  if (preview.clamped > 0) {
    void (async () => {
      const ok = await confirmDialog({
        title: '保存编辑？',
        description: `有 ${preview.clamped} 条批注的引文被改掉，保存后将失锚（钉在改动处；把原文改回来会自动恢复）。`,
        confirmText: '保存',
        danger: true,
      })
      if (!ok) return
      applyTextEdit(newText, preview)
    })()
    return
  }
  applyTextEdit(newText, preview)
}

function applyTextEdit(
  newText: string,
  preview: ReturnType<typeof reanchorAnnotations>,
): void {
  mode = 'annotate'
  slopReports.delete(activeDoc()?.id ?? '') // 文本已变，上一次评分失效
  mutateActive((d) => ({ ...d, text: newText, annotations: preview.annotations }))
  const parts = ['已保存编辑']
  if (preview.moved > 0) parts.push(`${preview.moved} 条批注重新锚定`)
  if (preview.clamped > 0) parts.push(`${preview.clamped} 条失锚（标记在改动处）`)
  toast(parts.join('，'))
}

// ---------------------------------------------------------------- 对照视图（原文 vs AI 改稿）

async function toggleDiff(): Promise<void> {
  const doc = activeDoc()
  if (!doc) {
    toast('先导入或载入一段文本')
    return
  }
  if (mode === 'edit') {
    toast('先完成或取消原文编辑')
    return
  }
  if (mode === 'diff') {
    mode = 'annotate'
    rerender(false)
    return
  }
  if (!doc.revised) {
    const text = await textDialog({
      title: `贴入「${doc.name}」的 AI 改稿`,
      description: '粘贴 AI 改写后的全文，生成原文 vs 改稿的行级对照。两侧都可以划选写批注。',
      placeholder: '把 AI 改稿的完整文本粘贴到这里…',
      confirmText: '生成对照',
    })
    if (text === null) return
    if (text.trim() === '') {
      toast('改稿内容为空')
      return
    }
    mutateActive((d) => ({ ...d, revised: text }))
  }
  mode = 'diff'
  rerender(false)
}

async function clearRevised(): Promise<void> {
  const doc = activeDoc()
  if (!doc?.revised) return
  const revisedCount = doc.annotations.filter((a) => a.target === 'revised').length
  const ok = await confirmDialog({
    title: '清除 AI 改稿？',
    description:
      revisedCount > 0
        ? `改稿上的 ${revisedCount} 条批注会一并删除；原文和原文批注保留。`
        : '只移除改稿文本与对照视图，文档原文和批注都会保留。',
    confirmText: '清除',
    danger: true,
  })
  if (!ok) return
  mode = 'annotate'
  mutateActive((d) => ({
    ...d,
    revised: undefined,
    annotations: d.annotations.filter((a) => a.target !== 'revised'),
  }))
  toast('已清除改稿')
}

// ---------------------------------------------------------------- 导入

/** 文件导入编排：管线（分类/解析）在 core/import.ts，冲突判定在 core/import-conflict.ts，
 * 这里只做诊断弹出、状态应用与提示。工作区为空 → 直接导入；存在同名冲突 → 先弹
 * 诊断树（取消 = 整次导入作废，W3C/会话也一并作废），确认后一次性落盘。 */
async function importFiles(files: FileList | File[]): Promise<void> {
  const r = await importFileList(files, { docs: state.docs, currentDoc: activeDoc() })
  const plan = buildImportPlan(
    r.textDocs.map((d) => ({name: d.name, path: d.path, text: d.text})),
    state.docs,
  )
  let rows = plan.rows
  if (plan.hasConflicts) {
    const decided = await importConflictDialog(plan, state.docs)
    if (!decided) return
    rows = decided
  }

  // 落盘：direct/rename 建新文档；overwrite 覆盖文本并重锚已有批注（编辑原文同款管线）
  const now = Date.now()
  const fresh: DocItem[] = []
  const overwrites = new Map<string, {text: string; annotations: Annotation[]}>()
  let reanchored = 0
  let lost = 0
  for (const row of rows) {
    if (row.action === 'direct' || row.action === 'rename') {
      fresh.push({
        id: newDocId(),
        name: row.renameTo ?? row.incoming.name,
        path: row.incoming.path,
        text: row.incoming.text,
        annotations: [],
        addedAt: now,
      })
    } else if (row.action === 'overwrite' && row.existing) {
      const preview = reanchorAnnotations(row.existing.text, row.incoming.text, row.existing.annotations)
      overwrites.set(row.existing.id, {text: row.incoming.text, annotations: preview.annotations})
      reanchored += preview.moved
      lost += preview.clamped
    }
  }

  const applied = applyW3C(r.w3cRouted)
  const newDocs = [...fresh, ...r.sessionDocs]
  if (overwrites.size > 0 || newDocs.length > 0) {
    state = {
      docs: [
        ...state.docs.map((d) => {
          const ow = overwrites.get(d.id)
          return ow ? {...d, text: ow.text, annotations: ow.annotations} : d
        }),
        ...newDocs,
      ],
      activeDocId: fresh[0]?.id ?? r.sessionDocs[0]?.id ?? state.activeDocId,
      trash: state.trash,
    }
  }
  if (applied.merged > 0 || newDocs.length > 0 || overwrites.size > 0) rerender(false)
  if (applied.merged > 0 || applied.unmatched > 0) {
    toast(w3cToast(applied.merged, applied.unmatched, applied.routed))
  } else if (newDocs.length === 0 && overwrites.size === 0 && r.w3cFiles === 0) {
    toast(r.skipped > 0 ? `没有可导入的文本文件（跳过 ${r.skipped} 个）` : '没有可导入的文件')
  }
  if (newDocs.length > 0 || overwrites.size > 0) {
    const action = (a: string): number => rows.filter((row) => row.action === a).length
    const parts: string[] = []
    const imported = action('direct') + action('rename')
    if (imported > 0) parts.push(`导入 ${imported} 个文档`)
    if (overwrites.size > 0) {
      let p = `覆盖 ${overwrites.size}`
      if (reanchored > 0 || lost > 0) p += `（重锚 ${reanchored}${lost > 0 ? ` · 失锚 ${lost}` : ''}）`
      parts.push(p)
    }
    if (r.sessionDocs.length > 0) parts.push(`会话已合并（${r.sessionDocs.length} 个文档）`)
    if (action('identical') > 0) parts.push(`${action('identical')} 个内容相同已跳过`)
    if (r.skipped > 0) parts.push(`跳过 ${r.skipped}`)
    if (r.truncated > 0) parts.push(`${r.truncated} 个超大文件已截断`)
    toast(parts.join('，'))
  }
}

/** 导出弹层的 W3C 导入入口：单文件按来源分发 */
async function importW3CFile(file: File): Promise<void> {
  const r = await importFileList([file], { docs: state.docs, currentDoc: activeDoc() })
  const applied = applyW3C(r.w3cRouted)
  if (r.w3cFiles === 0 || (applied.merged === 0 && applied.unmatched === 0)) {
    toast('不是可导入的 W3C 批注文件')
    return
  }
  if (applied.merged > 0) rerender(false)
  toast(w3cToast(applied.merged, applied.unmatched, applied.routed))
}

/** 把按来源分组的 W3C 批注折叠进工作区（一次不可变更新），返回汇总 */
function applyW3C(routed: W3CRouted[]): { merged: number; unmatched: number; routed: number } {
  if (routed.length === 0) return { merged: 0, unmatched: 0, routed: 0 }
  let merged = 0
  let unmatched = 0
  let routedDocs = 0
  state = {
    ...state,
    docs: state.docs.map((d) => {
      const groups = routed.filter(
        (g) => g.docId === d.id || (g.docId === null && d.id === state.activeDocId),
      )
      if (groups.length === 0) return d
      const anns = groups.flatMap((g) => g.annotations)
      unmatched += groups.reduce((a, g) => a + g.unmatched, 0)
      merged += anns.length
      routedDocs +=
        anns.length > 0 && groups.some((g) => g.docId !== null && g.docId !== state.activeDocId) ? 1 : 0
      return { ...d, annotations: [...d.annotations, ...anns] }
    }),
  }
  return { merged, unmatched, routed: routedDocs }
}

/** W3C 导入结果提示：分发到多个文档时注明 */
function w3cToast(merged: number, unmatched: number, routed: number): string {
  const base = `导入 ${merged} 条批注`
  const skip = unmatched > 0 ? `，${unmatched} 条原文中找不到锚点已跳过` : ''
  const dist = routed > 0 ? `（已按来源分发到 ${routed} 份文档）` : ''
  return `${base}${skip}${dist}`
}

// ---------------------------------------------------------------- 顶栏动作

const SAMPLE_NAME = '示例：AI 味产品文'

/** 载入示例：新建一份示例文档并跳转过去（内容追加、不覆盖）。
 * 工作区已有内容时先确认（告知会跳转走）；已有示例文档则直接复用，避免堆积副本。 */
async function loadSample(): Promise<void> {
  const existing = state.docs.find((d) => d.name === SAMPLE_NAME)
  if (state.docs.length > 0) {
    const ok = await confirmDialog({
      title: existing ? '跳转到示例文档？' : '载入示例文档？',
      description: existing
        ? '已有一份示例文档，将直接跳转过去；你当前的文档与批注保持不变。'
        : '将新建一份示例文档（带 AI 味的演示文本）并跳转过去；你当前的文档与批注保持不变。',
      confirmText: existing ? '跳转' : '载入示例',
    })
    if (!ok) return
  }
  if (existing) {
    state = {...state, activeDocId: existing.id}
    rerender(false)
    return
  }
  const doc: DocItem = {
    id: newDocId(),
    name: SAMPLE_NAME,
    path: '',
    text: SAMPLE_TEXT,
    annotations: [],
    addedAt: Date.now(),
  }
  state = {docs: [...state.docs, doc], activeDocId: doc.id, trash: state.trash}
  rerender(false)
}

function maybeExport(): void {
  const doc = activeDoc()
  if (!doc || doc.annotations.length === 0) {
    toast('当前文档还没有批注：划选正文文字，或运行 slop 预扫描')
    return
  }
  exporter.open([doc])
}

function clearCurrent(): void {
  const doc = activeDoc()
  if (!doc) return
  removeDoc(doc.id)
}

/** 完整设置弹层：改动经 setPrefs 即时生效并持久化，弹层背后实时预览 */
async function openSettings(): Promise<void> {
  await settingsDialog(prefs, setPrefs)
}

// 侧栏 / 文档树收起。桌面（≥lg）：flex 布局下隐藏元素自然退出，flex-1 的
// 中区自动占满；移动（<lg）：两者是覆盖式抽屉，body 上的 tree-open /
// sidebar-open 类驱动滑入滑出（样式在 styles.css 移动端媒体查询），互斥展开。
const isMobileViewport = (): boolean => window.matchMedia('(max-width: 1023.98px)').matches

function closeDrawers(): void {
  document.body.classList.remove('tree-open', 'sidebar-open')
}

function togglePanel(which: 'tree' | 'sidebar'): void {
  if (isMobileViewport()) {
    const other = which === 'tree' ? 'sidebar-open' : 'tree-open'
    document.body.classList.remove(other)
    document.body.classList.toggle(`${which}-open`)
    return
  }
  if (which === 'tree') {
    const off = $('#filetree').classList.toggle('hidden')
    // 边缘竖条位置固定，收起后仅翻字形（CSS 由 is-collapsed 驱动）
    $('#collapse-left').classList.toggle('is-collapsed', off)
  } else {
    const off = $('#sidebar').classList.toggle('hidden')
    $('#collapse-right').classList.toggle('is-collapsed', off)
  }
}

// 导入组：文件 / 文件夹 / 示例 归入一个悬停菜单
wireHeaderMenu($('#btn-import'), [
  {id: 'files', label: '打开文件', icon: icon('file'), hint: '.txt · .md · .json'},
  {id: 'folder', label: '导入文件夹', icon: icon('folder'), hint: '整批 .txt · .md'},
  {id: 'sample', label: '载入示例', icon: icon('plus'), hint: '带 AI 味的演示文档'},
], (id) => {
  if (id === 'files') $('#file-input').click()
  if (id === 'folder') $('#folder-input').click()
  if (id === 'sample') void loadSample()
})
$('#file-input').addEventListener('change', (e) => {
  const files = (e.target as HTMLInputElement).files
  if (files && files.length > 0) void importFiles(files)
  ;(e.target as HTMLInputElement).value = ''
})
$('#folder-input').addEventListener('change', (e) => {
  const files = (e.target as HTMLInputElement).files
  if (files && files.length > 0) void importFiles(files)
  ;(e.target as HTMLInputElement).value = ''
})
$('#btn-scan').addEventListener('click', runSlopScan)
$('#btn-edit').addEventListener('click', toggleEdit)
$('#btn-diff').addEventListener('click', () => void toggleDiff())
$('#btn-diff-clear').addEventListener('click', () => void clearRevised())
$('#btn-export').addEventListener('click', maybeExport)

// 视图组：明暗翻转 / 完整阅读设置 / 批注栏开关
wireHeaderMenu($('#btn-view'), [
  {id: 'polarity', label: '切换明暗', icon: icon('moon'), hint: '成对主题互换'},
  {id: 'settings', label: '阅读设置', icon: icon('settings'), hint: '主题 · 纹理 · 字体'},
], (id) => {
  if (id === 'polarity') setPrefs({...prefs, theme: flipPolarity(prefs.theme)})
  if (id === 'settings') void openSettings()
})

// 移动端抽屉开关（<lg）：桌面折叠走 handle 小白条，抽屉按钮移动端专属
$('#btn-tree-drawer').addEventListener('click', () => togglePanel('tree'))
$('#btn-sidebar-drawer').addEventListener('click', () => togglePanel('sidebar'))

// 边缘折叠竖条：贴编辑区左右缘垂直居中，与分隔拖拽条彻底分离
document.querySelectorAll<HTMLElement>('[data-collapse]').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    togglePanel(btn.dataset.collapse as 'tree' | 'sidebar')
  })
})

// 更多：GitHub / 移除当前文档（低频与破坏性归拢）
wireHeaderMenu($('#btn-more'), [
  {id: 'clear', label: '移除当前文档', icon: icon('trash'), danger: true, hint: '二次确认'},
], (id) => {
  if (id === 'clear') void clearCurrent()
})

// 批注工作流直出：搜索（⌘F）与回收站
$('#btn-search').addEventListener('click', () => openSearch())
$('#btn-trash').addEventListener('click', () => openTrash())
$('#btn-theme').addEventListener('click', () => setPrefs({...prefs, theme: flipPolarity(prefs.theme)}))
$('#overlay').addEventListener('click', () => exporter.close())
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault()
    maybeExport()
  }
})

// ---------------------------------------------------------------- 搜索与批量批注（⌘F 面板）

/** 面板打开时的搜索状态：查询词 + 匹配方式（Aa / .*）；非空词则编辑器渲染预览描边 */
let searchPreview: {query: string; match: MatchOptions} | null = null

const searchPanel = new SearchPanelView({
  onQueryChange: (query, match) => {
    searchPreview = {query, match}
    rerender(false)
  },
  onNavigate: (hit) => {
    if (hit.docId !== state.activeDocId) switchDoc(hit.docId)
    editor.scrollToRange(hit.start, hit.end)
  },
  onBatchAnnotate: (targets, kind, comment, replacement) => {
    let total = 0
    state = {
      ...state,
      docs: state.docs.map((d) => {
        const target = targets.find((t) => t.docId === d.id)
        if (!target) return d
        const anns = buildBatchAnnotations(target.matches, { kind, comment, replacement })
        total += anns.length
        return { ...d, annotations: [...d.annotations, ...anns] }
      }),
    }
    sidebar.includeKind(kind)
    rerender(false)
    toast(`已批量批注 ${total} 处${targets.length > 1 ? `（跨 ${targets.length} 份文档）` : ''}`)
  },
  onClose: () => {
    searchPreview = null
    rerender(false)
  },
})

function openSearch(): void {
  if (!activeDoc()) {
    toast('先导入或载入一段文本')
    return
  }
  searchPanel.toggle(
    state.docs.map((d) => ({ id: d.id, name: d.name, text: d.text })),
    state.activeDocId,
  )
}

// ---------------------------------------------------------------- 启动

function bootstrap(): void {
  applyPrefs(prefs) // 首渲染前应用阅读偏好（防闪烁脚本已先行设置主题，这里补齐其余维度）
  state = loadWorkspace()
  rerender(false)
  // header 版本号（构建期由 vite define 注入 package.json version）
  const versionEl = document.querySelector('#app-version')
  if (versionEl) {
    versionEl.textContent = `v${__APP_VERSION__}`
    versionEl.setAttribute('title', `当前版本 v${__APP_VERSION__}`)
  }
  // 移动端抽屉：背板点击与 Esc 关闭；跨断点时清掉抽屉状态
  $('#drawer-backdrop').addEventListener('click', closeDrawers)
  document.addEventListener('keydown', (e) => {
    if (e.isComposing) return
    // ⌘F / Ctrl+F：搜索与批量批注面板（接管浏览器默认查找）
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault()
      openSearch()
      return
    }
    if (e.key === 'Escape') {
      if (searchPanel.isOpen()) searchPanel.close()
      closeDrawers()
    }
  })
  window.matchMedia('(max-width: 1023.98px)').addEventListener('change', closeDrawers)
  initResizers({
    layout: $('#layout'),
    leftHandle: $('#handle-left'),
    rightHandle: $('#handle-right'),
    treeEl,
    sidebarEl,
  })
  new ReadingFab($('#reading-fab'), {
    getPrefs: () => prefs,
    onChange: (patch) => setPrefs({...prefs, ...patch}),
    onOpenSettings: () => void openSettings(),
  })
}

bootstrap()

// 供控制台调试与将来 e2e 使用的只读视图（无可变出口）
export const __debug = {
  get state(): AppState { return state },
  numbers: () => numberAnnotations(activeDoc()?.annotations ?? []),
  blocks: () => splitBlocks(activeDoc()?.text ?? ''),
}
