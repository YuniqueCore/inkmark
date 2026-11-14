/** One measured visible viewport for sheets and drawers, including mobile keyboards. */
export function initViewport(layout: HTMLElement): void {
  const root = document.documentElement
  const update = (): void => {
    const viewport = window.visualViewport
    root.style.setProperty('--visible-height', `${viewport?.height ?? window.innerHeight}px`)
    root.style.setProperty('--visible-top', `${viewport?.offsetTop ?? 0}px`)
    root.style.setProperty('--workspace-top', `${layout.getBoundingClientRect().top}px`)
  }
  window.visualViewport?.addEventListener('resize', update)
  window.visualViewport?.addEventListener('scroll', update)
  window.addEventListener('resize', update)
  new ResizeObserver(update).observe(layout)
  update()
}
