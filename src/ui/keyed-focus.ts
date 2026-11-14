/** Retain keyboard position when a keyed list rebuilds its controls. */
export function captureKeyedFocus(root: HTMLElement): () => void {
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || !root.contains(active)) return () => {}
  const selector = (el: HTMLElement): string => el.id ? `#${CSS.escape(el.id)}` :
    [...el.attributes].filter((a) => a.name.startsWith('data-'))
      .map((a) => `[${a.name}="${CSS.escape(a.value)}"]`).join('')
  const item = active.closest<HTMLElement>('[data-doc], [data-id], [data-group]')
  const control = selector(active)
  const query = item && item !== active ? `${selector(item)} ${control}` : control
  return () => { if (control) root.querySelector<HTMLElement>(query)?.focus({preventScroll: true}) }
}
