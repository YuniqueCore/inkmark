/** Each operation releases only its own input lock, including late or repeated cleanup. */
const locks = new WeakMap<HTMLElement, {count: number; initial: boolean}>()

export function holdInput(element: HTMLElement): () => void {
  const state = locks.get(element) ?? {count: 0, initial: element.inert}
  locks.set(element, state)
  state.count++
  element.inert = true
  let held = true
  return () => {
    if (!held) return
    held = false
    if (--state.count === 0) {
      element.inert = state.initial
      locks.delete(element)
    }
  }
}
