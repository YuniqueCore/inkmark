/** Shared mouse, keyboard and touch-selection observation for source and rendered text. */
export type SelectionPoint = Pick<MouseEvent, 'clientX' | 'clientY'>

export function observeTextSelection(root: HTMLElement, selected: (point: SelectionPoint) => void): void {
  const fromRange = (): void => {
    if (document.activeElement?.closest('input, textarea, [contenteditable="true"]')) return
    const selection = window.getSelection()
    if (!selection?.rangeCount || selection.isCollapsed) return
    const range = selection.getRangeAt(0)
    if (!root.contains(range.commonAncestorContainer)) return
    const rect = range.getBoundingClientRect()
    selected({clientX: rect.left + rect.width / 2, clientY: rect.bottom})
  }
  root.addEventListener('mouseup', selected)
  root.addEventListener('keyup', event => {
    if (!event.isComposing && (event.key.startsWith('Arrow') || event.key.toLowerCase() === 'a')) fromRange()
  })
  document.addEventListener('selectionchange', () => {
    if (!window.matchMedia('(pointer: coarse)').matches) return
    // Native selection handles can continue moving after pointerup/cancel.
    fromRange()
  })
}
