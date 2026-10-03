/** 对比度纯函数：换算、亮度、对比度、合成、自动矫正。 */

import { describe, expect, it } from 'vitest'
import {
  blendOver,
  contrastRatio,
  ensureReadable,
  hexToRgb,
  kindHighlightContrast,
  mixHex,
  relativeLuminance,
  rgbToHex,
} from '../src/core/contrast'

describe('hexToRgb / rgbToHex', () => {
  it('三位缩写展开，六位直读，非法输入 null', () => {
    expect(hexToRgb('#fff')).toEqual({r: 255, g: 255, b: 255})
    expect(hexToRgb('#1d4ed8')).toEqual({r: 0x1d, g: 0x4e, b: 0xd8})
    expect(hexToRgb('not-a-color')).toBeNull()
    expect(hexToRgb('#12345')).toBeNull()
  })

  it('往返一致', () => {
    expect(rgbToHex(hexToRgb('#3B82F6')!)).toBe('#3b82f6')
  })
})

describe('relativeLuminance / contrastRatio', () => {
  it('黑白端点与已知值', () => {
    expect(relativeLuminance('#000000')).toBe(0)
    expect(relativeLuminance('#ffffff')).toBe(1)
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
  })

  it('黑上白字 21:1，白上浅灰不达标', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeGreaterThan(20)
    expect(contrastRatio('#cccccc', '#ffffff')).toBeLessThan(2)
  })

  it('对称性', () => {
    expect(contrastRatio('#1d4ed8', '#f6f1e7')).toBeCloseTo(contrastRatio('#f6f1e7', '#1d4ed8'), 10)
  })
})

describe('blendOver', () => {
  it('不透明覆盖 = 覆盖色本身；全透明 = 底色', () => {
    const o = {r: 255, g: 0, b: 0, a: 1}
    expect(blendOver(o, '#123456')).toBe('#ff0000')
    expect(blendOver({...o, a: 0}, '#123456')).toBe('#123456')
  })

  it('半透明合成取加权中点', () => {
    expect(blendOver({r: 0, g: 0, b: 0, a: 0.5}, '#ffffff')).toBe('#808080')
  })
})

describe('mixHex', () => {
  it('t=0 返回 a，t=1 返回 b，中点混合', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff')
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080')
  })
})

describe('ensureReadable', () => {
  it('已达标：原样返回不调整', () => {
    const r = ensureReadable('#111111', '#ffffff')
    expect(r).toEqual({text: '#111111', adjusted: false})
  })

  it('白底浅灰字：向黑矫正至 4.5:1 以上', () => {
    const r = ensureReadable('#cccccc', '#ffffff')
    expect(r.adjusted).toBe(true)
    expect(contrastRatio(r.text, '#ffffff')).toBeGreaterThanOrEqual(4.5)
    // 保持中性色相（r=g=b）
    const rgb = hexToRgb(r.text)!
    expect(rgb.r).toBe(rgb.g)
    expect(rgb.g).toBe(rgb.b)
  })

  it('黑底深灰字：向白矫正', () => {
    const r = ensureReadable('#333333', '#000000')
    expect(r.adjusted).toBe(true)
    expect(contrastRatio(r.text, '#000000')).toBeGreaterThanOrEqual(4.5)
  })

  it('非法输入不调整', () => {
    expect(ensureReadable('oops', '#ffffff')).toEqual({text: 'oops', adjusted: false})
  })
})

describe('kindHighlightContrast', () => {
  it('正文达标时，叠加低透明度高亮后仍可读', () => {
    const kindBg = {r: 59, g: 130, b: 246, a: 0.14} // suggestion 蓝 14%
    const c = kindHighlightContrast('#1f2937', kindBg, '#f6f1e7')
    expect(c).toBeGreaterThan(4)
  })
})
