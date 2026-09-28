/** 阅读偏好模型回归：脏数据归一化、字号钳制、中区极性判定与翻转。 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PREFS,
  flipPolarity,
  isDarkContent,
  normalizePrefs,
} from '../src/core/prefs'

describe('normalizePrefs · localStorage 脏数据安全', () => {
  it('空 / 非对象输入回落默认', () => {
    expect(normalizePrefs(null)).toEqual(DEFAULT_PREFS)
    expect(normalizePrefs(undefined)).toEqual(DEFAULT_PREFS)
    expect(normalizePrefs('junk')).toEqual(DEFAULT_PREFS)
    expect(normalizePrefs(42)).toEqual(DEFAULT_PREFS)
  })

  it('未知枚举值逐项回落默认，合法值保留', () => {
    expect(normalizePrefs({theme: 'nope', texture: 42, font: 'x', fontSize: 'big'})).toEqual(
      DEFAULT_PREFS,
    )
    expect(normalizePrefs({theme: 'panda', texture: 'grid', font: 'kai', fontSize: 18})).toEqual({
      theme: 'panda',
      texture: 'grid',
      font: 'kai',
      fontSize: 18,
    })
    // 部分字段缺失：缺失项回落，合法项保留
    expect(normalizePrefs({texture: 'paper'})).toEqual({...DEFAULT_PREFS, texture: 'paper'})
  })

  it('字号钳制到 [13, 22]，非有限数回落默认', () => {
    expect(normalizePrefs({fontSize: 99}).fontSize).toBe(22)
    expect(normalizePrefs({fontSize: 1}).fontSize).toBe(13)
    expect(normalizePrefs({fontSize: 19.5}).fontSize).toBe(19.5)
    expect(normalizePrefs({fontSize: Number.NaN}).fontSize).toBe(DEFAULT_PREFS.fontSize)
    expect(normalizePrefs({fontSize: Number.POSITIVE_INFINITY}).fontSize).toBe(DEFAULT_PREFS.fontSize)
  })
})

describe('中区极性', () => {
  it('isDarkContent：dark / panda-inverse 深色，其余浅色', () => {
    expect(isDarkContent('light')).toBe(false)
    expect(isDarkContent('sepia')).toBe(false)
    expect(isDarkContent('panda')).toBe(false)
    expect(isDarkContent('dark')).toBe(true)
    expect(isDarkContent('panda-inverse')).toBe(true)
  })

  it('flipPolarity：整面主题亮暗互换，panda 家族内互换', () => {
    expect(flipPolarity('light')).toBe('dark')
    expect(flipPolarity('dark')).toBe('light')
    expect(flipPolarity('sepia')).toBe('dark')
    expect(flipPolarity('panda')).toBe('panda-inverse')
    expect(flipPolarity('panda-inverse')).toBe('panda')
  })
})
