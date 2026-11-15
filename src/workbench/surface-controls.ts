import type {ImageRegion} from '../core/types'
import type {ComposerState} from './composition'

export interface SourceEditCallbacks {onSave(text: string): void | Promise<void>; onCancel(): void}
export interface SourceEditing {
  open(text: string, callbacks: SourceEditCallbacks): void
  value(): string | null
  close(): void
}
export type ImageAction = 'draw' | 'select' | 'pan' | 'coordinates' | 'edit' | 'in' | 'out' | 'fit' | 'original'
export interface ImageControlState {
  name: string
  width: number
  height: number
  count: number
  usable: boolean
  selected: boolean
  tool: 'draw' | 'select' | 'pan'
  scale: number
}
export interface RegionDraft {
  editing: boolean
  bounds: {width: number; height: number}
  region: ImageRegion
  value: ComposerState
}
export interface RegionDraftActions {
  change(value: ComposerState, region: ImageRegion): void
  save(value: ComposerState, region: ImageRegion): boolean
  cancel(): void
}
export interface ImageControls {
  mount(root: HTMLElement, act: (action: ImageAction) => void): void
  render(state: ImageControlState): void
  compose(draft: RegionDraft, actions: RegionDraftActions): void
  region(region: ImageRegion): void
  closeComposer(): void
  dispose(): void
}
