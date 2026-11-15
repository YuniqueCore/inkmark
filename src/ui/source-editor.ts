import type {SourceEditing, SourceEditCallbacks} from '../workbench/surface-controls'

export class SourceEditor implements SourceEditing {
  constructor(private root: HTMLElement) {}
  /** 编辑原文模式：textarea 直改规范文本；完成时由 main 统一重锚批注。 */
  open(text: string, callbacks: SourceEditCallbacks): void {
    this.root.innerHTML = `
      <div class="mx-auto flex h-full max-w-[880px] flex-col">
        <textarea id="edit-source" class="input-base mt-4 min-h-0 flex-1 resize-none font-mono text-[14px] leading-[1.9]" spellcheck="false"></textarea>
        <div class="my-4 flex items-center justify-between rounded-xl border bg-card/60 px-4 py-3">
          <span class="text-xs text-muted-foreground">直接修改规范文本；完成后批注将按引文自动重新锚定，改不掉的钉在改动处。</span>
          <span class="flex gap-2">
            <button class="btn btn-outline btn-sm" data-op="cancel-edit-text">取消</button>
            <button class="btn btn-default btn-sm" data-op="save-edit-text">完成并重锚批注</button>
          </span>
        </div>
      </div>`
    const ta = this.root.querySelector('#edit-source') as HTMLTextAreaElement
    ta.value = text
    this.root.querySelector('[data-op="save-edit-text"]')?.addEventListener('click', () => callbacks.onSave(ta.value))
    this.root.querySelector('[data-op="cancel-edit-text"]')?.addEventListener('click', () => callbacks.onCancel())
  }

  /** 编辑模式下的 textarea 当前内容；不在编辑模式时返回 null */
  value(): string | null {
    const ta = this.root.querySelector('#edit-source') as HTMLTextAreaElement | null
    return ta ? ta.value : null
  }

  close(): void {}
}
