export function renderWelcome(root: HTMLElement, onNew: () => void, onSample: () => void): void {
      root.innerHTML = `
        <div class="mx-auto mt-[16vh] max-w-md px-6 py-8 text-center">
          <div class="mx-auto mb-5 flex h-11 w-11 items-center justify-center text-muted-foreground">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="size-5 text-muted-foreground"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
          </div>
          <h2 class="text-2xl font-semibold tracking-tight">留下一点想法。</h2>
          <p class="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            粘贴或打开 .txt / .md，划选文字即可批注；<br>
            「slop 预扫描」会用 anti-slop 词库自动标出套话候选。
          </p>
          <div class="mt-5 flex items-center justify-center gap-2">
            <button class="btn btn-default btn-sm" id="btn-empty-paste">粘贴新建文档</button>
            <button class="btn btn-outline btn-sm" id="btn-empty-sample">载入示例文本</button>
          </div>
          <p class="mt-3 text-xs text-muted-foreground">也可以直接粘贴截图，或拖入 PNG / JPEG / WebP 图片进行区域批注</p>
        </div>`
      root.querySelector('#btn-empty-sample')?.addEventListener('click', () => onSample())
      root.querySelector('#btn-empty-paste')?.addEventListener('click', onNew)
}
