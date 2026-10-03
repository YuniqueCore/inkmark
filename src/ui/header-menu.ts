/** Header 分组菜单：悬停意图展开（140ms）、点击钉住（触摸等效）、
 * 移入面板保持、离开 260ms 收起；Esc / 外点 / 选中后关闭。
 *
 * 面板绝对定位于 trigger 内部（右对齐、top-full），样式 .hdr-menu。
 * 无框架依赖，与侧栏批量条同款事件委托风格。
 */

import { escapeHtml } from '../core/text'

export interface MenuItem {
  id: string
  label: string
  /** 图标名（icons.ts 键）或内联 SVG */
  icon?: string
  /** 右侧灰字说明（快捷键 / 一句话说明） */
  hint?: string
  /** 破坏性红色 */
  danger?: boolean
  /** 该项之前渲染分隔线 */
  separatorBefore?: boolean
}

export function wireHeaderMenu(
  trigger: HTMLButtonElement,
  items: MenuItem[],
  onSelect: (id: string) => void,
): {close: () => void} {
  trigger.style.position = 'relative'
  trigger.setAttribute('aria-haspopup', 'menu')

  const panel = document.createElement('div')
  panel.className = 'hdr-menu'
  panel.setAttribute('role', 'menu')
  panel.hidden = true
  trigger.append(panel)

  let open = false
  let pinned = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const render = (): void => {
    panel.innerHTML = items
      .map((it) => {
        const sep = it.separatorBefore ? '<div class="hdr-sep" role="separator"></div>' : ''
        const ico = it.icon ?? ''
        const hint = it.hint ? `<span class="hint">${escapeHtml(it.hint)}</span>` : ''
        return `${sep}<button type="button" class="hdr-item${it.danger ? ' danger' : ''}" role="menuitem" data-menu-id="${it.id}" title="${escapeHtml(it.label)}">${ico}<span class="min-w-0 flex-1 truncate">${escapeHtml(it.label)}</span>${hint}</button>`
      })
      .join('')
  }
  render()

  const clearTimer = (): void => clearTimeout(timer)
  const show = (pin: boolean): void => {
    clearTimer()
    pinned = pin
    if (!open) {
      open = true
      panel.hidden = false
      trigger.setAttribute('aria-expanded', 'true')
    }
  }
  const close = (): void => {
    clearTimer()
    pinned = false
    if (open) {
      open = false
      panel.hidden = true
      trigger.setAttribute('aria-expanded', 'false')
    }
  }
  const scheduleClose = (): void => {
    if (pinned) return
    clearTimer()
    timer = setTimeout(close, 260)
  }

  trigger.addEventListener('mouseenter', () => show(false))
  trigger.addEventListener('mouseleave', scheduleClose)
  panel.addEventListener('mouseenter', clearTimer)
  panel.addEventListener('mouseleave', scheduleClose)
  trigger.addEventListener('click', () => (open && pinned ? close() : show(true)))
  panel.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-menu-id]')
    if (!el) return
    // 阻断冒泡：panel 是 trigger 的子元素，不阻断会把刚关闭的面板重新弹开
    e.stopPropagation()
    close()
    onSelect(el.dataset.menuId!)
  })
  document.addEventListener('pointerdown', (e) => {
    if (open && !trigger.contains(e.target as Node)) close()
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open && !e.isComposing) close()
  })

  return {close}
}
