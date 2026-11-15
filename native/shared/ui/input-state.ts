/** Marked text belongs to the native editor until its committed onChange arrives. */
const composingInputs = new Set<symbol>()
export function setComposing(input: symbol, composing: boolean): void {
  if (composing) composingInputs.add(input)
  else composingInputs.delete(input)
}
export const isComposing = (): boolean => composingInputs.size > 0
