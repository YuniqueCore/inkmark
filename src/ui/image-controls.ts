import {ComposerForm} from './composer'
import {escapeHtml} from '../core/text'
import {validRegion, describeRegion} from '../core/image'
import type {ImageRegion} from '../core/types'
import type {ImageControls, ImageControlState, ImageAction, RegionDraft, RegionDraftActions} from '../workbench/surface-controls'

export class BrowserImageControls implements ImageControls {
  private root: HTMLElement | null = null
  private state: ImageControlState | null = null
  private composer: ComposerForm | null = null
  private actions: RegionDraftActions | null = null
  mount(root: HTMLElement, act: (action: ImageAction) => void): void {
    this.root = root
    const doc = {name: '', image: {width: 0, height: 0}}
    root.insertAdjacentHTML('afterbegin', `      <div class="image-toolbar" aria-label="图片工具栏">
        <div class="image-actions">
          <button class="btn btn-default btn-sm" data-image-action="draw" disabled aria-pressed="true">框选区域</button>
          <button class="btn btn-outline btn-sm" data-image-action="select" disabled aria-pressed="false">选择 / 调整</button>
          <button class="btn btn-ghost btn-sm" data-image-action="pan" title="触屏滑动或用滚动条浏览放大的图片" aria-pressed="false">平移浏览</button>
          <button class="btn btn-ghost btn-sm" data-image-action="coordinates" disabled>坐标批注</button>
          <button class="btn btn-ghost btn-sm" data-image-action="edit" disabled>编辑批注</button>
        </div>
        <div class="image-actions">
          <button class="btn btn-ghost btn-sm" data-image-action="out" aria-label="缩小图片">−</button>
          <output data-image-zoom aria-label="图片缩放比例">适应</output>
          <button class="btn btn-ghost btn-sm" data-image-action="in" aria-label="放大图片">+</button>
          <button class="btn btn-ghost btn-sm" data-image-action="fit">适应窗口</button>
          <button class="btn btn-ghost btn-sm" data-image-action="original">100%</button>
        </div>
      </div>
      <div class="image-caption"><span>${escapeHtml(doc.name)} · ${doc.image.width} × ${doc.image.height} px</span><span data-image-count></span></div>
`)
    root.insertAdjacentHTML('beforeend', '<p class="image-hint">拖动框选，写下意见。选择区域可调整边界；也可用坐标精确输入。</p><div class="image-composer" hidden></div>')
    root.querySelectorAll<HTMLButtonElement>('[data-image-action]').forEach(button => button.addEventListener('click', () => act(button.dataset.imageAction as ImageAction)))
  }
  render(state: ImageControlState): void {
    this.state = state
    if (!this.root) return
    this.root.querySelector('.image-caption span')!.textContent = `${state.name} · ${state.width} × ${state.height} px`
    this.root.querySelector('[data-image-count]')!.textContent = `${state.count} 处批注`
    this.root.querySelector('output')!.textContent = `${state.scale < .01 ? (state.scale * 100).toFixed(2) : Math.round(state.scale * 100)}%`
    for (const action of ['draw', 'select', 'coordinates']) this.root.querySelector<HTMLButtonElement>(`[data-image-action="${action}"]`)!.disabled = !state.usable
    this.root.querySelector<HTMLButtonElement>('[data-image-action="edit"]')!.disabled = !state.selected
    for (const action of ['draw', 'select', 'pan']) this.root.querySelector(`[data-image-action="${action}"]`)!.setAttribute('aria-pressed', String(action === state.tool))
  }
  compose(draft: RegionDraft, actions: RegionDraftActions): void {
    if (!this.root) return
    this.actions = actions
    const host = this.root.querySelector<HTMLElement>('.image-composer')!
    host.hidden = false
    host.innerHTML = `<div class="image-composer-title"><strong>${draft.editing ? '编辑区域批注' : '新建区域批注'}</strong><button class="btn btn-ghost btn-sm" data-image-cancel>取消</button></div>
      <p data-region-summary class="text-xs text-muted-foreground"></p>
      <div class="image-coordinates">${(['x', 'y', 'width', 'height'] as const).map((key) => `<label>${({x: 'X', y: 'Y', width: '宽', height: '高'})[key]}<input class="input-base" type="number" step="1" min="${key === 'x' || key === 'y' ? 0 : 1}" aria-label="区域${key}" data-coordinate="${key}" value="${draft.region[key]}" /></label>`).join('')}</div>
      <p data-region-error class="text-xs text-destructive" role="alert"></p><div data-image-form></div>
      <div class="image-composer-footer"><span class="text-xs text-muted-foreground">⌘ / Ctrl + Enter 保存</span><button class="btn btn-default btn-sm" data-image-save>保存批注</button></div>`
    this.composer = new ComposerForm(host.querySelector('[data-image-form]')!, {onChange: value => {
      actions.change(value, this.coordinates()); this.refresh()
    }}, draft.value, {image: true, commentClass: 'min-h-20 resize-y'})
    this.composer.render()
    host.querySelector('[data-image-save]')!.addEventListener('click', () => this.submit())
    host.querySelector('[data-image-cancel]')!.addEventListener('click', actions.cancel)
    host.addEventListener('keydown', event => {
      if (event.isComposing) return
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); this.submit() }
    })
    host.querySelectorAll<HTMLInputElement>('[data-coordinate]').forEach(input => input.addEventListener('input', () => {
      if (this.composer) actions.change(this.composer.state(), this.coordinates())
      this.refresh()
    }))
    this.region(draft.region)
    this.composer.focusComment()
  }
  private coordinates(): ImageRegion {
    const read = (key: string) => this.root!.querySelector<HTMLInputElement>(`[data-coordinate="${key}"]`)!.valueAsNumber
    return {type: 'rectangle', x: read('x'), y: read('y'), width: read('width'), height: read('height')}
  }
  region(region: ImageRegion): void {
    this.root?.querySelectorAll<HTMLInputElement>('[data-coordinate]').forEach(input => {
      if (input !== document.activeElement) input.value = String(region[input.dataset.coordinate as 'x' | 'y' | 'width' | 'height'])
    })
    const summary = this.root?.querySelector('[data-region-summary]')
    if (summary) summary.textContent = describeRegion(region)
    this.refresh()
  }
  private refresh(): void {
    if (!this.composer || !this.root || !this.state) return
    const valid = validRegion(this.coordinates(), this.state)
    this.root.querySelector('[data-region-error]')!.textContent = valid ? '' : '请输入图片范围内的整数坐标，宽高至少为 1 px。'
    this.root.querySelector<HTMLButtonElement>('[data-image-save]')!.disabled = !this.composer.canSubmit() || !valid
  }
  private submit(): void {
    if (this.composer?.canSubmit() && this.state && validRegion(this.coordinates(), this.state)) this.actions?.save(this.composer.state(), this.coordinates())
  }
  closeComposer(): void {
    this.composer = null; this.actions = null
    const host = this.root?.querySelector<HTMLElement>('.image-composer')
    if (host) { host.hidden = true; host.replaceChildren() }
  }
  dispose(): void { this.closeComposer(); this.root = null; this.state = null }
}
