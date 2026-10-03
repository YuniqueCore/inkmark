/** WCAG 对比度纯函数集：hex/rgb 换算、相对亮度、对比度、透明层合成、
 * 可读性自动矫正。无 DOM——applyPrefs 与设置面板共用同一判定源。
 *
 * 矫正策略：正文字色在「保持用户色相」的前提下向黑/白混合，步进 5%，
 * 直到与背景对比度达标（默认 WCAG AA 正文 4.5:1）或到达端点。
 */

export interface Rgb {
  r: number
  g: number
  b: number
}

/** #rgb / #rrggbb → rgb；非法输入 null */
export function hexToRgb(hex: string): Rgb | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  let h = m[1]!
  if (h.length === 3) h = [...h].map((c) => c + c).join('')
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

export function rgbToHex({r, g, b}: Rgb): string {
  const c = (v: number): string => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

/** WCAG 相对亮度：sRGB 通道线性化后按感知权重合成（0=黑，1=白） */
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex)
  if (!rgb) return 0
  const lin = (v: number): number => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b)
}

/** WCAG 对比度（1..21）：较亮者 +0.05 比上较暗者 +0.05 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** 半透明 rgba 层叠在底色上的合成色（kind 高亮底叠正文背景即此式） */
export function blendOver(overlay: {r: number; g: number; b: number; a: number}, base: string): string {
  const bg = hexToRgb(base) ?? {r: 255, g: 255, b: 255}
  return rgbToHex({
    r: overlay.r * overlay.a + bg.r * (1 - overlay.a),
    g: overlay.g * overlay.a + bg.g * (1 - overlay.a),
    b: overlay.b * overlay.a + bg.b * (1 - overlay.a),
  })
}

/** 两色按比例 t（0=全 a，1=全 b）混合 */
export function mixHex(a: string, b: string, t: number): string {
  const ca = hexToRgb(a) ?? {r: 0, g: 0, b: 0}
  const cb = hexToRgb(b) ?? {r: 255, g: 255, b: 255}
  return rgbToHex({
    r: ca.r + (cb.r - ca.r) * t,
    g: ca.g + (cb.g - ca.g) * t,
    b: ca.b + (cb.b - ca.b) * t,
  })
}

export const WCAG_AA_BODY = 4.5

/**
 * 可读性矫正：text 与 bg 对比度不足 min 时，在保持色相的前提下向黑/白
 * 混合（选使对比度更高的方向），每步 5%，最多 20 步。达标返回原色。
 */
export function ensureReadable(text: string, bg: string, min: number = WCAG_AA_BODY): {text: string; adjusted: boolean} {
  const base = hexToRgb(text)
  if (!base || !hexToRgb(bg)) return {text, adjusted: false}
  let current = text
  // 方向：向白混（深色字提亮）或向黑混（浅色字压暗），取能提高对比度者
  const white = contrastRatio(mixHex(text, '#ffffff', 0.1), bg)
  const black = contrastRatio(mixHex(text, '#000000', 0.1), bg)
  const target = white >= black ? '#ffffff' : '#000000'
  for (let step = 1; step <= 20; step++) {
    if (contrastRatio(current, bg) >= min) return {text: current, adjusted: step > 1}
    current = mixHex(text, target, Math.min(1, step * 0.05))
  }
  return {text: current, adjusted: true}
}

/** 批注高亮可读性：正文色叠在 kind 半透明底合成后的对比度 */
export function kindHighlightContrast(textHex: string, kindRgba: {r: number; g: number; b: number; a: number}, bgHex: string): number {
  return contrastRatio(textHex, blendOver(kindRgba, bgHex))
}
