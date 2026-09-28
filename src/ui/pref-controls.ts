/** 阅读偏好控件的可复用渲染：设置弹层与悬浮快捷设置共用同一份 HTML 源与事件委托。
 * 控件无状态（.on 由调用方按当前偏好同步），改动通过 bindPrefControls 的 patch 回调上抛。
 */

import { FONT_META, FONT_SIZE, TEXTURE_META, THEME_META } from '../core/prefs'
import type { FontId, TextureId, ThemeId } from '../core/prefs'
import type { ReadingPrefs } from '../core/prefs'

/** 主题缩略示意：迷你界面直接用真实 token 上色（深色主题补 .dark 驱动中区 token） */
export function themePreviewHtml(theme: ThemeId): string {
  const dark = THEME_META[theme].dark
  return `
    <span class="theme-preview${dark ? ' dark' : ''}" data-theme="${theme}" aria-hidden="true">
      <span class="tp-head"></span>
      <span class="tp-body">
        <span class="tp-side theme-side"></span>
        <span class="tp-main"><i class="tp-line"></i><i class="tp-line short"></i><i class="tp-line"></i></span>
      </span>
    </span>`
}

export function themeOptionsHtml(active: ThemeId): string {
  return (Object.keys(THEME_META) as ThemeId[])
    .map(
      (id) => `
      <button type="button" class="theme-card${id === active ? ' on' : ''}" data-set-theme="${id}"
        title="${THEME_META[id].hint}" aria-pressed="${id === active}">
        ${themePreviewHtml(id)}
        <span class="mt-1.5 block text-xs font-medium">${THEME_META[id].label}</span>
        <span class="block text-[10.5px] leading-4 text-muted-foreground">${THEME_META[id].hint}</span>
      </button>`,
    )
    .join('')
}

export function textureOptionsHtml(active: TextureId): string {
  return (Object.keys(TEXTURE_META) as TextureId[])
    .map(
      (id) => `
      <button type="button" class="texture-card${id === active ? ' on' : ''}" data-set-texture="${id}"
        title="${TEXTURE_META[id].label}" aria-pressed="${id === active}">
        <span class="texture-swatch" data-texture="${id}"></span>
        <span class="mt-1 block text-[11px] text-muted-foreground">${TEXTURE_META[id].label}</span>
      </button>`,
    )
    .join('')
}

export function fontOptionsHtml(active: FontId): string {
  return (Object.keys(FONT_META) as FontId[])
    .map(
      (id) => `
      <button type="button" class="font-card${id === active ? ' on' : ''}" data-set-font="${id}"
        title="${FONT_META[id].label}" aria-pressed="${id === active}">
        <span class="font-sample" data-font="${id}">阅读 Aa</span>
        <span class="mt-0.5 block text-[11px] text-muted-foreground">${FONT_META[id].label}</span>
      </button>`,
    )
    .join('')
}

export function fontSizeControlHtml(value: number): string {
  return `
    <div class="flex items-center gap-3">
      <input type="range" data-set-size min="${FONT_SIZE.min}" max="${FONT_SIZE.max}"
        step="${FONT_SIZE.step}" value="${value}" class="h-1.5 flex-1 accent-[var(--primary)]" aria-label="正文字号"/>
      <span class="w-11 text-right font-mono text-xs text-muted-foreground" data-size-label>${value}px</span>
    </div>`
}

/** 控件容器统一的事件委托：data-set-* 点击与字号滑杆 input，上抛 patch */
export function bindPrefControls(
  root: HTMLElement,
  onChange: (patch: Partial<ReadingPrefs>) => void,
): void {
  root.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-set-theme],[data-set-texture],[data-set-font]')
    if (!t) return
    if (t.dataset.setTheme) onChange({theme: t.dataset.setTheme as ThemeId})
    else if (t.dataset.setTexture) onChange({texture: t.dataset.setTexture as TextureId})
    else if (t.dataset.setFont) onChange({font: t.dataset.setFont as FontId})
  })
  root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement
    if (!t.matches('[data-set-size]')) return
    const label = t.parentElement?.querySelector('[data-size-label]')
    if (label) label.textContent = `${t.value}px`
    onChange({fontSize: Number(t.value)})
  })
}

/** 按当前偏好同步所有控件的选中态（不重渲染，滑杆拖动不中断） */
export function syncPrefControls(root: HTMLElement, prefs: ReadingPrefs): void {
  root.querySelectorAll<HTMLElement>('[data-set-theme]').forEach((el) =>
    el.classList.toggle('on', el.dataset.setTheme === prefs.theme),
  )
  root.querySelectorAll<HTMLElement>('[data-set-texture]').forEach((el) =>
    el.classList.toggle('on', el.dataset.setTexture === prefs.texture),
  )
  root.querySelectorAll<HTMLElement>('[data-set-font]').forEach((el) =>
    el.classList.toggle('on', el.dataset.setFont === prefs.font),
  )
}
