/** 应用装配：多文档工作区状态、事件接线、持久化。UI 模块各自只管画。 */

import { numberAnnotations } from './core/export'
import { diffLines, diffStats } from './core/diff'
import { importFileList, newDocId } from './core/import'
import { reanchorAnnotations } from './core/reanchor'
import { splitBlocks } from './core/text'
import { hitsToAnnotations, scanSlopReport } from './core/slop'
import type { SlopReport } from './core/types'
import { EditorView } from './ui/editor'
import { ExporterView } from './ui/exporter'
import { FileTreeView } from './ui/filetree'
import { AnnotationPopup } from './ui/annotation-popup'
import { SelectionPin } from './ui/selection-pin'
import { confirmDialog, textDialog } from './ui/confirm'
import { SidebarView } from './ui/sidebar'
import { initResizers } from './ui/resizer'
import { initSaveStatus } from './ui/save-status'
import { initTheme } from './ui/theme'
import { toast } from './ui/toast'
import { rectOfAnnotation, resolveSelection } from './ui/selection-offsets'
import { SAMPLE_TEXT } from './ui/sample'
import { SESSION_VERSION } from './core/types'
import type { Annotation, AnnotationInput, DocItem, SlopLexicon } from './core/types'
import { loadWorkspace } from './ui/storage'
import zhLexicon from '../skill/references/anti-slop-kit/scripts/data/zh.json'
import enLexicon from '../skill/references/anti-slop-kit/scripts/data/en.json'

const LEXICONS = [zhLexicon, enLexicon] as unknown as SlopLexicon[]

// ---------------------------------------------------------------- 状态

interface AppState {
  docs: DocItem[]
  activeDocId: string
}

let state: AppState = { docs: [], activeDocId: '' }
/** 筛选透镜：正文高亮与侧栏列表共用 */
let onlyHighlightFiltered = false
/** 应用模式：批注视图 / 对照视图 / 编辑原文——三者互斥，用联合类型让
 * 「边编辑边对照」这类非法组合无法表达（替代原 viewMode + editingText 布尔对） */
let mode: 'annotate' | 'diff' | 'edit' = 'annotate'
/** 各文档最近一次 slop 扫描报告（侧栏统计卡）：派生数据缓存，文本变化即失效 */
const slopReports = new Map<string, SlopReport>()

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

/** 删除批注（二次确认）。弹层与侧栏共用同一命令，不各持一份副本 */
const deleteAnnotation = (id: string): void => {
  void (async () => {
    const ok = await confirmDialog({
      title: '删除这条批注？',
      description: '删除后不可恢复。',
      confirmText: '删除',
      danger: true,
    })
    if (!ok) return
    mutateActive((doc) => ({ ...doc, annotations: doc.annotations.filter((a) => a.id !== id) }))
  })()
}

/** 解决 / 重开批注。弹层与侧栏共用 */
const toggleAnnotationStatus = (id: string): void => {
  mutateActive((doc) => ({
    ...doc,
    annotations: doc.annotations.map((a) =>
      a.id === id ? { ...a, status: a.status === 'open' ? 'resolved' : 'open', updatedAt: Date.now() } : a,
    ),
  }))
}

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
  onUpdate: (id, kind, comment) => {
    mutateActive((doc) => ({
      ...doc,
      annotations: doc.annotations.map((a) =>
        a.id === id ? { ...a, kind, comment, updatedAt: Date.now() } : a,
      ),
    }))
  },
  onDelete: deleteAnnotation,
  onToggleStatus: toggleAnnotationStatus,
  onCopySnippet: (text) => {
    void navigator.clipboard.writeText(text).then(() => toast('已复制片段'))
  },
})

const selectionPin = new SelectionPin({
  onCreate: (info, kind, comment) => {
    addAnnotation({
      start: info.start,
      end: info.end,
      kind,
      comment,
      ...(info.side === 'b' ? { target: 'revised' as const } : {}),
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
})

const fileTree = new FileTreeView(treeEl, {
  onOpen: (id) => switchDoc(id),
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
      count > 0 ? `其中 ${count} 条批注会一并删除，删除后不可恢复。` : '删除后不可恢复。',
    confirmText: '移除',
    danger: true,
  })
  if (!ok) return
  await removeDocsConfirmed([id])
  toast(`已移除 ${doc.name}`)
}

/** 多选移除入口：先统一确认，再落盘 */
async function removeDocs(ids: string[]): Promise<void> {
  const docs = state.docs.filter((d) => ids.includes(d.id))
  if (docs.length === 0) return
  const count = docs.reduce((acc, d) => acc + d.annotations.length, 0)
  const names = docs.map((d) => d.name).join('、')
  const ok = await confirmDialog({
    title: `移除 ${docs.length} 个文档？`,
    description: `${names}${count > 0 ? `（共 ${count} 条批注）` : ''}——删除后不可恢复。`,
    confirmText: '移除',
    danger: true,
  })
  if (!ok) return
  await removeDocsConfirmed(ids)
  toast(`已移除 ${docs.length} 个文档`)
}

/** 已确认的删除落盘：清缓存、维护活动文档、重渲染 */
async function removeDocsConfirmed(ids: string[]): Promise<void> {
  const idSet = new Set(ids)
  state.docs.filter((d) => idSet.has(d.id)).forEach((d) => slopReports.delete(d.id))
  const docs = state.docs.filter((d) => !idSet.has(d.id))
  const activeRemoved = idSet.has(state.activeDocId)
  state = {
    docs,
    activeDocId: activeRemoved ? (docs[0]?.id ?? '') : state.activeDocId,
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
    sidebar.render(doc?.text ?? '', doc?.annotations ?? [], { revised: doc?.revised })
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
    editor.render(doc?.text ?? '', editorAnnotations(), loadSample)
  }
  const diffStatsEl = document.querySelector('#diff-stats')
  if (diffStatsEl) {
    diffStatsEl.textContent = stats
    diffStatsEl.classList.toggle('hidden', !inDiff)
  }
  sidebar.render(doc?.text ?? '', doc?.annotations ?? [], {
    revised: doc?.revised,
    slop: doc ? (slopReports.get(doc.id) ?? null) : null,
  })
  fileTree.render(state.docs, state.activeDocId)
  if (syncPopup && doc) annotationPopup.sync(doc.text, doc.annotations, doc.revised)
  save.markDirty()
}

// ---------------------------------------------------------------- 保存

// 数据快照即时取自工作区状态；状态机与计时器归 ui/save-status 所有
const save = initSaveStatus(() => ({
  version: SESSION_VERSION,
  docs: state.docs,
  activeDocId: state.activeDocId,
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
  mutateActive((d) => ({ ...d, annotations: [...d.annotations, ...anns] }))
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
  mode = 'annotate'
  if (newText === doc.text) {
    rerender(false)
    return
  }
  if (newText.trim() === '') {
    toast('文本不能为空')
    mode = 'edit'
    return
  }
  const { annotations, moved, clamped } = reanchorAnnotations(doc.text, newText, doc.annotations)
  slopReports.delete(doc.id) // 文本已变，上一次评分失效
  mutateActive((d) => ({ ...d, text: newText, annotations }))
  const parts = ['已保存编辑']
  if (moved > 0) parts.push(`${moved} 条批注重新锚定`)
  if (clamped > 0) parts.push(`${clamped} 条钉在改动处`)
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

/** 文件导入编排：管线（分类/解析）在 core/import.ts，这里只做状态应用与提示 */
async function importFiles(files: FileList | File[]): Promise<void> {
  const r = await importFileList(files, activeDoc())
  if (r.w3cFiles > 0) {
    mutateActive((doc) => ({ ...doc, annotations: [...doc.annotations, ...r.w3cAnnotations] }))
    toast(
      `导入 ${r.w3cAnnotations.length} 条批注${
        r.w3cUnmatched > 0 ? `，${r.w3cUnmatched} 条原文中找不到锚点已跳过` : ''
      }`,
    )
  }
  const newDocs = [...r.textDocs, ...r.sessionDocs]
  if (newDocs.length === 0) {
    if (r.w3cFiles === 0) {
      toast(r.skipped > 0 ? `没有可导入的文本文件（跳过 ${r.skipped} 个）` : '没有可导入的文件')
    }
    return
  }
  state = { docs: [...state.docs, ...newDocs], activeDocId: newDocs[0]!.id }
  rerender(false)
  const parts: string[] = []
  if (r.textDocs.length > 0) parts.push(`导入 ${r.textDocs.length} 个文档`)
  if (r.sessionDocs.length > 0) parts.push(`会话已合并（${r.sessionDocs.length} 个文档）`)
  if (r.skipped > 0) parts.push(`跳过 ${r.skipped}`)
  if (r.truncated > 0) parts.push(`${r.truncated} 个超大文件已截断`)
  toast(parts.join('，'))
}

/** 导出弹层的 W3C 导入入口：单文件并入当前文档 */
async function importW3CFile(file: File): Promise<void> {
  const r = await importFileList([file], activeDoc())
  if (r.w3cAnnotations.length === 0) {
    toast('不是可导入的 W3C 批注文件')
    return
  }
  mutateActive((doc) => ({ ...doc, annotations: [...doc.annotations, ...r.w3cAnnotations] }))
  toast(
    `导入 ${r.w3cAnnotations.length} 条批注${
      r.w3cUnmatched > 0 ? `，${r.w3cUnmatched} 条原文中找不到锚点已跳过` : ''
    }`,
  )
}

// ---------------------------------------------------------------- 顶栏动作

function loadSample(): void {
  const doc: DocItem = {
    id: newDocId(),
    name: '示例：AI 味产品文',
    path: '',
    text: SAMPLE_TEXT,
    annotations: [],
    addedAt: Date.now(),
  }
  state = {docs: [...state.docs, doc], activeDocId: doc.id}
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

// 侧栏 / 文档树收起：flex 布局下隐藏元素自然退出，flex-1 的中区自动占满，
// 不需要任何列模板映射（此前 grid 自动放置会把中区挤进 6px 分隔列）
function togglePanel(which: 'tree' | 'sidebar'): void {
  if (which === 'tree') {
    const off = $('#filetree').classList.toggle('hidden')
    $('#handle-left').classList.toggle('hidden', off)
  } else {
    const off = $('#sidebar').classList.toggle('hidden')
    $('#handle-right').classList.toggle('hidden', off)
  }
}

$('#btn-sample').addEventListener('click', loadSample)
$('#btn-import-files').addEventListener('click', () => $('#file-input').click())
$('#btn-import-folder').addEventListener('click', () => $('#folder-input').click())
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
$('#btn-clear').addEventListener('click', () => void clearCurrent())
$('#btn-tree').addEventListener('click', () => togglePanel('tree'))
$('#btn-sidebar').addEventListener('click', () => togglePanel('sidebar'))
$('#overlay').addEventListener('click', () => exporter.close())
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault()
    maybeExport()
  }
})

// ---------------------------------------------------------------- 启动

function bootstrap(): void {
  state = loadWorkspace()
  rerender(false)
  initResizers({
    layout: $('#layout'),
    leftHandle: $('#handle-left'),
    rightHandle: $('#handle-right'),
    treeEl,
    sidebarEl,
  })
  initTheme()
}

bootstrap()

// 供控制台调试与将来 e2e 使用的只读视图（无可变出口）
export const __debug = {
  get state(): AppState { return state },
  numbers: () => numberAnnotations(activeDoc()?.annotations ?? []),
  blocks: () => splitBlocks(activeDoc()?.text ?? ''),
}
