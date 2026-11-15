/** 搜索与批量批注面板：⌘F 或侧栏搜索按钮唤起的 VSCode 式浮层。
 *
 * 面板只管搜索本身：查询输入、Aa 大小写、.* 正则、命中导航与批量提交；
 * 撰写表单（类型 / 快捷语 / 批注语 / 替换词）由 ComposerForm 内嵌提供，
 * 与划词撰写卡、批注弹层编辑态共用同一组件。
 *
 * 输入法契约：面板内任何输入事件只做定向 DOM 更新（命中计数、按钮态、
 * toggle 选中态），绝不整体重绘面板 —— 组合输入中替换节点会打断输入法。
 * 正文预览描边经 onQueryChange 交给 main 重渲染编辑器（另一棵子树，安全）。
 */

import type { MatchOptions } from '../core/batch'
import { escapeHtml } from '../core/text'
import type { AnnotationKind } from '../core/types'
import { icon } from './icons'
import { ComposerForm } from './composer'

import {Search, type SearchHit, type BatchTarget, type SearchDocument} from '../workbench/search'

export interface SearchPanelCallbacks {
  /** 查询或匹配方式变化 → main 更新编辑器预览描边 */
  onQueryChange: (query: string, match: MatchOptions) => void
  /** 跳到第 index 个命中（跨文档时可能切文档） */
  onNavigate: (hit: SearchHit) => void
  onBatchAnnotate: (targets: BatchTarget[], kind: AnnotationKind, comment: string, replacement?: string) => void
  onClose: () => void
}

/** VSCode 式开关按钮的选中态（与顶栏模式按钮同款高亮） */
const TOGGLE_ON = 'bg-secondary text-secondary-foreground'

export class SearchPanelView {
  private el: HTMLElement
  private open = false
  /** ComposerForm 每次打开重建；lastKind 记住上次选择的类型 */
  private lastKind: AnnotationKind = 'suggestion'
  private composer: ComposerForm | null = null
  constructor(private callbacks: SearchPanelCallbacks, private model: Search) {
    this.el = document.createElement('div')
    this.el.className = 'popover-panel search-panel fixed right-4 top-[65px] z-70 hidden w-[min(430px,calc(100vw-16px))]'
    document.body.append(this.el)
  }

  hasDraft(): boolean {
    const state = this.composer?.state()
    return this.open && Boolean(state && (state.comment.trim() || state.replacement.trim()))
  }

  isOpen(): boolean {
    return this.open
  }

  /** 打开 / 关闭（⌘F 与侧栏按钮共用） */
  toggle(docs: SearchDocument[], activeDocId: string): void {
    if (this.open) this.close()
    else this.openPanel(docs, activeDocId)
  }

  openPanel(docs: SearchDocument[], activeDocId: string): void {
    this.open = true
    this.model.docs = docs
    this.model.activeDocId = activeDocId
    this.render()
    ;(this.el.querySelector('#sp-input') as HTMLInputElement | null)?.focus()
  }

  close(): void {
    if (!this.open) return
    this.open = false
    this.model.query = ''
    this.model.navIndex = -1
    this.composer = null
    this.el.classList.add('hidden')
    this.el.innerHTML = ''
    this.callbacks.onClose()
  }

  /** main 重渲染时同步文档集；面板开着就定向刷新计数（不碰输入焦点） */
  setDocs(docs: SearchDocument[], activeDocId: string): void {
    this.model.docs = docs
    this.model.activeDocId = activeDocId
    if (this.open) this.refresh()
  }

  // ---------------------------------------------------------------- 数据

  private canSubmit(): boolean {
    return this.model.hits().length > 0 && (this.composer?.canSubmit() ?? false)
  }

  // ---------------------------------------------------------------- 渲染

  private render(): void {
    this.el.classList.remove('hidden')
    this.el.innerHTML = `
      <div class="p-3">
        <div class="flex items-center gap-1.5">
          <span class="text-muted-foreground">${icon('search', 'size-4')}</span>
          <input id="sp-input" class="input-base h-8 min-w-0 flex-1 text-[13px]" placeholder="搜索正文（Enter 下一个，Esc 关闭）…" value="${escapeHtml(this.model.query)}" />
          <button id="sp-case" class="btn btn-ghost btn-sm h-7 w-7 p-0 text-[11px] font-semibold ${this.model.caseSensitive ? TOGGLE_ON : ''}" title="区分大小写" aria-pressed="${this.model.caseSensitive}">Aa</button>
          <button id="sp-regex" class="btn btn-ghost btn-sm h-7 w-7 p-0 text-[11px] font-semibold ${this.model.useRegex ? TOGGLE_ON : ''}" title="使用正则表达式" aria-pressed="${this.model.useRegex}">.*</button>
          <button id="sp-close" class="btn btn-ghost btn-sm h-7 w-7 p-0" title="关闭 (Esc)" aria-label="关闭搜索">${icon('x', 'size-3.5')}</button>
        </div>
        <div class="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
          <span id="sp-count"></span>
          <span class="ml-auto flex gap-0.5">
            <button id="sp-prev" class="btn btn-ghost btn-sm h-6 px-1.5 text-xs" title="上一个">‹</button>
            <button id="sp-next" class="btn btn-ghost btn-sm h-6 px-1.5 text-xs" title="下一个">›</button>
          </span>
        </div>
        <div id="sp-body" class="mt-2 border-t border-border pt-2">
          <div data-sp-composer></div>
          <div class="mt-2 flex items-center gap-2">
            <label class="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground" title="在整个工作区的所有文档里搜索并批量批注">
              <input type="checkbox" id="sp-cross" class="size-3 accent-[var(--primary)]" ${this.model.crossDoc ? 'checked' : ''}/>
              跨文档
            </label>
            <button id="sp-submit" class="btn btn-default btn-sm ml-auto"></button>
          </div>
        </div>
      </div>`
    this.composer = new ComposerForm(
      this.el.querySelector('[data-sp-composer]') as HTMLElement,
      {onChange: (s) => {
        this.lastKind = s.kind
        this.refreshSubmit()
      }},
      {kind: this.lastKind},
    )
    this.composer.render()
    this.wire()
    this.refresh()
  }

  private wire(): void {
    const input = this.el.querySelector('#sp-input') as HTMLInputElement
    input.addEventListener('input', () => {
      // 只更新计数与正文预览，绝不重绘面板（输入法组合安全）
      this.model.query = input.value
      this.afterMatchChange()
    })
    input.addEventListener('keydown', (e) => {
      if (e.isComposing) return
      if (e.key === 'Enter') {
        e.preventDefault()
        this.navigate(1)
      }
      if (e.key === 'Escape') {
        e.stopPropagation()
        this.close()
      }
    })
    this.el.querySelector('#sp-close')?.addEventListener('click', () => this.close())
    this.el.querySelector('#sp-prev')?.addEventListener('click', () => this.navigate(-1))
    this.el.querySelector('#sp-next')?.addEventListener('click', () => this.navigate(1))
    this.el.querySelector('#sp-case')?.addEventListener('click', () => {
      this.model.caseSensitive = !this.model.caseSensitive
      this.syncToggle('#sp-case', this.model.caseSensitive)
      this.afterMatchChange()
    })
    this.el.querySelector('#sp-regex')?.addEventListener('click', () => {
      this.model.useRegex = !this.model.useRegex
      this.syncToggle('#sp-regex', this.model.useRegex)
      this.afterMatchChange()
    })
    this.el.querySelector('#sp-cross')?.addEventListener('change', (e) => {
      this.model.crossDoc = (e.target as HTMLInputElement).checked
      this.model.navIndex = -1
      this.refresh()
    })
    this.el.querySelector('#sp-submit')?.addEventListener('click', () => {
      if (!this.composer || !this.canSubmit()) return
      const s = this.composer.state()
      this.callbacks.onBatchAnnotate(
        this.model.targets(),
        s.kind,
        s.comment.trim(),
        s.replacement.trim() || undefined,
      )
      this.close()
    })
  }

  /** 匹配方式或查询变化：重置导航、同步预览描边与命中计数 */
  private afterMatchChange(): void {
    this.model.navIndex = -1
    this.callbacks.onQueryChange(this.model.query, this.model.options())
    this.refresh()
  }

  private syncToggle(sel: string, on: boolean): void {
    const btn = this.el.querySelector(sel) as HTMLButtonElement | null
    if (!btn) return
    btn.classList.toggle('bg-secondary', on)
    btn.classList.toggle('text-secondary-foreground', on)
    btn.setAttribute('aria-pressed', String(on))
  }

  private navigate(delta: 1 | -1): void {
    const hit = this.model.navigate(delta)
    if (!hit) return
    this.refresh()
    this.callbacks.onNavigate(hit)
  }

  /** 定向刷新：命中计数 / 导航可用态 / 提交按钮（不重绘面板、不碰焦点） */
  private refresh(): void {
    const invalid = this.model.invalid()
    const hits = this.model.hits()
    const count = this.el.querySelector('#sp-count')
    if (count) {
      count.textContent =
        this.model.query.trim() === '' ? '' : invalid ? '正则无效' : `命中 ${hits.length} 处`
    }
    const input = this.el.querySelector('#sp-input') as HTMLInputElement | null
    if (input) input.classList.toggle('text-destructive', invalid)
    const prev = this.el.querySelector('#sp-prev') as HTMLButtonElement | null
    const next = this.el.querySelector('#sp-next') as HTMLButtonElement | null
    if (prev && next) {
      prev.disabled = next.disabled = hits.length === 0
    }
    const body = this.el.querySelector('#sp-body') as HTMLElement | null
    if (body) body.style.display = this.model.query.trim() === '' ? 'none' : ''
    this.refreshSubmit()
  }

  private refreshSubmit(): void {
    const submit = this.el.querySelector('#sp-submit') as HTMLButtonElement | null
    if (!submit || !this.composer) return
    submit.textContent = `批量批注 ${this.model.hits().length} 处`
    submit.disabled = !this.canSubmit()
  }
}
