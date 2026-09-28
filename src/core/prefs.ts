/** 阅读偏好模型：主题 / 纹理 / 字体 / 字号。纯数据与纯函数，无 DOM。
 *
 * 主题分两类：
 * - 整面主题（light / sepia / dark）：整个应用同一套明暗；
 * - 分面主题（panda / panda-inverse）：边栏与中区明暗相反——
 *   中区极性仍由 .dark 类表达（isDarkContent），边栏由 .theme-side
 *   作用域内的 token 覆盖实现（样式在 styles.css）。
 */

export type ThemeId = 'light' | 'sepia' | 'dark' | 'panda' | 'panda-inverse'
export type TextureId = 'none' | 'paper' | 'grid' | 'ruled' | 'linen'
export type FontId = 'sans' | 'serif' | 'kai' | 'mono'

export interface ReadingPrefs {
  theme: ThemeId
  /** 正文区背景纹理（阅读器式纸感/格线） */
  texture: TextureId
  /** 正文字体 */
  font: FontId
  /** 正文字号 px（.editor-blk / .diff-blk） */
  fontSize: number
}

export const THEME_META: Record<ThemeId, {label: string; hint: string; dark: boolean}> = {
  light: {label: '亮色', hint: '标准浅色', dark: false},
  sepia: {label: '纸黄', hint: '暖纸底色', dark: false},
  dark: {label: '暗色', hint: '标准深色', dark: true},
  panda: {label: '熊猫', hint: '深边栏 · 浅正文', dark: false},
  'panda-inverse': {label: '熊猫·反色', hint: '浅边栏 · 深正文', dark: true},
}

export const TEXTURE_META: Record<TextureId, {label: string}> = {
  none: {label: '无'},
  paper: {label: '纸纹'},
  grid: {label: '方格'},
  ruled: {label: '横线'},
  linen: {label: '织物'},
}

export const FONT_META: Record<FontId, {label: string}> = {
  sans: {label: '默认'},
  serif: {label: '宋体'},
  kai: {label: '楷体'},
  mono: {label: '等宽'},
}

export const FONT_SIZE = {min: 13, max: 22, step: 0.5, default: 16.5} as const

export const DEFAULT_PREFS: ReadingPrefs = {
  theme: 'light',
  texture: 'none',
  font: 'sans',
  fontSize: FONT_SIZE.default,
}

/** 主题的中区（正文 / 弹层）是否深色：html .dark 类的单一判定来源 */
export function isDarkContent(theme: ThemeId): boolean {
  return THEME_META[theme].dark
}

/** 顶栏明暗按钮：在当前主题家族内翻转中区极性（panda 家族内互换） */
export function flipPolarity(theme: ThemeId): ThemeId {
  switch (theme) {
    case 'light':
    case 'sepia':
      return 'dark'
    case 'dark':
      return 'light'
    case 'panda':
      return 'panda-inverse'
    case 'panda-inverse':
      return 'panda'
  }
}

const clampSize = (v: number): number => Math.min(FONT_SIZE.max, Math.max(FONT_SIZE.min, v))

/** 宽松归一化：未知值回落默认、字号钳制——localStorage 旧/脏数据的安全入口 */
export function normalizePrefs(raw: unknown): ReadingPrefs {
  const r = (raw ?? {}) as Partial<Record<keyof ReadingPrefs, unknown>>
  return {
    theme: typeof r.theme === 'string' && r.theme in THEME_META ? (r.theme as ThemeId) : DEFAULT_PREFS.theme,
    texture:
      typeof r.texture === 'string' && r.texture in TEXTURE_META
        ? (r.texture as TextureId)
        : DEFAULT_PREFS.texture,
    font: typeof r.font === 'string' && r.font in FONT_META ? (r.font as FontId) : DEFAULT_PREFS.font,
    fontSize:
      typeof r.fontSize === 'number' && Number.isFinite(r.fontSize)
        ? clampSize(r.fontSize)
        : DEFAULT_PREFS.fontSize,
  }
}
