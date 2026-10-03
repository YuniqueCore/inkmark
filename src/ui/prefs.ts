/** 阅读偏好的 DOM 边界：localStorage 读写 + 应用到文档。
 * 状态所有者是 main（单一数据源），本模块只提供读 / 存 / 画三个动作。
 */

import { FONT_WEIGHT_META, isDarkContent, normalizePrefs } from '../core/prefs'
import { ensureReadable } from '../core/contrast'
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
  el.style.setProperty('--doc-font-weight', String(FONT_WEIGHT_META[p.fontWeight].value))
  const editor = document.querySelector<HTMLElement>('#editor')
  editor?.setAttribute('data-texture', p.texture)
  editor?.setAttribute('data-font', p.font)
  applyEditorColors(editor, p)
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

/** 编辑区自定义文字/背景色：对比度不足 4.5:1 时在用户色相内自动矫正文字亮度；
 * 纹理线色随矫正后的文字色重算（与 --texture-line 的 root 定义同式）。 */
function applyEditorColors(editor: HTMLElement | null, p: ReadingPrefs): void {
  if (!editor) return
  if (!p.customBg && !p.customText) {
    editor.style.removeProperty('--foreground')
    editor.style.removeProperty('--background')
    editor.style.removeProperty('--texture-line')
    return
  }
  const rootStyle = getComputedStyle(document.documentElement)
  const themeBg = rootStyle.getPropertyValue('--background').trim() || '#ffffff'
  const themeFg = rootStyle.getPropertyValue('--foreground').trim() || '#000000'
  const bg = p.customBg ?? themeBg
  const {text} = ensureReadable(p.customText ?? themeFg, bg)
  editor.style.setProperty('--foreground', text)
  editor.style.setProperty('--background', bg)
  editor.style.setProperty('--texture-line', `color-mix(in oklab, ${text} 8%, transparent)`)
}
