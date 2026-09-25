/** 应用装配：多文档工作区状态、事件接线、持久化。UI 模块各自只管画。 */

import { numberAnnotations } from './core/export'
import { splitBlocks } from './core/text'
import { hitsToAnnotations, scanSlop } from './core/slop'
import { EditorView } from './ui/editor'
import { ExporterView } from './ui/exporter'
import { FileTreeView } from './ui/filetree'
import { AnnotationPopup } from './ui/annotation-popup'
import { SelectionPin, type SelectionInfo } from './ui/selection-pin'
import { SidebarView } from './ui/sidebar'
import { SAMPLE_TEXT } from './ui/sample'
import type { Annotation, AnnotationInput, DocItem, SlopLexicon, Workspace } from './core/types'
import { loadWorkspace, saveWorkspace } from './ui/storage'
import zhLexicon from './lexicons/zh.json'
import enLexicon from './lexicons/en.json'

const LEXICONS = [zhLexicon, enLexicon] as unknown as SlopLexicon[]
const TEXT_SUFFIX = /\.(txt|md|markdown)$/i
const MAX_DOC_CHARS = 400_000 // 单文档上限，超出截断并提示

// ---------------------------------------------------------------- 状态

interface AppState {
  docs: DocItem[]
  activeDocId: string
}

let state: AppState = { docs: [], activeDocId: '' }
/** 筛选透镜：正文高亮与侧栏列表共用 */
let onlyHighlightFiltered = false

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
    const info = resolveSelection(e)
    if (info) selectionPin.showFor(info)
    else selectionPin.dismiss()
  },
  onAnnotationClick: (id, rect) => {
    const doc = activeDoc()
    if (!doc) return
    annotationPopup.setAnchorRect(rect)
    // 点击高亮直接进入编辑态
    annotationPopup.openFor(id, doc.text, doc.annotations, true)
    sidebar.setActive(id)
    rerender(false)
  },
})

const annotationPopup = new AnnotationPopup({
  onUpdate: (id, kind, comment) => {
    mutateActive((doc) => ({
      ...doc,
      annotations: doc.annotations.map((a) =>
        a.id === id ? { ...a, kind, comment, updatedAt: Date.now() } : a,
      ),
    }))
  },
  onDelete: (id) => {
    mutateActive((doc) => ({ ...doc, annotations: doc.annotations.filter((a) => a.id !== id) }))
  },
  onToggleStatus: (id) => {
    mutateActive((doc) => ({
      ...doc,
      annotations: doc.annotations.map((a) =>
        a.id === id ? { ...a, status: a.status === 'open' ? 'resolved' : 'open', updatedAt: Date.now() } : a,
      ),
    }))
  },
  onCopySnippet: (text) => {
    void navigator.clipboard.writeText(text).then(() => toast('已复制片段'))
  },
})

const selectionPin = new SelectionPin({
  onCreate: (info, kind, comment) => {
    addAnnotation({ start: info.start, end: info.end, kind, comment })
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
    sidebar.setActive(id)
    rerender(false)
    editor.focusAnnotation(id)
  },
  onEdit: (a) => {
    editor.focusAnnotation(a.id)
    const rect = rectOfAnnotation(a.id)
    if (!rect) return
    annotationPopup.setAnchorRect(rect)
    annotationPopup.openFor(a.id, activeDoc()!.text, activeDoc()!.annotations, true)
    sidebar.setActive(a.id)
  },
  onDelete: (id) => {
    mutateActive((doc) => ({ ...doc, annotations: doc.annotations.filter((a) => a.id !== id) }))
  },
  onToggleStatus: (id) => {
    mutateActive((doc) => ({
      ...doc,
      annotations: doc.annotations.map((a) =>
        a.id === id ? { ...a, status: a.status === 'open' ? 'resolved' : 'open', updatedAt: Date.now() } : a,
      ),
    }))
  },
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
  onRemove: (id) => removeDoc(id),
})

const exporter = new ExporterView($('#export-modal'), $('#overlay'), {
  onCopy: (content) => {
    void navigator.clipboard.writeText(content).then(() => toast('已复制到剪贴板'))
  },
  onClose: () => {},
})

// ---------------------------------------------------------------- 选区 → 偏移

/** 把 DOM 选区换算成规范文本偏移。选区不在编辑区内返回 null。 */
function resolveSelection(e: MouseEvent): SelectionInfo | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null
  const range = sel.getRangeAt(0)
  if (!editorEl.contains(range.commonAncestorContainer)) return null

  const start = domPointToOffset(range.startContainer, range.startOffset)
  const end = domPointToOffset(range.endContainer, range.endOffset)
  if (start === null || end === null || end <= start) return null
  const doc = activeDoc()
  if (!doc) return null
  const text = doc.text.slice(start, end)
  if (text.trim() === '') return null
  return {
    start,
    end,
    rect: range.getBoundingClientRect(),
    quoted: text,
    mouse: { x: e.clientX, y: e.clientY },
  }
}

/** DOM 位置 → 规范文本偏移。 */
function domPointToOffset(node: Node, offset: number): number | null {
  const blk = (node.nodeType === Node.TEXT_NODE ? node.parentElement : node as HTMLElement)?.closest('.editor-blk') as HTMLElement | null
  if (!blk) return null
  const blockStart = Number(blk.dataset.start ?? 0)
  const innerPrefix = (): number => {
    if (node.nodeType === Node.TEXT_NODE) return offset
    return Array.from(node.childNodes)
      .slice(0, offset)
      .reduce((acc, child) => acc + textLengthOf(child), 0)
  }
  if (node === blk) {
    const acc = Array.from(blk.childNodes)
      .slice(0, offset)
      .reduce((a, c) => a + textLengthOf(c), 0)
    return blockStart + acc
  }
  let acc = 0
  let found = false
  const visit = (n: Node): void => {
    if (found) return
    for (const child of Array.from(n.childNodes)) {
      if (found) return
      if (child === node) {
        acc += innerPrefix()
        found = true
        return
      }
      if (child.contains(node)) {
        visit(child)
      } else {
        acc += textLengthOf(child)
      }
    }
  }
  visit(blk)
  return found ? blockStart + acc : null
}

function textLengthOf(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length ?? 0
  // <br> 计 1 个字符（与规范文本里的 \n 对应）
  if ((node as HTMLElement).tagName === 'BR') return 1
  return Array.from(node.childNodes).reduce((a, c) => a + textLengthOf(c), 0)
}

function rectOfAnnotation(id: string): DOMRect | null {
  const el = editorEl.querySelector(`.seg-hl[data-ann-ids~="${id}"]`) as HTMLElement | null
  return el?.getBoundingClientRect() ?? null
}

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
  selectionPin.dismiss()
  annotationPopup.close()
  rerender(false)
}

function removeDoc(id: string): void {
  const doc = state.docs.find((d) => d.id === id)
  if (!doc) return
  const count = doc.annotations.length
  const ok = window.confirm(
    count > 0
      ? `移除「${doc.name}」？其中 ${count} 条批注会一并删除。`
      : `移除「${doc.name}」？`,
  )
  if (!ok) return
  const docs = state.docs.filter((d) => d.id !== id)
  state = {
    docs,
    activeDocId: state.activeDocId === id ? (docs[0]?.id ?? '') : state.activeDocId,
  }
  if (state.activeDocId === '') selectionPin.dismiss()
  annotationPopup.close()
  rerender(false)
  toast(`已移除 ${doc.name}`)
}

// ---------------------------------------------------------------- 渲染

function rerender(syncPopup = true): void {
  const doc = activeDoc()
  editor.render(doc?.text ?? '', editorAnnotations(), loadSample)
  sidebar.render(doc?.text ?? '', doc?.annotations ?? [])
  fileTree.render(state.docs, state.activeDocId)
  if (syncPopup && doc) annotationPopup.sync(doc.text, doc.annotations)
  markDirty()
}

// ---------------------------------------------------------------- 保存状态

type SaveStatus = 'saved' | 'dirty' | 'saving'
let saveStatus: SaveStatus = 'saved'
let saveTimer: ReturnType<typeof setTimeout> | undefined

function markDirty(): void {
  saveStatus = 'dirty'
  renderSaveStatus()
  clearTimeout(saveTimer)
  saveTimer = setTimeout(flushSave, 500)
}

function flushSave(): void {
  clearTimeout(saveTimer)
  saveStatus = 'saving'
  renderSaveStatus()
  saveWorkspace({
    version: 2,
    docs: state.docs,
    activeDocId: state.activeDocId,
    savedAt: Date.now(),
  })
  setTimeout(() => {
    saveStatus = 'saved'
    renderSaveStatus()
  }, 150)
}

function renderSaveStatus(): void {
  const dot = $('#save-dot')
  const label = $('#save-text')
  const map: Record<SaveStatus, {cls: string; text: string}> = {
    saved: {cls: 'bg-emerald-500', text: '已保存'},
    dirty: {cls: 'bg-amber-500', text: '有未保存改动'},
    saving: {cls: 'bg-sky-400 animate-pulse', text: '保存中…'},
  }
  const s = map[saveStatus]
  dot.className = `size-1.5 rounded-full ${s.cls}`
  label.textContent = s.text
}

window.addEventListener('beforeunload', (e) => {
  if (saveStatus === 'dirty') {
    flushSave()
    e.preventDefault()
  }
})

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
  const hits = scanSlop(doc.text, LEXICONS).filter((h) => !existing.has(`${h.start}:${h.end}`))
  const anns = hitsToAnnotations(hits)
  mutateActive((d) => ({ ...d, annotations: [...d.annotations, ...anns] }))
  toast(anns.length === 0 ? '没有发现新的候选信号' : `新增 ${anns.length} 条 slop 候选批注`)
}

// ---------------------------------------------------------------- 文档导入

async function importFiles(files: FileList | File[]): Promise<void> {
  const list = Array.from(files)
  const newDocs: DocItem[] = []
  let truncated = 0
  let skipped = 0
  for (const file of list) {
    const rel = (file as File & {webkitRelativePath?: string}).webkitRelativePath ?? ''
    if (file.name.endsWith('.json')) {
      if (await importSessionFile(file)) continue
      skipped++
      continue
    }
    if (!TEXT_SUFFIX.test(file.name)) {
      skipped++
      continue
    }
    let text = await file.text()
    if (text.length > MAX_DOC_CHARS) {
      text = text.slice(0, MAX_DOC_CHARS)
      truncated++
    }
    if (text.trim() === '') {
      skipped++
      continue
    }
    newDocs.push({
      id: `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name: file.name,
      path: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '',
      text,
      annotations: [],
      addedAt: Date.now(),
    })
  }
  if (newDocs.length === 0) {
    toast(skipped > 0 ? `没有可导入的文本文件（跳过 ${skipped} 个）` : '没有可导入的文件')
    return
  }
  state = {
    docs: [...state.docs, ...newDocs],
    activeDocId: newDocs[0]!.id,
  }
  rerender(false)
  const parts = [`导入 ${newDocs.length} 个文档`]
  if (skipped > 0) parts.push(`跳过 ${skipped}`)
  if (truncated > 0) parts.push(`${truncated} 个超大文件已截断`)
  toast(parts.join('，'))
}

async function importSessionFile(file: File): Promise<boolean> {
  try {
    const parsed = JSON.parse(await file.text()) as Partial<Workspace>
    if (parsed.version !== 2 || !Array.isArray(parsed.docs)) return false
    state = {docs: [...state.docs, ...parsed.docs], activeDocId: parsed.docs[0]?.id ?? state.activeDocId}
    rerender(false)
    toast(`会话已合并（${parsed.docs.length} 个文档）`)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------- 顶栏动作

function loadSample(): void {
  const doc: DocItem = {
    id: `doc-${Date.now().toString(36)}`,
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
  exporter.open(doc.text, doc.annotations)
}

function clearCurrent(): void {
  const doc = activeDoc()
  if (!doc) return
  removeDoc(doc.id)
}

// 侧栏 / 文档树收起
function togglePanel(which: 'tree' | 'sidebar'): void {
  const layout = $('#layout')
  const tree = $('#filetree')
  const side = $('#sidebar')
  const cols = {
    both: 'grid h-[calc(100vh-57px)] grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)_380px]',
    treeOnly: 'grid h-[calc(100vh-57px)] grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)]',
    sideOnly: 'grid h-[calc(100vh-57px)] grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px]',
    none: 'grid h-[calc(100vh-57px)] grid-cols-1',
  }
  let mode: keyof typeof cols
  if (which === 'tree') {
    const off = tree.classList.toggle('hidden')
    mode = off ? 'treeOnly' : 'both'
  } else {
    const off = side.classList.toggle('hidden')
    mode = off ? 'sideOnly' : 'both'
  }
  if (tree.classList.contains('hidden') && side.classList.contains('hidden')) mode = 'none'
  layout.className = cols[mode]
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
$('#btn-export').addEventListener('click', maybeExport)
$('#btn-clear').addEventListener('click', clearCurrent)
$('#btn-tree').addEventListener('click', () => togglePanel('tree'))
$('#btn-sidebar').addEventListener('click', () => togglePanel('sidebar'))
$('#overlay').addEventListener('click', () => exporter.close())
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault()
    maybeExport()
  }
})

// ---------------------------------------------------------------- toast

let toastTimer: ReturnType<typeof setTimeout> | undefined
function toast(message: string): void {
  let el = document.querySelector('.toast') as HTMLElement | null
  if (!el) {
    el = document.createElement('div')
    el.className =
      'toast pointer-events-none fixed bottom-6 left-1/2 z-200 -translate-x-1/2 rounded-md border bg-primary px-3.5 py-2 text-sm text-primary-foreground shadow-lg opacity-0 transition-opacity duration-200'
    document.body.append(el)
  }
  el.textContent = message
  el.classList.add('opacity-95')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el!.classList.remove('opacity-95'), 1800)
}

// ---------------------------------------------------------------- 主题

const THEME_KEY = 'inkmark:theme'
function applyThemeButton(): void {
  const dark = document.documentElement.classList.contains('dark')
  $('#btn-theme').innerHTML = dark
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-4"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-4"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`
}
$('#btn-theme').addEventListener('click', () => {
  const dark = document.documentElement.classList.toggle('dark')
  localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light')
  applyThemeButton()
})
applyThemeButton()

// ---------------------------------------------------------------- 启动

function bootstrap(): void {
  state = loadWorkspace()
  rerender(false)
  renderSaveStatus()
}

bootstrap()

// 供控制台调试与将来 e2e 使用的只读视图（无可变出口）
export const __debug = {
  get state(): AppState { return state },
  numbers: () => numberAnnotations(activeDoc()?.annotations ?? []),
  blocks: () => splitBlocks(activeDoc()?.text ?? ''),
}
