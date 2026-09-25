/** 应用装配：状态、事件接线、持久化。UI 模块各自只管画。 */

import { numberAnnotations } from './core/export'
import { splitBlocks } from './core/text'
import { hitsToAnnotations, scanSlop } from './core/slop'
import type { Annotation, AnnotationInput, SlopLexicon } from './core/types'
import { EditorView } from './ui/editor'
import { ExporterView } from './ui/exporter'
import { SAMPLE_TEXT } from './ui/sample'
import { SidebarView } from './ui/sidebar'
import { SelectionController, type SelectionInfo } from './ui/selection'
import { clearSession, loadSession, saveSession } from './ui/storage'
import zhLexicon from './lexicons/zh.json'
import enLexicon from './lexicons/en.json'

const LEXICONS = [zhLexicon, enLexicon] as unknown as SlopLexicon[]

// ---------------------------------------------------------------- 状态

interface AppState {
  text: string
  annotations: Annotation[]
}

let state: AppState = { text: '', annotations: [] }

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector(sel)
  if (!el) throw new Error(`missing element: ${sel}`)
  return el as T
}

const editorEl = $('#editor')
const sidebarEl = $('#sidebar')
const editor = new EditorView(editorEl, {
  onSelectionChange: () => selection.handleSelection(),
  onAnnotationClick: (id) => focusAnnotation(id),
})
const sidebar = new SidebarView(sidebarEl, {
  onFocus: (id) => focusAnnotation(id),
  onEdit: (a) => {
    const rect = rectOfAnnotation(a.id)
    if (!rect) return
    selection.openComposerFor({ start: a.start, end: a.end, rect, quoted: '' }, a.kind, a.comment, a.id)
  },
  onDelete: (id) => {
    state.annotations = state.annotations.filter((a) => a.id !== id)
    rerender()
  },
  onToggleStatus: (id) => {
    state.annotations = state.annotations.map((a) =>
      a.id === id ? { ...a, status: a.status === 'open' ? 'resolved' : 'open', updatedAt: Date.now() } : a,
    )
    rerender()
  },
  onFilterChange: (f) => {
    sidebar.setFilter(f)
    rerender()
  },
})
const exporter = new ExporterView($('#export-modal'), $('#overlay'), {
  onCopy: (content) => {
    void navigator.clipboard.writeText(content).then(() => toast('已复制到剪贴板'))
  },
  onClose: () => {},
})

// ---------------------------------------------------------------- 选区 → 偏移

/** 把 DOM 选区换算成规范文本偏移。选区不在编辑区内返回 null。 */
function resolveSelection(): SelectionInfo | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null
  const range = sel.getRangeAt(0)
  if (!editorEl.contains(range.commonAncestorContainer)) return null

  const start = domPointToOffset(range.startContainer, range.startOffset)
  const end = domPointToOffset(range.endContainer, range.endOffset)
  if (start === null || end === null || end <= start) return null
  const text = state.text.slice(start, end)
  if (text.trim() === '') return null
  return { start, end, rect: range.getBoundingClientRect(), quoted: text }
}

/** DOM 位置 → 规范文本偏移。 */
function domPointToOffset(node: Node, offset: number): number | null {
  const blk = (node.nodeType === Node.TEXT_NODE ? node.parentElement : node as HTMLElement)?.closest('.blk') as HTMLElement | null
  if (!blk) return null
  const blockStart = Number(blk.dataset.start ?? 0)
  let domOffset = offset
  if (node.nodeType === Node.ELEMENT_NODE) {
    // 元素节点：offset 指子节点序号，换算为其中文本长度
    domOffset = Array.from(node.childNodes)
      .slice(0, offset)
      .reduce((acc, child) => acc + textLengthOf(child), 0)
  }
  let acc = 0
  let result: number | null = null
  const walk = (n: Node): void => {
    if (result !== null) return
    if (n === node) {
      result = acc + domOffset
      return
    }
    acc += textLengthOf(n)
    for (const child of Array.from(n.childNodes)) walk(child)
  }
  walk(blk)
  // walk 结果是块内相对偏移，加上块起点才是规范文本坐标
  return result === null ? null : blockStart + result
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

// ---------------------------------------------------------------- 批注操作

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
  state.annotations = [...state.annotations, ann]
  rerender()
}

function focusAnnotation(id: string): void {
  sidebar.setActive(id)
  rerender()
  editor.focusAnnotation(id)
}

function rerender(): void {
  editor.render(state.text, state.annotations, loadSample)
  sidebar.render(state.text, state.annotations)
  scheduleSave()
}

// ---------------------------------------------------------------- 持久化

let saveTimer: ReturnType<typeof setTimeout> | undefined
function scheduleSave(): void {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveSession({ version: 1, text: state.text, annotations: state.annotations, savedAt: Date.now() })
  }, 400)
}

// ---------------------------------------------------------------- 工具条 / 弹层

const selection = new SelectionController({
  resolveSelection,
  onCreate: (info, kind, comment) => {
    if (selection.editing) {
      // 编辑模式：覆盖原批注的 kind / comment（范围不变）
      state.annotations = state.annotations.map((a) =>
        a.id === selection.editing
          ? { ...a, kind, comment, updatedAt: Date.now() }
          : a,
      )
      rerender()
      return
    }
    addAnnotation({ start: info.start, end: info.end, kind, comment })
  },
  onCopySelection: (quoted) => {
    void navigator.clipboard.writeText(quoted).then(() => toast('已复制选中文本'))
  },
})

// ---------------------------------------------------------------- slop 预扫描

function runSlopScan(): void {
  if (state.text.trim() === '') {
    toast('先载入一段文本')
    return
  }
  const existing = new Set(state.annotations.filter((a) => a.source === 'slop').map((a) => `${a.start}:${a.end}`))
  const hits = scanSlop(state.text, LEXICONS).filter((h) => !existing.has(`${h.start}:${h.end}`))
  const anns = hitsToAnnotations(hits)
  state.annotations = [...state.annotations, ...anns]
  rerender()
  toast(anns.length === 0 ? '没有发现新的候选信号' : `新增 ${anns.length} 条 slop 候选批注`)
}

// ---------------------------------------------------------------- 顶栏动作

function loadSample(): void {
  state = { text: SAMPLE_TEXT, annotations: [] }
  rerender()
}

async function loadFile(file: File): Promise<void> {
  const text = await file.text()
  state = { text, annotations: [] }
  rerender()
  toast(`已载入 ${file.name}`)
}

async function importSessionFile(file: File): Promise<void> {
  try {
    const parsed = JSON.parse(await file.text()) as { text?: string; annotations?: Annotation[] }
    if (typeof parsed.text !== 'string' || !Array.isArray(parsed.annotations)) throw new Error('bad shape')
    state = { text: parsed.text, annotations: parsed.annotations }
    rerender()
    toast('会话已导入')
  } catch {
    toast('导入失败：不是有效的 InkMark 会话文件')
  }
}

function maybeExport(): void {
  if (state.annotations.length === 0) {
    toast('还没有批注：划选正文文字，或运行 slop 预扫描')
    return
  }
  exporter.open(state.text, state.annotations)
}

async function clearAll(): Promise<void> {
  if (state.text === '') return
  const ok = window.confirm('清空文本与全部批注？此操作不可撤销（可先在导出里下载 .md）。')
  if (!ok) return
  state = { text: '', annotations: [] }
  clearSession()
  rerender()
}

$('#btn-sample').addEventListener('click', loadSample)
$('#btn-load').addEventListener('click', () => $('#file-input').click())
$('#file-input').addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (file.name.endsWith('.json')) void importSessionFile(file)
  else void loadFile(file)
  ;(e.target as HTMLInputElement).value = ''
})
$('#btn-scan').addEventListener('click', runSlopScan)
$('#btn-export').addEventListener('click', maybeExport)
$('#btn-clear').addEventListener('click', () => void clearAll())
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
    el.className = 'toast'
    document.body.append(el)
  }
  el.textContent = message
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el!.classList.remove('show'), 1800)
}

// ---------------------------------------------------------------- 启动

function bootstrap(): void {
  const saved = loadSession()
  if (saved && saved.text.trim() !== '') {
    state = { text: saved.text, annotations: saved.annotations }
  }
  rerender()
}

bootstrap()

// 供控制台调试与将来 e2e 使用的只读视图（无可变出口）
export const __debug = {
  get state(): AppState { return state },
  numbers: () => numberAnnotations(state.annotations),
  blocks: () => splitBlocks(state.text),
}
