/** 设置弹层：阅读偏好（主题 / 纹理 / 字体 / 字号）的完整编辑入口。
 * 改动即时上抛（main 端 apply + 持久化），弹层背后实时预览；无确认语义，完成/Esc 即关。
 * 弹层自身遵守通病约束：max-h + 滚动正文 + shrink-0 底栏。
 */

import type { ReadingPrefs } from '../core/prefs'
import {
  bindPrefControls,
  fontOptionsHtml,
  fontSizeControlHtml,
  syncPrefControls,
  textureOptionsHtml,
  themeOptionsHtml,
} from './pref-controls'
import { icon } from './icons'

export function settingsDialog(
  current: ReadingPrefs,
  onChange: (p: ReadingPrefs) => void,
): Promise<void> {
  return new Promise((resolve) => {
    let prefs = current

    const overlay = document.createElement('div')
    overlay.className = 'fixed inset-0 z-100 bg-black/50 backdrop-blur-[2px]'
    const panel = document.createElement('div')
    panel.className =
      'fixed left-1/2 top-1/2 z-101 flex max-h-[86vh] w-[min(560px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border bg-card p-5 text-card-foreground shadow-2xl'
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-modal', 'true')
    panel.setAttribute('aria-label', '设置')
    panel.style.animation = 'pop-in 0.14s ease-out'
    panel.innerHTML = `
      <div class="flex shrink-0 items-center justify-between">
        <h2 class="text-[15px] font-semibold tracking-tight">设置</h2>
        <button type="button" class="btn btn-ghost btn-sm" data-op="close" aria-label="关闭设置">${icon('x', 'size-4')}</button>
      </div>
      <div class="mt-4 min-h-0 flex-1 space-y-6 overflow-y-auto pr-1" data-pref-body>
        <section>
          <h3 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">主题</h3>
          <div class="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5" data-part="theme">${themeOptionsHtml(prefs.theme)}</div>
        </section>
        <section>
          <h3 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">纹理</h3>
          <div class="mt-2 grid grid-cols-5 gap-2" data-part="texture">${textureOptionsHtml(prefs.texture)}</div>
        </section>
        <section>
          <h3 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">字体</h3>
          <div class="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4" data-part="font">${fontOptionsHtml(prefs.font)}</div>
        </section>
        <section>
          <h3 class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">字号</h3>
          <div class="mt-2">${fontSizeControlHtml(prefs.fontSize)}</div>
          <p class="mt-1.5 text-xs text-muted-foreground">调整立即生效并保存；行距随字号自动缩放。</p>
        </section>
      </div>
      <div class="mt-5 flex shrink-0 justify-end">
        <button type="button" class="btn btn-default btn-sm" data-op="close">完成</button>
      </div>`

    const body = panel.querySelector('[data-pref-body]') as HTMLElement
    bindPrefControls(body, (patch) => {
      prefs = {...prefs, ...patch}
      onChange(prefs)
      syncPrefControls(body, prefs)
    })

    const finish = () => {
      overlay.remove()
      panel.remove()
      document.removeEventListener('keydown', onKey, true)
      resolve()
    }
    const onKey = (e: KeyboardEvent) => {
      // 捕获阶段阻断：避免 Esc 同时触发底下组件的收起逻辑（confirm/textDialog 同款）
      e.stopPropagation()
      if (e.key === 'Escape') finish()
    }

    overlay.addEventListener('mousedown', finish)
    panel.querySelectorAll('[data-op="close"]').forEach((b) => b.addEventListener('click', finish))
    document.addEventListener('keydown', onKey, true)

    document.body.append(overlay, panel)
  })
}
