/** 二次确认弹层（shadcn AlertDialog 语汇）：所有破坏性操作的统一关口。
 *
 * 用法：const ok = await confirmDialog({title: '删除这条批注？', danger: true})
 * Promise<boolean>；Esc / 点遮罩 / 取消 → false；确认 / Enter → true。
 * 键盘监听走捕获阶段并阻断传播，避免同时触发底层组件的 Esc 逻辑。
 */

import { icon } from './icons'

export interface ConfirmOptions {
  title: string
  description?: string
  confirmText?: string
  cancelText?: string
  /** 确认按钮显示为破坏性红色 */
  danger?: boolean
}

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.className = 'fixed inset-0 z-100 bg-black/50 backdrop-blur-[2px]'
    const panel = document.createElement('div')
    panel.className =
      'fixed left-1/2 top-1/2 z-101 w-[min(420px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-5 text-card-foreground shadow-2xl'
    panel.style.animation = 'pop-in 0.14s ease-out'
    panel.innerHTML = `
      <div class="flex items-start gap-3">
        ${opts.danger ? `<div class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">${icon('trash', 'size-4')}</div>` : ''}
        <div class="min-w-0">
          <h2 class="text-[15px] font-semibold leading-snug tracking-tight">${escapeText(opts.title)}</h2>
          ${opts.description ? `<p class="mt-1.5 text-sm leading-relaxed text-muted-foreground">${escapeText(opts.description)}</p>` : ''}
        </div>
      </div>
      <div class="mt-5 flex justify-end gap-2">
        <button class="btn btn-outline btn-sm" data-op="cancel">${opts.cancelText ?? '取消'}</button>
        <button class="btn btn-sm ${opts.danger ? 'confirm-danger' : 'btn-default'}" data-op="confirm">${opts.confirmText ?? '确认'}</button>
      </div>`

    const finish = (result: boolean) => {
      overlay.remove()
      panel.remove()
      document.removeEventListener('keydown', onKey, true)
      resolve(result)
    }
    const onKey = (e: KeyboardEvent) => {
      // 捕获阶段阻断：避免 Esc 同时收起底下的 pin / 批注卡片
      e.stopPropagation()
      if (e.key === 'Escape') finish(false)
      if (e.key === 'Enter') {
        e.preventDefault()
        finish(true)
      }
    }

    overlay.addEventListener('mousedown', () => finish(false))
    panel.querySelector('[data-op="cancel"]')?.addEventListener('click', () => finish(false))
    panel.querySelector('[data-op="confirm"]')?.addEventListener('click', () => finish(true))
    document.addEventListener('keydown', onKey, true)

    document.body.append(overlay, panel)
    ;(panel.querySelector('[data-op="confirm"]') as HTMLButtonElement).focus()
  })
}

function escapeText(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export interface TextDialogOptions {
  title: string
  description?: string
  placeholder?: string
  value?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

/** 带多行输入的弹层：贴入 AI 改稿等场景。Promise<string | null>，Esc / 遮罩 / 取消 → null。 */
export function textDialog(opts: TextDialogOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.className = 'fixed inset-0 z-100 bg-black/50 backdrop-blur-[2px]'
    const panel = document.createElement('div')
    panel.className =
      'fixed left-1/2 top-1/2 z-101 flex w-[min(720px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border bg-card p-5 text-card-foreground shadow-2xl'
    panel.style.animation = 'pop-in 0.14s ease-out'
    panel.innerHTML = `
      <h2 class="text-[15px] font-semibold leading-snug tracking-tight">${escapeText(opts.title)}</h2>
      ${opts.description ? `<p class="mt-1.5 text-sm leading-relaxed text-muted-foreground">${escapeText(opts.description)}</p>` : ''}
      <textarea id="text-dialog-input" rows="12" placeholder="${escapeText(opts.placeholder ?? '')}"
        class="input-base mt-3 flex-1 resize-none font-mono text-[13px] leading-relaxed">${escapeText(opts.value ?? '')}</textarea>
      <div class="mt-4 flex items-center justify-between">
        <span class="text-xs text-muted-foreground">⌘/Ctrl + Enter 确认</span>
        <span class="flex gap-2">
          <button class="btn btn-outline btn-sm" data-op="cancel">${opts.cancelText ?? '取消'}</button>
          <button class="btn btn-sm ${opts.danger ? 'confirm-danger' : 'btn-default'}" data-op="confirm">${opts.confirmText ?? '确认'}</button>
        </span>
      </div>`

    const textarea = panel.querySelector('#text-dialog-input') as HTMLTextAreaElement
    const finish = (result: string | null) => {
      overlay.remove()
      panel.remove()
      document.removeEventListener('keydown', onKey, true)
      resolve(result)
    }
    const confirm = () => finish(textarea.value)
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation()
      if (e.key === 'Escape') finish(null)
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        confirm()
      }
    }

    overlay.addEventListener('mousedown', () => finish(null))
    panel.querySelector('[data-op="cancel"]')?.addEventListener('click', () => finish(null))
    panel.querySelector('[data-op="confirm"]')?.addEventListener('click', confirm)
    document.addEventListener('keydown', onKey, true)

    document.body.append(overlay, panel)
    textarea.focus()
  })
}
