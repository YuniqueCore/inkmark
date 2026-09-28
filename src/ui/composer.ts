/** 批注撰写表单：类型 chips + 快捷语 chips + 批注语 + 建议替换词。
 *
 * 三处宿主共用：划词撰写卡（selection-pin）、⌘F 搜索面板（search-panel）、
 * 批注弹层编辑态（annotation-popup）。
 *
 * 输入法契约：表单内任何输入事件只做定向 DOM 更新（chips on 态），
 * 绝不重绘表单节点 —— 组合输入中替换节点会打断输入法。
 * 表单不管提交按钮与草稿记账：宿主经 onChange / state() / canSubmit() 接线。
 */

import { hasQuickPhrase, KIND_LABEL, MANUAL_KINDS, QUICK_PHRASES, toggleQuickPhrase } from '../core/types'
import type { AnnotationKind } from '../core/types'
import { escapeHtml } from '../core/text'
import { icon } from './icons'

export interface ComposerState {
  kind: AnnotationKind
  comment: string
  replacement: string
}

export interface ComposerCallbacks {
  /** 任意字段变化（宿主据此记账草稿 / 刷新提交按钮态 / 同步徽标） */
  onChange: (state: ComposerState) => void
}

export interface ComposerOptions {
  /** 批注语 textarea 的附加类（尺寸与宿主布局相关） */
  commentClass?: string
}

export class ComposerForm {
  private kind: AnnotationKind
  private comment: string
  private replacement = ''

  constructor(
    private root: HTMLElement,
    private callbacks: ComposerCallbacks,
    initial: Partial<ComposerState> = {},
    private options: ComposerOptions = {},
  ) {
    this.kind = initial.kind ?? 'suggestion'
    this.comment = initial.comment ?? ''
    this.replacement = initial.replacement ?? ''
  }

  state(): ComposerState {
    return { kind: this.kind, comment: this.comment, replacement: this.replacement }
  }

  /** 认可类型允许只划不写；其余类型需要批注语 */
  canSubmit(): boolean {
    return this.comment.trim() !== '' || this.kind === 'praise'
  }

  /** 清空批注语与替换词（类型保留；宿主在提交成功后调用） */
  reset(): void {
    this.comment = ''
    this.replacement = ''
    const comment = this.textarea()
    if (comment) comment.value = ''
    const replacement = this.root.querySelector('[data-role="composer-replacement"]') as HTMLInputElement | null
    if (replacement) replacement.value = ''
    this.syncPhraseStates()
  }

  /** 批注语获取焦点；selectAll = 进入编辑时全选原文，便于整段重写 */
  focusComment(selectAll = false): void {
    const t = this.textarea()
    t?.focus()
    if (selectAll) t?.select()
  }

  /** 批注语或替换词持有焦点（宿主判断卡片是否「正被使用」） */
  isFocused(): boolean {
    const active = document.activeElement
    return (
      active === this.textarea() ||
      active === this.root.querySelector('[data-role="composer-replacement"]')
    )
  }

  render(): void {
    this.root.innerHTML = `
      <div class="mb-2.5 flex flex-wrap gap-1">${MANUAL_KINDS.map(
        (k) =>
          `<button class="chip-toggle kind-chip${this.kind === k ? ' on' : ''}" data-kind="${k}">${icon(k)} ${KIND_LABEL[k]}</button>`,
      ).join('')}</div>
      <div data-role="phrases" class="chip-scroll mb-2.5">${this.phraseChips()}</div>
      <textarea data-role="composer-comment" class="input-base ${this.options.commentClass ?? 'min-h-20 resize-y'}" placeholder="批注内容：点选快捷语或直接输入；认可类型可不写描述……">${escapeHtml(this.comment)}</textarea>
      <input data-role="composer-replacement" class="input-base mt-2 h-8 w-full text-[13px]" placeholder="建议替换词（可选，导出为机器可执行指令）" value="${escapeHtml(this.replacement)}" />`
    this.wire()
  }

  private textarea(): HTMLTextAreaElement | null {
    return this.root.querySelector('[data-role="composer-comment"]')
  }

  private phraseChips(): string {
    return (QUICK_PHRASES[this.kind] ?? [])
      .map(
        (p) =>
          `<button class="chip-toggle phrase-chip ${hasQuickPhrase(this.comment, p) ? 'on' : ''}" data-phrase="${escapeHtml(p)}">${escapeHtml(p)}</button>`,
      )
      .join('')
  }

  private emit(): void {
    this.callbacks.onChange(this.state())
  }

  /** 切换类型后定向更新：kind chips 选中态 + 快捷语整排 + 通知宿主 */
  private setKind(kind: AnnotationKind): void {
    this.kind = kind
    this.root.querySelectorAll('.kind-chip').forEach((c) =>
      c.classList.toggle('on', (c as HTMLElement).dataset.kind === kind),
    )
    const host = this.root.querySelector('[data-role="phrases"]')
    if (host) host.innerHTML = this.phraseChips()
    this.wirePhraseChips()
    this.emit()
  }

  private wire(): void {
    this.root.querySelectorAll('.kind-chip').forEach((chip) =>
      chip.addEventListener('click', () => this.setKind((chip as HTMLElement).dataset.kind as AnnotationKind)),
    )
    this.wirePhraseChips()
    this.textarea()?.addEventListener('input', (e) => {
      // 只同步 chips on 态，不重绘表单（输入法安全）
      this.comment = (e.target as HTMLTextAreaElement).value
      this.syncPhraseStates()
      this.emit()
    })
    this.root
      .querySelector('[data-role="composer-replacement"]')
      ?.addEventListener('input', (e) => {
        this.replacement = (e.target as HTMLInputElement).value
        this.emit()
      })
  }

  private wirePhraseChips(): void {
    this.root.querySelectorAll('[data-role="phrases"] .phrase-chip').forEach((chip) =>
      chip.addEventListener('click', () => {
        this.comment = toggleQuickPhrase(this.comment, (chip as HTMLElement).dataset.phrase ?? '')
        const comment = this.textarea()
        if (comment) comment.value = this.comment
        this.syncPhraseStates()
        this.emit()
      }),
    )
  }

  private syncPhraseStates(): void {
    this.root.querySelectorAll('[data-role="phrases"] .phrase-chip').forEach((c) =>
      c.classList.toggle('on', hasQuickPhrase(this.comment, (c as HTMLElement).dataset.phrase ?? '')),
    )
  }
}
