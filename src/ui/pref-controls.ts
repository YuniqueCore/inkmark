/** 阅读偏好控件的可复用渲染：设置弹层与悬浮快捷设置共用同一份 HTML 源与事件委托。
 * 控件无状态（.on 由调用方按当前偏好同步），改动通过 bindPrefControls 的 patch 回调上抛。
 */

import { FONT_META, FONT_SIZE, FONT_WEIGHT_META, TEXTURE_META, THEME_META } from '../core/prefs'
import { contrastRatio } from '../core/contrast'
import type { FontId, FontWeightId, TextureId, ThemeId } from '../core/prefs'
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

export function fontWeightOptionsHtml(active: FontWeightId): string {
  return (Object.keys(FONT_WEIGHT_META) as FontWeightId[])
    .map(
      (id) => `
      <button type="button" class="font-card${id === active ? ' on' : ''}" data-set-weight="${id}"
        title="${FONT_WEIGHT_META[id].label}（${FONT_WEIGHT_META[id].value}）" aria-pressed="${id === active}">
        <span class="font-sample text-[15px] leading-6" style="font-weight:${FONT_WEIGHT_META[id].value}">字Aa</span>
        <span class="mt-0.5 block text-[11px] text-muted-foreground">${FONT_WEIGHT_META[id].label}</span>
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

export function colorControlsHtml(p: ReadingPrefs): string {
  const rootStyle = getComputedStyle(document.documentElement)
  const fg = p.customText ?? (rootStyle.getPropertyValue('--foreground').trim() || '#000000')
  const bg = p.customBg ?? (rootStyle.getPropertyValue('--background').trim() || '#ffffff')
  const ratio = contrastRatio(p.customText ?? fg, p.customBg ?? bg)
  const ok = ratio >= 4.5
  return `
    <div class="flex flex-wrap items-center gap-3">
      <label class="flex items-center gap-1.5 text-xs text-muted-foreground">
        文字
        <input type="color" data-set-text value="${fg}" class="h-7 w-9 cursor-pointer rounded-md border bg-card p-0.5" aria-label="自定义文字颜色"/>
      </label>
      <label class="flex items-center gap-1.5 text-xs text-muted-foreground">
        背景
        <input type="color" data-set-bg value="${bg}" class="h-7 w-9 cursor-pointer rounded-md border bg-card p-0.5" aria-label="自定义背景颜色"/>
      </label>
      <span class="ml-auto font-mono text-xs ${ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}" data-contrast-label title="正文字色与背景的 WCAG 对比度（AA 正文 ≥ 4.5:1）">${ratio.toFixed(1)}:1 ${ok ? '✓' : '→ 自动矫正'}</span>
      <button type="button" class="btn btn-ghost btn-sm h-7 px-2 text-xs" data-clear-colors${!p.customText && !p.customBg ? ' disabled' : ''}>跟随主题</button>
    </div>`
}

/** 颜色控件的对比度标签刷新（input 高频触发，不重渲染整块） */
export function syncContrastLabel(root: HTMLElement, fg: string, bg: string): void {
  const label = root.querySelector('[data-contrast-label]')
  if (!label) return
  const ratio = contrastRatio(fg, bg)
  const ok = ratio >= 4.5
  label.textContent = `${ratio.toFixed(1)}:1 ${ok ? '✓' : '→ 自动矫正'}`
  label.classList.toggle('text-emerald-600', ok)
  label.classList.toggle('dark:text-emerald-400', ok)
  label.classList.toggle('text-destructive', !ok)
}

/** 控件容器统一的事件委托：data-set-* 点击与字号滑杆 input，上抛 patch */
export function bindPrefControls(
  root: HTMLElement,
  onChange: (patch: Partial<ReadingPrefs>) => void,
): void {
  root.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-set-theme],[data-set-texture],[data-set-font],[data-set-weight]')
    if (!t) return
    if (t.dataset.setTheme) onChange({theme: t.dataset.setTheme as ThemeId})
    else if (t.dataset.setTexture) onChange({texture: t.dataset.setTexture as TextureId})
    else if (t.dataset.setFont) onChange({font: t.dataset.setFont as FontId})
    else if (t.dataset.setWeight) onChange({fontWeight: t.dataset.setWeight as FontWeightId})
  })
  root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement
    if (t.matches('[data-set-size]')) {
      const label = t.parentElement?.querySelector('[data-size-label]')
      if (label) label.textContent = `${t.value}px`
      onChange({fontSize: Number(t.value)})
      return
    }
    if (t.matches('[data-set-text],[data-set-bg]')) {
      const root2 = t.closest('[data-color-controls]') ?? t.parentElement?.parentElement
      const fg = (root2?.querySelector('[data-set-text]') as HTMLInputElement | null)?.value ?? '#000000'
      const bg = (root2?.querySelector('[data-set-bg]') as HTMLInputElement | null)?.value ?? '#ffffff'
      syncContrastLabel(root, fg, bg)
      if (t.matches('[data-set-text]')) onChange({customText: t.value})
      else onChange({customBg: t.value})
    }
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
  root.querySelectorAll<HTMLElement>('[data-set-weight]').forEach((el) =>
    el.classList.toggle('on', el.dataset.setWeight === prefs.fontWeight),
  )
}
