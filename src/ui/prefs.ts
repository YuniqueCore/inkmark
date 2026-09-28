/** 阅读偏好的 DOM 边界：localStorage 读写 + 应用到文档。
 * 状态所有者是 main（单一数据源），本模块只提供读 / 存 / 画三个动作。
 */

import { isDarkContent, normalizePrefs } from '../core/prefs'
import type { ReadingPrefs } from '../core/prefs'
import { icon } from './icons'

// 键与 index.html 防闪烁内联脚本镜像——改动必须两处同步
const KEY = 'inkmark:prefs:v1'

export function loadPrefs(): ReadingPrefs {
  try {
    return parsePrefs(localStorage.getItem(KEY))
  } catch {
    return parsePrefs(null)
  }
}

export function savePrefs(p: ReadingPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    // 存储不可用（配额/隐私模式）：偏好降级为本次会话内生效
  }
}

/** 把偏好画到 DOM：html 主题/极性、编辑区纹理/字体、字号变量、顶栏按钮图标 */
export function applyPrefs(p: ReadingPrefs): void {
  const el = document.documentElement
  el.dataset.theme = p.theme
  el.classList.toggle('dark', isDarkContent(p.theme))
  el.style.setProperty('--doc-font-size', `${p.fontSize}px`)
  const editor = document.querySelector('#editor')
  editor?.setAttribute('data-texture', p.texture)
  editor?.setAttribute('data-font', p.font)
  const btn = document.querySelector('#btn-theme')
  if (btn) btn.innerHTML = icon(isDarkContent(p.theme) ? 'sun' : 'moon', 'size-4')
}

function parsePrefs(raw: string | null): ReadingPrefs {
  if (!raw) return normalizePrefs(null)
  try {
    return normalizePrefs(JSON.parse(raw))
  } catch {
    return normalizePrefs(null)
  }
}
