import type {ReviewDocument, TrashEntry} from '../core/types'

export interface WorkspaceState {docs: ReviewDocument[]; activeDocId: string; trash: TrashEntry[]}

/** The workbench's sole mutable document reference. Presentation changes never mark it dirty. */
export class WorkspaceStore {
  private value: WorkspaceState = {docs: [], activeDocId: '', trash: []}
  constructor(private changed: () => void) {}
  get current(): WorkspaceState { return this.value }
  set current(next: WorkspaceState) {
    if (next.docs === this.value.docs && next.trash === this.value.trash && next.activeDocId === this.value.activeDocId) return
    this.value = next
    this.changed()
  }
}
