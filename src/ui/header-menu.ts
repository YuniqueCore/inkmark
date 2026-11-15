import {autoUpdate, computePosition, flip, offset, shift} from '@floating-ui/dom'
import {escapeHtml} from '../core/text'

export interface MenuItem {
  id: string
  label: string
  icon?: string
  hint?: string
  danger?: boolean
  separatorBefore?: boolean
  elementId?: string
  disabled?: boolean
  hidden?: boolean
}

/** A menu is a sibling overlay, never a nested interactive child of its trigger. */
export function wireHeaderMenu(trigger: HTMLButtonElement, initial: MenuItem[], onSelect: (id: string) => void) {
  const panel = document.createElement('div')
  panel.className = 'hdr-menu'
  panel.id = `${trigger.id}-menu`
  panel.setAttribute('role', 'menu')
  panel.setAttribute('aria-label', trigger.getAttribute('aria-label') ?? trigger.title)
  panel.hidden = true
  document.body.append(panel)
  trigger.setAttribute('aria-haspopup', 'menu')
  trigger.setAttribute('aria-controls', panel.id)
  let dispose: (() => void) | undefined
  const buttons = () => [...panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled):not([hidden])')]
  const update = (items: MenuItem[]): void => {
    const focused = panel.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.menuId : undefined
    panel.innerHTML = items.filter(item => !item.hidden).map(item => `${item.separatorBefore ? '<div class="hdr-sep" role="separator"></div>' : ''}
      <button type="button" ${item.elementId ? `id="${escapeHtml(item.elementId)}"` : ''} class="hdr-item${item.danger ? ' danger' : ''}" role="menuitem" tabindex="-1" data-menu-id="${escapeHtml(item.id)}" ${item.disabled ? 'disabled' : ''}>
        ${item.icon ?? ''}<span class="min-w-0 flex-1">${escapeHtml(item.label)}</span>${item.hint ? `<span class="hint">${escapeHtml(item.hint)}</span>` : ''}
      </button>`).join('')
    if (focused) buttons().find(button => button.dataset.menuId === focused)?.focus()
  }
  const close = (restoreFocus = false): void => {
    panel.hidden = true
    trigger.setAttribute('aria-expanded', 'false')
    dispose?.(); dispose = undefined
    if (restoreFocus) trigger.focus()
  }
  const show = (last = false): void => {
    document.dispatchEvent(new CustomEvent('inkmark:menu-open', {detail: panel.id}))
    panel.hidden = false
    trigger.setAttribute('aria-expanded', 'true')
    dispose?.()
    dispose = autoUpdate(trigger, panel, () => {
      void computePosition(trigger, panel, {strategy: 'fixed', placement: 'bottom-end', middleware: [offset(6), flip(), shift({padding: 8})]})
        .then(({x, y}) => { panel.style.left = `${x}px`; panel.style.top = `${y}px` })
    })
    const items = buttons()
    items[last ? items.length - 1 : 0]?.focus()
  }
  update(initial)
  trigger.addEventListener('click', () => panel.hidden ? show() : close())
  trigger.addEventListener('keydown', event => {
    if (event.isComposing) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); show(event.key === 'ArrowUp') }
  })
  panel.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-menu-id]')
    if (!button || button.disabled) return
    close(true)
    onSelect(button.dataset.menuId!)
  })
  panel.addEventListener('keydown', event => {
    if (event.isComposing) return
    const items = buttons(), index = items.indexOf(document.activeElement as HTMLButtonElement)
    const key = event.key
    if (key === 'Escape') { event.preventDefault(); close(true) }
    if (key === 'Tab') close()
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) {
      event.preventDefault()
      items[key === 'Home' ? 0 : key === 'End' ? items.length - 1 : (index + (key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
    }
  })
  document.addEventListener('pointerdown', event => { if (!panel.hidden && !panel.contains(event.target as Node) && !trigger.contains(event.target as Node)) close() })
  document.addEventListener('inkmark:menu-open', event => { if ((event as CustomEvent<string>).detail !== panel.id) close() })
  return {close, update}
}
