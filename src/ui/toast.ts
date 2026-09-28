/** 全局 toast 提示：单例元素 + 计时淡出。 */

let toastTimer: ReturnType<typeof setTimeout> | undefined

export function toast(message: string): void {
  let el = document.querySelector('.toast') as HTMLElement | null
  if (!el) {
    el = document.createElement('div')
    el.className =
      'toast pointer-events-none fixed bottom-6 left-1/2 z-200 max-w-[min(92vw,560px)] -translate-x-1/2 rounded-md border bg-primary px-3.5 py-2 text-sm text-primary-foreground shadow-lg opacity-0 transition-opacity duration-200'
    document.body.append(el)
  }
  el.textContent = message
  el.classList.add('opacity-95')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el!.classList.remove('opacity-95'), 1800)
}
