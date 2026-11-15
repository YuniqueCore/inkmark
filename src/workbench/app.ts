import {bindCanvasImport} from '../platform/canvas-input'
/** 应用装配：多文档工作区状态、事件接线、持久化。UI 模块各自只管画。 */

import {WorkspaceStore, type WorkspaceState} from './workspace'
import {createTextReview} from './text-review'
import {createImports} from './imports'
import {createRecovery} from './recovery'
import { numberAnnotations } from '../core/export'
import { diffLines, diffStats } from '../core/diff'
import { MAX_DOC_CHARS, newDocId } from '../core/import'
import { buildBatchAnnotations, findMatches } from '../core/batch'
import type { MatchOptions } from '../core/batch'
import { uniqueDocumentName } from '../core/import-conflict'
import { normalizeLineEndings, splitBlocks } from '../core/text'
import type { SlopReport } from '../core/types'
import type { Annotation, AnnotationInput, DocItem, ReviewDocument } from '../core/types'
import { EditorView } from '../ui/editor'
import {createTrash, trashedDocIds} from './trash'
import { flipPolarity } from '../core/prefs'
import type { ReadingPrefs } from '../core/prefs'
import { applyPrefs, loadPrefs, savePrefs } from '../ui/prefs'
import {Search} from './search'
import {ReviewList} from './review-list'
import {DocumentList, summarizeDocuments} from './documents'
import { initSaveStatus } from '../ui/save-status'
import {copyText as copy, exportFile as transfer} from '../ui/file-transfer'
import type {Presentation} from './presentation'
import type {ReadingMode, WorkspaceAction} from './shell-state'
import {bindFileInput, readClipboardImage, fileOperationPending} from '../platform/files'
import {bindHostLifecycle, hostRequestPending} from '../platform/host'
import {observeTextSelection, type SelectionPoint} from '../ui/text-selection'
import { rectOfAnnotation, resolveSelection } from '../ui/selection-offsets'
import { SAMPLE_TEXT } from '../ui/sample'
import { SESSION_VERSION } from '../core/types'
import { loadWorkspace, unreadableWorkspaceData, legacyWorkspaceData } from '../ui/storage'
import { newId } from '../core/identity'
import { MarkdownPreviewView, resolvePreviewSelection } from '../ui/markdown-preview'
import { markdownSyntaxRanges } from '../ui/markdown-syntax'
import type { TextStyleRange } from '../ui/render-text'
import { isImageDocument, isTextDocument } from '../core/types'
import { annotationFits } from '../core/image'
import { appendAnnotations, filterAnnotations, patchAnnotationBodies } from '../core/document'
import { presentAnnotations } from './annotation-presentation'
import { ImageView } from '../ui/image-view'

export function startWorkbench(presentation: Presentation) {
const toast = (message: string): void => presentation.notify(message)
const choiceDialog = presentation.choice.bind(presentation)
const confirmDialog = (options: Parameters<Presentation['choice']>[0]) => choiceDialog(options).then(choice => choice === 'confirm')
const textDialog = presentation.text.bind(presentation)
const textDialogDraft = presentation.textDraft.bind(presentation)
const copyText = (text: string, message: string) => copy(text, message, toast)
const exportFile = (file: File, detail = '') => transfer(file, detail, toast)

// ---------------------------------------------------------------- 状态

const workspace = new WorkspaceStore(() => { if (ready) save.markDirty() })
/** 筛选透镜：正文高亮与侧栏列表共用 */
const reviewList = new ReviewList()
const documentList = new DocumentList()
/** 应用模式：批注视图 / 对照视图 / 编辑原文——三者互斥，用联合类型让
 * 「边编辑边对照」这类非法组合无法表达（替代原 viewMode + editingText 布尔对） */
let mode: 'annotate' | 'diff' | 'edit' = 'annotate'
let readingMode: ReadingMode = 'source'
let syntaxText: string | null = null
let syntaxRanges: TextStyleRange[] = []
/** 各文档最近一次 slop 扫描报告（侧栏统计卡）：派生数据缓存，文本变化即失效 */
const slopReports = new Map<string, SlopReport>()

/** 阅读偏好（主题/纹理/字体/字号）：独立于工作区的第二状态域，改动即应用并持久化 */
let prefs: ReadingPrefs = loadPrefs()
const setPrefs = (next: ReadingPrefs): void => {
  prefs = next
  applyPrefs(prefs)
  imageView.refreshStyle()
  savePrefs(prefs)
  renderChrome()
}

/** 编辑器实际渲染的批注：关闭"仅高亮筛选"时显示全部 */
function editorAnnotations(): Annotation[] {
  const doc = activeDoc()
  if (!doc) return []
  if (!reviewList.highlightFiltered) return doc.annotations
  return reviewList.visible(doc.annotations)
}

const activeItem = (): ReviewDocument | undefined => workspace.current.docs.find((d) => d.id === workspace.current.activeDocId)
const activeDoc = (): DocItem | undefined => { const doc = activeItem(); return doc && isTextDocument(doc) ? doc : undefined }
let ready = false
let resolveWorkspaceReady: () => void
const workspaceReady = new Promise<void>((resolve) => { resolveWorkspaceReady = resolve })

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector(sel)
  if (!el) throw new Error(`missing element: ${sel}`)
  return el as T
}
window.addEventListener('inkmark:host-error', event => toast((event as CustomEvent<string>).detail))

const editorEl = $('#editor')
const previewEl = $('#markdown-preview')
const previewBody = previewEl.querySelector<HTMLElement>('.markdown-body')!
const markdownPreview = new MarkdownPreviewView(previewBody)

const imageView = new ImageView($('#image-view'), {
  onSave: (docId, annotation, expected) => {
    const doc = activeItem()
    if (!doc || !isImageDocument(doc) || doc.id !== docId || !annotationFits(doc, annotation)) return false
    const current = doc.annotations.find((a) => a.id === annotation.id)
    if ((expected && current !== expected) || (!expected && (current || workspace.current.trash.some((t) => t.type === 'annotation' ? t.annotation.id === annotation.id : t.doc.annotations.some((a) => a.id === annotation.id))))) {
      toast('批注已变化，请取消草稿后重新编辑')
      return false
    }
    const existing = Boolean(current)
    workspace.current = {...workspace.current, docs: workspace.current.docs.map((d) => d.id !== docId ? d : {...doc,
      annotations: existing ? doc.annotations.map((a) => a.id === annotation.id ? annotation : a) : [...doc.annotations, annotation],
    })}
    if (reviewList.highlightFiltered) reviewList.includeKind(annotation.kind)
    reviewList.activeId = annotation.id
    rerender(false)
    return true
  },
  onFocus: (id) => {
    reviewList.activeId = id
    const doc = activeItem()
    if (doc) sidebar.render(presentAnnotations(doc), {image: true})
  },
  onNotify: toast,
}, presentation.imageControls)

// ---------------------------------------------------------------- 视图

const editor = new EditorView(editorEl, {
  onEmpty: (root, sample) => presentation.welcome(root, openNewDocument, sample),
  onSelectionChange: (e) => {
    const doc = activeDoc()
    const info = doc ? resolveSelection(e, editorEl, doc) : null
    if (info) selectionPin.showFor(info)
    else selectionPin.dismiss()
  },
  onAnnotationClick: (id, rect) => {
    openAnnotationEditor(id, rect, editorEl)
    reviewList.activeId = id
    rerender(false)
  },
})

function previewSelection(event: SelectionPoint): void {
  const doc = activeDoc()
  if (!doc) return
  const {info, error} = resolvePreviewSelection(event, previewEl, doc)
  if (info) selectionPin.showFor(info)
  else {
    selectionPin.dismiss()
    if (error) toast(error)
  }
}
observeTextSelection(previewEl, previewSelection)
previewEl.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('.seg-hl')
  const id = target?.dataset.annIds?.split(' ')[0]
  if (!id || !target) return
  event.preventDefault()
  openAnnotationEditor(id, target.getBoundingClientRect(), previewEl)
  reviewList.activeId = id
  rerender(false)
})

/** 解决 / 重开批注（支持批量）：组内有未解决就全部解决，否则全部重开 */
const toggleAnnotationStatus = (ids: string[]): void => {
  if (imageView.hasDraft()) { toast('请先保存或取消当前区域批注'); return }
  const idSet = new Set(ids)
  const anyOpen = activeItem()?.annotations.some((a) => idSet.has(a.id) && a.status === 'open') ?? false
  mutateItem((doc) => patchAnnotationBodies(doc, idSet, {status: anyOpen ? 'resolved' : 'open', updatedAt: Date.now()}))
  toast(anyOpen ? `已解决 ${ids.length} 条批注` : `已重开 ${ids.length} 条批注`)
}

/** 搜索批量批注在 ⌘F 面板（search-panel.ts）里完成：main 只接线 */

/** 打开批注编辑弹层：摘录与弹出内容按锚定侧取文本。
 * rect 缺省时从高亮元素实时查询（侧栏编辑入口；高亮可能刚被重渲染）。 */
const openAnnotationEditor = (id: string, rect?: DOMRect, root?: HTMLElement): void => {
  const item = activeItem()
  if (item && isImageDocument(item)) { imageView.edit(id); return }
  const doc = activeDoc()
  if (!doc) return
  const anchorRect = rect ?? (readingMode === 'preview' && mode === 'annotate'
    ? rectOfAnnotation(previewEl, id) : rectOfAnnotation(editorEl, id))
  if (!anchorRect) return
  const ann = doc.annotations.find((a) => a.id === id)
  const text = ann?.target === 'revised' ? (doc.revised ?? doc.text) : doc.text
  annotationPopup.setAnchorRect(anchorRect, root ?? (readingMode === 'preview' && mode === 'annotate' ? previewEl : editorEl))
  // 点击 / 编辑入口直接进入编辑态
  annotationPopup.openFor(id, text, doc.annotations, true)
}

const annotationPopup = presentation.annotation({
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
    void copyText(text, '已复制片段')
  },
})

const selectionPin = presentation.selection({
  onCreate: (info, kind, comment, replacement) => {
    const doc = activeDoc()
    const text = info.side === 'b' ? doc?.revised : doc?.text
    if (!doc || doc.id !== info.docId || text !== info.sourceText || text.slice(info.start, info.end) !== info.quoted) {
      toast('文档或文本已变化，请重新选择后再提交；草稿仍保留。')
      return false
    }
    addAnnotation({
      start: info.start,
      end: info.end,
      kind,
      comment,
      ...(info.side === 'b' ? { target: 'revised' as const } : {}),
      ...(replacement ? { replacement } : {}),
    })
    return true
  },
  onCopySelection: (quoted) => {
    void copyText(quoted, '已复制选中文本')
  },
  onDismiss: () => {
    reviewList.activeId = null
  },
})

const {deleteAnnotation, openTrash, removeDoc, removeDocs} = createTrash({workspace,
  get mode() { return mode }, set mode(next) { mode = next }, active: activeItem, canLeave: canLeaveEdit,
  imageDraft: () => imageView.hasDraft(), presentation, selection: selectionPin, annotation: annotationPopup,
  confirm: confirmDialog, mutate: mutateItem, render: () => rerender(false), invalidate: id => slopReports.delete(id), notify: toast,
})

const sidebar = presentation.sidebar({
  onFocus: (id) => {
    presentation.revealCanvas()
    if (!revealAnnotation(id)) return
    reviewList.activeId = id
    rerender(false)
    focusAnnotation(id)
  },
  onEdit: (a) => {
    presentation.revealCanvas()
    if (!revealAnnotation(a.id)) return
    rerender(false)
    focusAnnotation(a.id)
    openAnnotationEditor(a.id)
    reviewList.activeId = a.id
  },
  onDelete: deleteAnnotation,
  onExport: (ids) => {
    if (!canLeaveEdit()) return
    const doc = activeItem()
    if (!doc) return
    const selected = new Set(ids)
    const scoped = filterAnnotations(doc, (a) => selected.has(a.id))
    if (scoped.annotations.length > 0) exporter.open([scoped], {includeResolved: true})
  },
  onToggleStatus: toggleAnnotationStatus,
  onFilterChange: (f) => {
    reviewList.filter = f
    rerender(false)
  },
  onKindFilterChange: (kinds) => {
    reviewList.kinds = kinds
    rerender(false)
  },
  onHighlightModeChange: (only) => {
    reviewList.highlightFiltered = only
    rerender(false)
  },
  onNotify: (msg) => toast(msg),
}, reviewList)

const fileTree = presentation.documents({
  onOpen: (id) => {
    presentation.revealCanvas()
    switchDoc(id)
  },
  onRemove: (id) => void removeDoc(id),
  onExportDoc: (id) => {
    if (!canLeaveEdit()) return
    const doc = workspace.current.docs.find((d) => d.id === id)
    if (!doc) return
    if (doc.annotations.length === 0) {
      toast('该文档还没有批注')
      return
    }
    exporter.open([doc])
  },
  onBulkExport: (ids) => {
    if (!canLeaveEdit()) return
    const idSet = new Set(ids)
    const docs = workspace.current.docs.filter((d) => idSet.has(d.id) && d.annotations.length > 0)
    if (docs.length === 0) {
      toast('所选文档都没有批注')
      return
    }
    if (docs.length < ids.length) toast(`${ids.length - docs.length} 份没有批注的文档已跳过`)
    exporter.open(docs)
  },
  onBulkDelete: (ids) => void removeDocs(ids),
}, documentList)

const exporter = presentation.exporter({
  onCopy: (content) => {
    void copyText(content, '已复制到剪贴板')
  },
  onClose: () => {},
  onImportW3C: (file, fallbackDocId) => importW3CFile(file, fallbackDocId),
})

const {importFiles, importW3CFile} = createImports({workspace, ready: workspaceReady, canLeave: canLeaveEdit, active: activeItem, presentation,
  confirmDrafts: confirmDraftsForTextChange, dismissSelection: () => selectionPin.dismiss(), closeAnnotation: () => annotationPopup.close(),
  render: () => rerender(false), notify: toast})

// ---------------------------------------------------------------- 工作区操作

function addAnnotation(input: AnnotationInput): void {
  const now = Date.now()
  const ann: Annotation = {
    id: newId('ann'),
    status: 'open',
    source: 'manual',
    createdAt: now,
    updatedAt: now,
    ...input,
  }
  mutateActive((doc) => ({ ...doc, annotations: [...doc.annotations, ann] }))
  // 「只高亮当前筛选」开启时，新批注若被类型筛选排除会立刻"消失"——
  // 自动把它的类型纳入筛选，保证刚写的批注可见
  if (reviewList.highlightFiltered) {
    reviewList.includeKind(input.kind)
  }
}

function mutateItem(fn: (doc: ReviewDocument) => ReviewDocument): void {
  const doc = activeItem()
  if (!doc) return
  workspace.current = {...workspace.current, docs: workspace.current.docs.map((d) => d.id === doc.id ? fn(doc) : d)}
  rerender()
}

/** 当前文档的不可变更新；无文档时静默忽略 */
function mutateActive(fn: (doc: DocItem) => DocItem): void {
  const doc = activeDoc()
  if (!doc) return
  workspace.current = {
    ...workspace.current,
    docs: workspace.current.docs.map((d) => (d.id === doc.id ? fn(doc) : d)),
  }
  rerender()
}

function canLeaveEdit(): boolean {
  if (document.body.inert) {
    toast('正在恢复工作区，请完成后重新操作')
    return false
  }
  if (!ready) { toast('工作区正在载入，请稍候'); return false }
  if (textDialogDraft() !== null) { toast('请先提交或取消当前文本输入，再重试操作'); return false }
  if (imageView.hasDraft()) { toast('请先保存或取消当前区域批注'); return false }
  imageView.flushGeometry()
  if (mode === 'edit') {
    toast('请先完成或取消原文编辑')
    return false
  }
  if (annotationPopup.hasDraft()) {
    toast('请先保存或取消批注编辑')
    return false
  }
  return true
}

/** 文本替换会使未提交草稿失去锚点，先让用户显式选择是否放弃。 */
async function confirmDraftsForTextChange(
  docIds: ReadonlySet<string>,
  side: 'a' | 'b',
  unchanged: () => boolean,
): Promise<boolean> {
  if (!selectionPin.hasDrafts(docIds, side)) return true
  const ok = await confirmDialog({
    title: '放弃未提交的划词草稿？',
    description: '继续会改变草稿对应的文本并放弃相关草稿。取消后可重新选中原文，提交草稿或在撰写卡内按 Esc 取消。',
    confirmText: '放弃草稿并继续',
    danger: true,
  })
  if (!ok) return false
  if (!unchanged()) {
    toast('工作区在操作期间发生变化，请重试')
    return false
  }
  selectionPin.discardDrafts(docIds, side)
  return true
}

function switchDoc(id: string): boolean {
  if (workspace.current.activeDocId === id) return true
  if (!canLeaveEdit()) return false
  workspace.current = { ...workspace.current, activeDocId: id }
  selectionPin.dismiss()
  annotationPopup.close()
  rerender(false)
  return true
}

/** 侧栏中的批注始终定位到它所属的源文本，而非渲染后的 Markdown。 */
function revealAnnotation(id: string): boolean {
  if (!canLeaveEdit()) return false
  if (activeItem()?.kind === 'image') return true
  const doc = activeDoc()
  const ann = doc?.annotations.find((a) => a.id === id)
  if (ann?.target === 'revised' && doc?.revised) mode = 'diff'
  else if (mode === 'annotate' && readingMode === 'preview' && !rectOfAnnotation(previewEl, id)) {
    readingMode = 'split'
    toast('该批注无法在预览中完整显示，已切换分栏定位原文')
  }
  return true
}

function focusAnnotation(id: string): void {
  if (activeItem()?.kind === 'image') { imageView.focus(id); return }
  if (mode !== 'annotate' || readingMode !== 'preview') {
    editor.focusAnnotation(id)
    return
  }
  const element = Array.from(previewEl.querySelectorAll<HTMLElement>('.seg-hl'))
    .find((el) => (el.dataset.annIds ?? '').split(' ').includes(id))
  element?.scrollIntoView({behavior: 'smooth', block: 'center'})
  element?.classList.add('active')
  if (element) setTimeout(() => element.classList.remove('active'), 1400)
}

// ---------------------------------------------------------------- 渲染

function rerender(syncPopup = true): void {
  const item = activeItem()
  const doc = activeDoc()
  const image = item && isImageDocument(item) ? item : null
  imageView.render(image, image ? (reviewList.highlightFiltered ? reviewList.visible(image.annotations) : image.annotations) : undefined)
  $('#reading-panes').hidden = Boolean(image)
  // 模式归一：切到没有改稿的文档时对照模式无处落脚，回落批注视图
  if (mode === 'diff' && !doc?.revised) mode = 'annotate'
  const inDiff = mode === 'diff'
  const showReadingModes = Boolean(doc) && mode === 'annotate'
  renderChrome()
  const layout: ReadingMode = showReadingModes ? readingMode : 'source'
  $('#reading-panes').dataset.layout = layout
  editorEl.hidden = layout === 'preview'
  previewEl.hidden = layout === 'source'
  $('#preview-hint').hidden = layout === 'source'
  if (mode === 'edit') {
    // 编辑模式由 renderEditMode 独占渲染区，这里只同步侧栏
    sidebar.render(doc ? presentAnnotations(doc) : [], {
      slopHistory: doc?.slopHistory ?? [],
    })
    fileTree.render(summarizeDocuments(workspace.current.docs), workspace.current.activeDocId)
    return
  }
  let stats = ''
  if (inDiff) {
    const rows = diffLines(doc!.text, doc!.revised!)
    editor.renderDiff(rows, editorAnnotations())
    const { added, removed } = diffStats(rows)
    stats = `+${added} / −${removed}`
  } else if (!image) {
    const text = doc?.text ?? ''
    if (syntaxText !== text) {
      syntaxRanges = markdownSyntaxRanges(text)
      syntaxText = text
    }
    const hits = searchPreview ? findMatches(text, searchPreview.query, searchPreview.match) : []
    editor.render(
      text,
      editorAnnotations(),
      loadSample,
      hits,
      syntaxRanges,
    )
    if (layout !== 'source' && doc) {
      const scrollTop = previewEl.scrollTop
      markdownPreview.render(doc.id, text, editorAnnotations().filter((a) => a.target !== 'revised'), hits)
      previewEl.scrollTop = scrollTop
    }
  }
  const diffStatsEl = document.querySelector('#diff-stats')
  if (diffStatsEl) {
    diffStatsEl.textContent = stats
    diffStatsEl.classList.toggle('hidden', !inDiff)
  }
  sidebar.render(item ? presentAnnotations(item) : [], {
    image: item?.kind === 'image',
    slop: doc ? (slopReports.get(doc.id) ?? null) : null,
    slopHistory: doc?.slopHistory ?? [],
  })
  fileTree.render(summarizeDocuments(workspace.current.docs), workspace.current.activeDocId)
  searchPanel.setDocs(
    workspace.current.docs.filter(isTextDocument).map((d) => ({ id: d.id, name: d.name, text: d.text })),
    workspace.current.activeDocId,
  )
  if (syncPopup && doc) annotationPopup.sync(doc.text, doc.annotations, doc.revised)
}

// ---------------------------------------------------------------- 保存

function renderChrome(): void {
  if (mode !== 'edit') presentation.sourceEditor.close()
  presentation.render({ready, active: summarizeDocuments(activeItem() ? [activeItem()!] : [])[0] ?? null,
    mode, readingMode, hasRevised: Boolean(activeDoc()?.revised), trashCount: workspace.current.trash.length,
    legacyRecovery: legacyWorkspaceData() !== null, prefs})
}

// 数据快照即时取自工作区状态；状态机与计时器归 ui/save-status 所有
const workspaceSnapshot = () => ({
  version: SESSION_VERSION,
  docs: workspace.current.docs,
  activeDocId: workspace.current.activeDocId,
  trash: workspace.current.trash,
  savedAt: Date.now(),
})
const save = initSaveStatus(workspaceSnapshot, status => presentation.save(status))

function hasUnsavedDrafts(): boolean {
  const doc = activeDoc()
  return Boolean((mode === 'edit' && doc && presentation.sourceEditor.value() !== normalizeLineEndings(doc.text)) ||
    searchPanel.hasDraft() || annotationPopup.hasDraft() || selectionPin.hasDrafts() || imageView.hasDraft() ||
    textDialogDraft() !== null)
}

bindHostLifecycle(async () => {
  if (!ready) return false
  if (fileOperationPending() || hostRequestPending()) { toast('文件操作尚未完成，请稍后再关闭'); return false }
  if (hasUnsavedDrafts()) {
    toast('请先提交或取消当前草稿，再关闭窗口；草稿尚未保存')
    return false
  }
  const saved = await save.settle()
  if (!saved) toast('工作区尚未保存，请先导出备份并处理保存错误，再关闭窗口')
  return saved
}, () => save.settle())

const {downloadDocumentBackup, downloadRecoveryBackup, restoreWorkspaceFile, downloadJson, resetStorage} = createRecovery({
  workspace, snapshot: workspaceSnapshot, save, canLeave: canLeaveEdit, confirm: confirmDialog, notify: toast, exportFile,
  onReplace: initial => {
    mode = 'annotate'
    selectionPin.discardDrafts(new Set([...initial.docs.map(d => d.id), ...trashedDocIds(initial.trash)]))
    selectionPin.dismiss(); annotationPopup.close()
    rerender(false)
  },
})

// ---------------------------------------------------------------- 顶栏动作

const SAMPLE_NAME = '示例：AI 味产品文'

/** 载入示例：新建一份示例文档并跳转过去（内容追加、不覆盖）。
 * 工作区已有内容时先确认（告知会跳转走）；已有示例文档则直接复用，避免堆积副本。 */
async function loadSample(): Promise<void> {
  if (!canLeaveEdit()) return
  const existing = workspace.current.docs.find((d) => d.name === SAMPLE_NAME)
  if (workspace.current.docs.length > 0) {
    const ok = await confirmDialog({
      title: existing ? '跳转到示例文档？' : '载入示例文档？',
      description: existing
        ? '已有一份示例文档，将直接跳转过去；你当前的文档与批注保持不变。'
        : '将新建一份示例文档（带 AI 味的演示文本）并跳转过去；你当前的文档与批注保持不变。',
      confirmText: existing ? '跳转' : '载入示例',
    })
    if (!ok) return
  }
  if (!canLeaveEdit()) return
  if (existing) {
    switchDoc(existing.id)
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
  workspace.current = {...workspace.current, docs: [...workspace.current.docs, doc]}
  switchDoc(doc.id)
}

function textInputError(text: string): string | null {
  if (text.trim() === '') return '请输入或粘贴文本。'
  if (text.length > MAX_DOC_CHARS) return `文本超过 ${MAX_DOC_CHARS.toLocaleString()} 个字符，请缩短后重试。`
  return null
}

function createPastedDocument(text: string): void {
  if (!canLeaveEdit()) return
  const error = textInputError(text)
  if (error) {
    toast(error)
    return
  }
  const doc: DocItem = {
    id: newDocId(),
    name: uniqueDocumentName('粘贴文档.md', '', workspace.current.docs),
    path: '',
    text,
    annotations: [],
    addedAt: Date.now(),
  }
  workspace.current = {...workspace.current, docs: [...workspace.current.docs, doc]}
  switchDoc(doc.id)
  toast('已新建文档')
}

function openNewDocument(): void {
  if (!canLeaveEdit()) return
  textDialog({
    title: '粘贴新建文档',
    description: '粘贴原文或 Markdown，创建独立文档；现有文档与批注会保留。',
    placeholder: '在这里粘贴或输入文本…',
    inputLabel: '新文档内容',
    confirmText: '创建文档',
    validate: textInputError,
    onSubmit: createPastedDocument,
  })
}

function maybeExport(): void {
  if (!canLeaveEdit()) return
  const doc = activeItem()
  if (!doc || doc.annotations.length === 0) {
    toast(doc && isImageDocument(doc) ? '当前图片还没有批注：框选区域或使用坐标批注' : '当前文档还没有批注：划选正文文字，或运行 slop 预扫描')
    return
  }
  exporter.open([doc])
}

function clearCurrent(): void {
  const doc = activeItem()
  if (!doc) return
  removeDoc(doc.id)
}

/** 完整设置弹层：改动经 setPrefs 即时生效并持久化，弹层背后实时预览 */
async function openSettings(): Promise<void> {
  await presentation.settings(prefs, setPrefs)
}

const filePicker = (id: string, accept: string, multiple: boolean, directory: boolean, consume: (files: File[]) => void | Promise<void>): (() => void) => {
  const input = document.getElementById(id) as HTMLInputElement | null ?? document.createElement('input')
  input.type = 'file'; input.accept = accept; input.multiple = multiple; input.webkitdirectory = directory
  return bindFileInput(input, consume, toast)
}
const pickDocuments = filePicker('file-input', '.txt,.md,.markdown,.json,.png,.jpg,.jpeg,.webp', true, false, importFiles)
const pickFolder = filePicker('folder-input', '', true, true, importFiles)
const pickWorkspace = filePicker('workspace-input', '.json', false, false, async files => { if (files[0]) await restoreWorkspaceFile(files[0]) })
function setReadingMode(next: ReadingMode): void {
  if (!canLeaveEdit() || next === readingMode) return
  readingMode = next
  selectionPin.dismiss()
  annotationPopup.close()
  rerender(false)
}

bindCanvasImport({ready: workspaceReady, hasDocuments: () => workspace.current.docs.length > 0,
  importFiles, createDocument: createPastedDocument, notify: toast})

window.addEventListener('storage', renderChrome)
window.addEventListener('focus', renderChrome)

// ---------------------------------------------------------------- 搜索与批量批注（⌘F 面板）

/** 面板打开时的搜索状态：查询词 + 匹配方式（Aa / .*）；非空词则编辑器渲染预览描边 */
let searchPreview: {query: string; match: MatchOptions} | null = null

const searchPanel = presentation.search({
  onQueryChange: (query, match) => {
    searchPreview = {query, match}
    rerender(false)
  },
  onNavigate: (hit) => {
    if (hit.docId !== workspace.current.activeDocId && !switchDoc(hit.docId)) return
    if (mode === 'annotate' && readingMode === 'preview') {
      readingMode = 'split'
      rerender(false)
    }
    editor.scrollToRange(hit.start, hit.end)
  },
  onBatchAnnotate: (targets, kind, comment, replacement) => {
    let total = 0
    workspace.current = {
      ...workspace.current,
      docs: workspace.current.docs.map((d) => {
        const target = targets.find((t) => t.docId === d.id)
        if (!target) return d
        const anns = buildBatchAnnotations(target.matches, { kind, comment, replacement })
        total += anns.length
        return appendAnnotations(d, anns.filter((a) => annotationFits(d, a)))
      }),
    }
    reviewList.includeKind(kind)
    rerender(false)
    toast(`已批量批注 ${total} 处${targets.length > 1 ? `（跨 ${targets.length} 份文档）` : ''}`)
  },
  onClose: () => {
    searchPreview = null
    rerender(false)
  },
}, new Search())

function openSearch(): void {
  if (!activeDoc()) {
    toast('先导入或载入一段文本')
    return
  }
  if (!canLeaveEdit()) return
  if (mode === 'diff') {
    mode = 'annotate'
    rerender(false)
  }
  if (mode === 'annotate' && readingMode === 'preview') {
    readingMode = 'split'
    rerender(false)
  }
  searchPanel.toggle(
    workspace.current.docs.filter(isTextDocument).map((d) => ({ id: d.id, name: d.name, text: d.text })),
    workspace.current.activeDocId,
  )
}

const {runSlopScan, toggleEdit, toggleDiff, clearRevised} = createTextReview({
  get mode() { return mode }, set mode(next) { mode = next }, active: activeDoc, canLeave: canLeaveEdit,
  search: searchPanel, annotation: annotationPopup, selection: selectionPin, presentation,
  render: () => rerender(false), confirm: confirmDialog, textError: textInputError, reports: slopReports, mutate: mutateActive, notify: toast,
})

const actions: Record<WorkspaceAction, () => void> = {
  new: openNewDocument,
  files: () => { if (canLeaveEdit()) pickDocuments() },
  folder: () => { if (canLeaveEdit()) pickFolder() },
  'paste-image': () => { if (canLeaveEdit()) void readClipboardImage().then(files => files.length ? importFiles(files) : toast('剪贴板中没有可导入的图片')).catch(error => toast(error.message)) },
  sample: () => void loadSample(), scan: runSlopScan, edit: toggleEdit, diff: toggleDiff,
  'clear-revised': () => void clearRevised(), export: maybeExport, search: openSearch, trash: openTrash,
  backup: downloadDocumentBackup, recovery: downloadRecoveryBackup,
  restore: () => { if (canLeaveEdit()) pickWorkspace() }, remove: clearCurrent,
  settings: () => void openSettings(), theme: () => setPrefs({...prefs, theme: flipPolarity(prefs.theme)}),
  'legacy-backup': () => { const raw = legacyWorkspaceData(); if (raw !== null) downloadJson(raw, 'inkmark-legacy-workspace.json'); renderChrome() },
  'raw-backup': () => { const raw = unreadableWorkspaceData(); if (raw !== null) downloadJson(raw, 'inkmark-unreadable-workspace.json', '保留了无法解析的原始数据') },
  'reset-storage': () => void resetStorage(),
}
// ---------------------------------------------------------------- 启动

async function bootstrap(): Promise<void> {
  applyPrefs(prefs) // 首渲染前应用阅读偏好（防闪烁脚本已先行设置主题，这里补齐其余维度）
  workspace.current = await loadWorkspace()
  renderChrome()
  ready = true
  save.initialize()
  save.markDirty()
  rerender(false)
  presentation.mount({execute: action => actions[action](), readingMode: setReadingMode, getPrefs: () => prefs, setPrefs})
  document.addEventListener('keydown', event => {
    if (event.isComposing) return
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); openSearch() }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); maybeExport() }
  })
  window.addEventListener('beforeunload', (event) => {
    if (hasUnsavedDrafts()) {
      event.preventDefault()
      event.returnValue = ''
    }
  })
  resolveWorkspaceReady!()
  if (__NATIVE_HOST__) window.nsh?.postMessage('inkmark:ready')

}

void bootstrap()

// 供控制台调试与将来 e2e 使用的只读视图（无可变出口）
return {
  get state(): WorkspaceState { return workspace.current },
  numbers: () => numberAnnotations(activeDoc()?.annotations ?? []),
  blocks: () => splitBlocks(activeDoc()?.text ?? ''),
}

}
