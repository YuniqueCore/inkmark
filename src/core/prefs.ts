/** 阅读偏好模型：主题 / 纹理 / 字体 / 字号 / 字重。纯数据与纯函数，无 DOM。
 *
 * 主题分两类：
 * - 整面主题（light / sepia / dark）：整个应用同一套明暗；
 * - 分面主题（panda / panda-inverse）：边栏与中区明暗相反——
 *   中区极性仍由 .dark 类表达（isDarkContent），边栏由 .theme-side
 *   作用域内的 token 覆盖实现（样式在 styles.css）。
 */

export type ThemeId =
  | 'light'
  | 'sepia'
  | 'mint'
  | 'rose'
  | 'solar'
  | 'dark'
  | 'nord'
  | 'coffee'
  | 'ocean'
  | 'plum'
  | 'panda'
  | 'panda-inverse'
export type TextureId =
  | 'none'
  | 'paper'
  | 'grid'
  | 'ruled'
  | 'linen'
  | 'dots'
  | 'diagonal'
  | 'vintage'
  | 'grain'
  | 'checker'
export type FontId = 'sans' | 'hei' | 'song' | 'kai' | 'fangsong' | 'yuan' | 'lishu' | 'mono'
export type FontWeightId = 'light' | 'regular' | 'medium' | 'bold'

export interface ReadingPrefs {
  theme: ThemeId
  /** 正文区背景纹理（阅读器式纸感/格线） */
  texture: TextureId
  /** 正文字体 */
  font: FontId
  /** 正文字号 px（.editor-blk / .diff-blk） */
  fontSize: number
  /** 正文字重 */
  fontWeight: FontWeightId
  /** 自定义正文文字色（hex）；null = 跟随主题 */
  customText: string | null
  /** 自定义编辑区背景色（hex）；null = 跟随主题 */
  customBg: string | null
}

export const THEME_META: Record<ThemeId, {label: string; hint: string; dark: boolean}> = {
  light: {label: '亮色', hint: '标准浅色', dark: false},
  sepia: {label: '纸黄', hint: '暖纸底色', dark: false},
  mint: {label: '豆沙绿', hint: '护眼浅绿', dark: false},
  rose: {label: '樱粉纸', hint: '柔和粉底', dark: false},
  solar: {label: '日光', hint: '明快米黄', dark: false},
  dark: {label: '暗色', hint: '标准深色', dark: true},
  nord: {label: '极夜', hint: '北欧蓝灰', dark: true},
  coffee: {label: '深咖', hint: '烘焙暖棕', dark: true},
  ocean: {label: '深海', hint: '沉静蓝黑', dark: true},
  plum: {label: '深梅', hint: '醇紫暗底', dark: true},
  panda: {label: '熊猫', hint: '深边栏 · 浅正文', dark: false},
  'panda-inverse': {label: '熊猫·反色', hint: '浅边栏 · 深正文', dark: true},
}

/** 顶栏明暗翻转的成对目标：浅色家族 ↔ 深色家族一一对应 */
export const THEME_FLIP: Record<ThemeId, ThemeId> = {
  light: 'dark',
  dark: 'light',
  sepia: 'coffee',
  coffee: 'sepia',
  mint: 'nord',
  nord: 'mint',
  rose: 'plum',
  plum: 'rose',
  solar: 'ocean',
  ocean: 'solar',
  panda: 'panda-inverse',
  'panda-inverse': 'panda',
}

export const TEXTURE_META: Record<TextureId, {label: string}> = {
  none: {label: '无'},
  paper: {label: '纸纹'},
  grid: {label: '方格'},
  ruled: {label: '横线'},
  linen: {label: '织物'},
  dots: {label: '点阵'},
  diagonal: {label: '斜纹'},
  vintage: {label: '旧纸'},
  grain: {label: '颗粒'},
  checker: {label: '棋盘'},
}

export const FONT_META: Record<FontId, {label: string}> = {
  sans: {label: '默认'},
  hei: {label: '黑体'},
  song: {label: '宋体'},
  kai: {label: '楷体'},
  fangsong: {label: '仿宋'},
  yuan: {label: '圆体'},
  lishu: {label: '隶书'},
  mono: {label: '等宽'},
}

export const FONT_SIZE = {min: 13, max: 22, step: 0.5, default: 16.5} as const

/** 字重档位与 CSS 数值的单一映射：样式变量与控件渲染都从这里取 */
export const FONT_WEIGHT_META: Record<FontWeightId, {label: string; value: number}> = {
  light: {label: '细', value: 300},
  regular: {label: '常规', value: 400},
  medium: {label: '中等', value: 500},
  bold: {label: '粗', value: 700},
}

export const DEFAULT_PREFS: ReadingPrefs = {
  theme: 'light',
  texture: 'none',
  font: 'sans',
  fontSize: FONT_SIZE.default,
  fontWeight: 'regular',
  customText: null,
  customBg: null,
}

/** 主题的中区（正文 / 弹层）是否深色：html .dark 类的单一判定来源 */
export function isDarkContent(theme: ThemeId): boolean {
  return THEME_META[theme].dark
}

/** 顶栏明暗按钮：按 THEME_FLIP 成对翻转（浅色家族 ↔ 深色家族） */
export function flipPolarity(theme: ThemeId): ThemeId {
  return THEME_FLIP[theme]
}

const clampSize = (v: number): number => Math.min(FONT_SIZE.max, Math.max(FONT_SIZE.min, v))

/** 字体归一：旧版 'serif' 键迁移为 'song'（标签同为宋体，族链不变） */
function normalizeFont(v: unknown): FontId {
  if (typeof v !== 'string') return DEFAULT_PREFS.font
  if (v === 'serif') return 'song'
  return v in FONT_META ? (v as FontId) : DEFAULT_PREFS.font
}

/** 自定义色校验：仅收 #rgb / #rrggbb；缺省/非法一律 null（跟随主题） */
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i
function normalizeColor(v: unknown): string | null {
  return typeof v === 'string' && HEX_COLOR.test(v.trim()) ? v.trim().toLowerCase() : null
}

/** 宽松归一化：未知值回落默认、字号钳制——localStorage 旧/脏数据的安全入口 */
export function normalizePrefs(raw: unknown): ReadingPrefs {
  const r = (raw ?? {}) as Partial<Record<keyof ReadingPrefs, unknown>>
  return {
    theme: typeof r.theme === 'string' && r.theme in THEME_META ? (r.theme as ThemeId) : DEFAULT_PREFS.theme,
    texture:
      typeof r.texture === 'string' && r.texture in TEXTURE_META
        ? (r.texture as TextureId)
        : DEFAULT_PREFS.texture,
    font: normalizeFont(r.font),
    fontSize:
      typeof r.fontSize === 'number' && Number.isFinite(r.fontSize)
        ? clampSize(r.fontSize)
        : DEFAULT_PREFS.fontSize,
    fontWeight:
      typeof r.fontWeight === 'string' && r.fontWeight in FONT_WEIGHT_META
        ? (r.fontWeight as FontWeightId)
        : DEFAULT_PREFS.fontWeight,
    customText: normalizeColor(r.customText),
    customBg: normalizeColor(r.customBg),
  }
}
