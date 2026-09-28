/** 搜索与批量批注面板：⌘F 或侧栏搜索按钮唤起的 VSCode 式浮层。
 *
 * 输入法契约：面板内任何输入事件只做定向 DOM 更新（命中计数、按钮态、
 * chips on 态），绝不整体重绘面板 —— 组合输入中替换节点会打断输入法。
 * 正文预览描边经 onQueryChange 交给 main 重渲染编辑器（另一棵子树，安全）。
 */

import { findMatches, type MatchRange } from '../core/batch'
import { escapeHtml } from '../core/text'
import { KIND_LABEL, MANUAL_KINDS, QUICK_PHRASES, hasQuickPhrase, toggleQuickPhrase } from '../core/types'
import type { AnnotationKind } from '../core/types'
import { icon } from './icons'

export interface SearchHit {
  docId: string
  start: number
  end: number
}

export interface BatchTarget {
  docId: string
  matches: MatchRange[]
}

export interface SearchPanelDocs {
  id: string
  name: string
  text: string
}

export interface SearchPanelCallbacks {
  /** 查询变化 → main 更新编辑器预览描边 */
  onQueryChange: (query: string) => void
  /** 跳到第 index 个命中（跨文档时可能切文档） */
  onNavigate: (hit: SearchHit) => void
  onBatchAnnotate: (targets: BatchTarget[], kind: AnnotationKind, comment: string, replacement?: string) => void
  onClose: () => void
}

export class SearchPanelView {
  private el: HTMLElement
  private open = false
  private query = ''
  private kind: AnnotationKind = 'suggestion'
  private comment = ''
  private replacement = ''
  private crossDoc = false
  private navIndex = 0
  private docs: SearchPanelDocs[] = []
  private activeDocId = ''

  constructor(private callbacks: SearchPanelCallbacks) {
    this.el = document.createElement('div')
    this.el.className = 'popover-panel fixed right-4 top-[65px] z-70 hidden w-[min(430px,calc(100vw-16px))]'
    document.body.append(this.el)
  }

  isOpen(): boolean {
    return this.open
  }

  /** 打开 / 关闭（⌘F 与侧栏按钮共用） */
  toggle(docs: SearchPanelDocs[], activeDocId: string): void {
    if (this.open) this.close()
    else this.openPanel(docs, activeDocId)
  }

  openPanel(docs: SearchPanelDocs[], activeDocId: string): void {
    this.open = true
    this.docs = docs
    this.activeDocId = activeDocId
    this.render()
    ;(this.el.querySelector('#sp-input') as HTMLInputElement | null)?.focus()
  }

  close(): void {
    if (!this.open) return
    this.open = false
    this.query = ''
    this.comment = ''
    this.replacement = ''
    this.navIndex = 0
    this.el.classList.add('hidden')
    this.el.innerHTML = ''
    this.callbacks.onClose()
  }

  /** main 重渲染时同步文档集；面板开着就定向刷新计数（不碰输入焦点） */
  setDocs(docs: SearchPanelDocs[], activeDocId: string): void {
    this.docs = docs
    this.activeDocId = activeDocId
    if (this.open) this.refresh()
  }

  // ---------------------------------------------------------------- 数据

  private scopedDocs(): SearchPanelDocs[] {
    return this.crossDoc ? this.docs : this.docs.filter((d) => d.id === this.activeDocId)
  }

  private allHits(): SearchHit[] {
    const hits: SearchHit[] = []
    for (const d of this.scopedDocs()) {
      for (const m of findMatches(d.text, this.query)) hits.push({ docId: d.id, ...m })
    }
    return hits
  }

  private targets(): BatchTarget[] {
    return this.scopedDocs()
      .map((d) => ({ docId: d.id, matches: findMatches(d.text, this.query) }))
      .filter((t) => t.matches.length > 0)
  }

  private canSubmit(): boolean {
    return this.allHits().length > 0 && (this.comment.trim() !== '' || this.kind === 'praise')
  }

  // ---------------------------------------------------------------- 渲染

  private render(): void {
    this.el.classList.remove('hidden')
    this.el.innerHTML = `
      <div class="p-3">
        <div class="flex items-center gap-1.5">
          <span class="text-muted-foreground">${icon('search', 'size-4')}</span>
          <input id="sp-input" class="input-base h-8 min-w-0 flex-1 text-[13px]" placeholder="搜索正文（Enter 下一个，Esc 关闭）…" value="${escapeHtml(this.query)}" />
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
          <div class="flex flex-wrap gap-1">${MANUAL_KINDS.map(
            (k) => `<button class="chip-toggle ${this.kind === k ? 'on' : ''}" data-sp-kind="${k}">${KIND_LABEL[k]}</button>`,
          ).join('')}</div>
          <div id="sp-phrases" class="chip-scroll mt-1.5">${this.phraseChips()}</div>
          <textarea id="sp-comment" class="input-base mt-1.5 min-h-12 resize-y text-[13px]" placeholder="批注内容：点选快捷语或直接输入；认可类型可不写描述……">${escapeHtml(this.comment)}</textarea>
          <input id="sp-replacement" class="input-base mt-1.5 h-8 text-[13px]" placeholder="建议替换词（可选，导出为机器可执行指令）" value="${escapeHtml(this.replacement)}" />
          <div class="mt-2 flex items-center gap-2">
            <label class="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground" title="在整个工作区的所有文档里搜索并批量批注">
              <input type="checkbox" id="sp-cross" class="size-3 accent-[var(--primary)]" ${this.crossDoc ? 'checked' : ''}/>
              跨文档
            </label>
            <button id="sp-submit" class="btn btn-default btn-sm ml-auto"></button>
          </div>
        </div>
      </div>`
    this.wire()
    this.refresh()
  }

  private phraseChips(): string {
    return (QUICK_PHRASES[this.kind] ?? [])
      .map(
        (p) =>
          `<button class="chip-toggle ${hasQuickPhrase(this.comment, p) ? 'on' : ''}" data-sp-phrase="${escapeHtml(p)}">${escapeHtml(p)}</button>`,
      )
      .join('')
  }

  private wire(): void {
    const input = this.el.querySelector('#sp-input') as HTMLInputElement
    input.addEventListener('input', () => {
      // 只更新计数与正文预览，绝不重绘面板（输入法组合安全）
      this.query = input.value
      this.navIndex = 0
      this.callbacks.onQueryChange(this.query)
      this.refresh()
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

    this.el.querySelectorAll('[data-sp-kind]').forEach((chip) =>
      chip.addEventListener('click', () => {
        this.kind = (chip as HTMLElement).dataset.spKind as AnnotationKind
        // 定向更新：kind chips 选中态 + 快捷语整排（不重绘面板）
        this.el.querySelectorAll('[data-sp-kind]').forEach((c) =>
          c.classList.toggle('on', (c as HTMLElement).dataset.spKind === this.kind),
        )
        const host = this.el.querySelector('#sp-phrases')!
        host.innerHTML = this.phraseChips()
        this.wirePhraseChips()
        this.refreshSubmit()
      }),
    )
    this.wirePhraseChips()

    this.el.querySelector('#sp-comment')?.addEventListener('input', (e) => {
      this.comment = (e.target as HTMLTextAreaElement).value
      // 只同步 chips on 态与提交态，不重绘（输入法安全）
      const value = this.comment
      this.el.querySelectorAll('[data-sp-phrase]').forEach((c) =>
        c.classList.toggle('on', hasQuickPhrase(value, (c as HTMLElement).dataset.spPhrase ?? '')),
      )
      this.refreshSubmit()
    })
    this.el.querySelector('#sp-replacement')?.addEventListener('input', (e) => {
      this.replacement = (e.target as HTMLInputElement).value
    })
    this.el.querySelector('#sp-cross')?.addEventListener('change', (e) => {
      this.crossDoc = (e.target as HTMLInputElement).checked
      this.navIndex = 0
      this.refresh()
    })
    this.el.querySelector('#sp-submit')?.addEventListener('click', () => {
      if (!this.canSubmit()) return
      this.callbacks.onBatchAnnotate(
        this.targets(),
        this.kind,
        this.comment.trim(),
        this.replacement.trim() || undefined,
      )
      this.close()
    })
  }

  private wirePhraseChips(): void {
    this.el.querySelectorAll('[data-sp-phrase]').forEach((chip) =>
      chip.addEventListener('click', () => {
        this.comment = toggleQuickPhrase(this.comment, (chip as HTMLElement).dataset.spPhrase ?? '')
        const comment = this.el.querySelector('#sp-comment') as HTMLTextAreaElement | null
        if (comment) comment.value = this.comment
        this.el.querySelectorAll('[data-sp-phrase]').forEach((c) =>
          c.classList.toggle('on', hasQuickPhrase(this.comment, (c as HTMLElement).dataset.spPhrase ?? '')),
        )
        this.refreshSubmit()
      }),
    )
  }

  private navigate(delta: number): void {
    const hits = this.allHits()
    if (hits.length === 0) return
    this.navIndex = (this.navIndex + delta + hits.length) % hits.length
    this.refresh()
    this.callbacks.onNavigate(hits[this.navIndex]!)
  }

  /** 定向刷新：命中计数 / 导航可用态 / 提交按钮（不重绘面板、不碰焦点） */
  private refresh(): void {
    const hits = this.allHits()
    const count = this.el.querySelector('#sp-count')
    if (count) count.textContent = this.query.trim() === '' ? '' : `命中 ${hits.length} 处`
    const prev = this.el.querySelector('#sp-prev') as HTMLButtonElement | null
    const next = this.el.querySelector('#sp-next') as HTMLButtonElement | null
    if (prev && next) {
      prev.disabled = next.disabled = hits.length === 0
    }
    const body = this.el.querySelector('#sp-body') as HTMLElement | null
    if (body) body.style.display = this.query.trim() === '' ? 'none' : ''
    this.refreshSubmit()
  }

  private refreshSubmit(): void {
    const submit = this.el.querySelector('#sp-submit') as HTMLButtonElement | null
    if (!submit) return
    const total = this.allHits().length
    submit.textContent = `批量批注 ${total} 处`
    submit.disabled = !this.canSubmit()
  }
}
