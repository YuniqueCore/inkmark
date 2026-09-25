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
  // node 自身内部的字符前缀：文本节点取 offset；元素节点取前导子节点的文本长度
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
  // 遍历块内 DOM：命中目标节点时累加其内部前缀；包含目标的容器递归进入；
  // 其余兄弟按整段文本长度累加。<br> 由 textLengthOf 计 1，与规范文本的 \n 对应。
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

// 暗色切换
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
    el.className =
      'toast pointer-events-none fixed bottom-6 left-1/2 z-200 -translate-x-1/2 rounded-md border bg-primary px-3.5 py-2 text-sm text-primary-foreground shadow-lg opacity-0 transition-opacity duration-200'
    document.body.append(el)
  }
  el.textContent = message
  el.classList.add('opacity-95')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el!.classList.remove('opacity-95'), 1800)
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
