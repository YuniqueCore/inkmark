import type { ImageAnnotator, ImageAnnotation, Color } from '@annotorious/annotorious'
import '@annotorious/annotorious/annotorious.css'
import type { ImageDocument, ImageRegion, RegionAnnotation } from '../core/types'
import { describeRegion, validRegion } from '../core/image'
import { newId } from '../core/identity'
import { ComposerForm, type ComposerState } from './composer'
import { fromCanvasAnnotation, toCanvasAnnotation } from './image-annotations'
import { escapeHtml } from '../core/text'

interface ImageViewCallbacks {
  onSave: (docId: string, annotation: RegionAnnotation, expected?: RegionAnnotation) => boolean
  onFocus: (id: string) => void
  onNotify: (message: string) => void
}
interface Draft {
  annotation: RegionAnnotation
  original?: RegionAnnotation
  form: ComposerState
}

/** Image surface, isolated from text editing and shared sidebar state. */
export class ImageView {
  private doc: ImageDocument | null = null
  private anno: ImageAnnotator | null = null
  private image: HTMLImageElement | null = null
  private draft: Draft | null = null
  private composer: ComposerForm | null = null
  private selected: string | null = null
  private syncing = false
  private usable = false
  private visibleIds: Set<string> | null = null
  private zoom: number | null = null
  private resize: ResizeObserver

  constructor(private root: HTMLElement, private callbacks: ImageViewCallbacks) {
    this.resize = new ResizeObserver(() => { if (this.zoom === null) this.sizeImage() })
    this.resize.observe(root)
    root.addEventListener('pointerup', () => queueMicrotask(() => this.flushGeometry()))
    root.addEventListener('keydown', (e) => {
      if (e.isComposing) return
      if (e.key === 'Escape') {
        e.stopPropagation()
        if (this.draft) this.cancelDraft()
        else this.anno?.cancelDrawing()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && this.draft) {
        e.preventDefault()
        this.saveDraft()
      }
    })
  }

  refreshStyle(): void { this.syncAnnotations() }

  hasDraft(): boolean { return this.draft !== null }

  render(doc: ImageDocument | null, visible?: RegionAnnotation[]): void {
    if (!doc) { this.dispose(); this.root.hidden = true; return }
    this.root.hidden = false
    this.visibleIds = new Set((visible ?? doc.annotations).map((a) => a.id))
    if (this.doc?.id !== doc.id || this.doc.image !== doc.image) {
      this.dispose()
      this.doc = doc
      this.zoom = null
      this.mount()
    } else this.doc = doc
    this.syncAnnotations()
    const count = this.root.querySelector('[data-image-count]')
    if (count) count.textContent = `${doc.annotations.length} 处批注`
  }

  private mount(): void {
    const doc = this.doc!
    this.root.innerHTML = `
      <div class="image-toolbar" aria-label="图片工具栏">
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
      <p data-image-error role="alert" class="text-sm text-destructive px-5" hidden></p>
      <div class="image-viewport" tabindex="0" aria-label="图片批注画布">
        <div class="image-stage"><img draggable="false" alt="${escapeHtml(doc.name)}" /></div>
      </div>
      <p class="image-hint">拖动框选，写下意见。选择区域可拖动或调整边界；也可用「坐标批注」精确输入。</p>
      <div class="image-composer" hidden></div>`
    this.image = this.root.querySelector('img')!
    this.image.src = doc.image.dataUrl
    const image = this.image
    void image.decode().then(async () => {
      const {createImageAnnotator} = await import('@annotorious/annotorious')
      if (this.image !== image) return
      if (image.naturalWidth !== doc.image.width || image.naturalHeight !== doc.image.height) {
        this.showError('图片尺寸不匹配，已禁止标注。请重新导入原图。')
        return
      }
      this.sizeImage()
      this.anno = createImageAnnotator(image, {autoSave: true, drawingMode: 'drag', disableUndoRedoKeys: true})
      this.anno.setDrawingTool('rectangle')
      this.setTool('draw')
      this.usable = true
      this.root.querySelectorAll<HTMLButtonElement>('[data-image-action="draw"], [data-image-action="select"], [data-image-action="coordinates"]').forEach((b) => { b.disabled = false })
      this.anno.on('createAnnotation', (annotation: ImageAnnotation) => {
        if (this.syncing || this.draft || !this.doc) return
        const region = fromCanvasAnnotation(annotation, this.doc.image)
        this.anno?.removeAnnotation(annotation.id)
        if (region) this.startDraft(region)
      })
      this.anno.on('updateAnnotation', () => this.flushGeometry())
      this.anno.on('selectionChanged', (annotations: ImageAnnotation[]) => {
        if (this.syncing || this.draft) return
        this.selected = annotations[0]?.id ?? null
        this.updateEditButton()
        if (this.selected) this.callbacks.onFocus(this.selected)
      })
      this.syncAnnotations()
    }).catch(() => { if (this.image === image) this.showError('图片无法解码，请从备份或原文件重新导入') })
    this.root.querySelectorAll<HTMLButtonElement>('[data-image-action]').forEach((button) => {
      button.addEventListener('click', () => this.action(button.dataset.imageAction!))
    })
  }

  private action(action: string): void {
    if (!this.doc) return
    if (action === 'in' || action === 'out' || action === 'fit' || action === 'original') {
      const current = this.image!.getBoundingClientRect().width / this.doc.image.width
      this.zoom = action === 'fit' ? null : action === 'original' ? 1 : Math.max(Math.min(current, 1 / Math.max(this.doc.image.width, this.doc.image.height)), Math.min(4, current * (action === 'in' ? 1.25 : 0.8)))
      this.sizeImage()
      return
    }
    if (!this.usable) return
    if (this.draft && action !== 'pan' && action !== 'select') { this.callbacks.onNotify('请先保存或取消当前区域批注'); return }
    if (action === 'pan') this.setTool('pan')
    if (action === 'edit' && this.selected) this.edit(this.selected)
    if (action === 'draw' || action === 'select') this.setTool(action)
    if (action === 'coordinates') {
      this.startDraft({type: 'rectangle', x: 0, y: 0, width: Math.min(100, this.doc.image.width), height: Math.min(100, this.doc.image.height)})
      this.root.querySelector<HTMLInputElement>('[data-coordinate="x"]')?.focus()
    }
  }

  private sizeImage(): void {
    if (!this.doc || !this.image) return
    const viewport = this.root.querySelector<HTMLElement>('.image-viewport')!
    const fit = Math.min(1, Math.max(1, viewport.clientWidth - 48) / this.doc.image.width, Math.max(1, viewport.clientHeight - 48) / this.doc.image.height)
    const scale = this.zoom ?? fit
    this.image.style.width = `${this.doc.image.width * scale}px`
    this.image.style.height = `${this.doc.image.height * scale}px`
    this.root.querySelector('output')!.textContent = `${scale < 0.01 ? (scale * 100).toFixed(2) : Math.round(scale * 100)}%`
  }

  private syncAnnotations(): void {
    if (!this.anno || !this.doc) return
    this.syncing = true
    const items = this.doc.annotations.filter((a) => this.visibleIds?.has(a.id) && a.id !== this.draft?.annotation.id)
    if (this.draft) items.push(this.draft.annotation)
    this.anno.setAnnotations(items.map(toCanvasAnnotation))
    this.anno.setStyle((a) => {
      const ann = items.find((item) => item.id === a.id)
      const color = getComputedStyle(this.root).getPropertyValue(`--kind-${ann?.kind ?? 'suggestion'}`).trim() as Color
      return {stroke: color || '#3b82f6', strokeWidth: 2, fill: color || '#3b82f6', fillOpacity: ann?.status === 'resolved' ? 0.04 : 0.12}
    })
    if (this.draft) this.anno.setSelected(this.draft.annotation.id)
    else if (this.selected && items.some((a) => a.id === this.selected)) this.anno.setSelected(this.selected)
    this.syncing = false
  }

  flushGeometry(): void {
    if (this.syncing || !this.doc || !this.anno) return
    for (const drawn of this.anno.getAnnotations()) {
      const region = fromCanvasAnnotation(drawn, this.doc.image, true)
      if (!region) { this.syncAnnotations(); this.callbacks.onNotify('区域不能超出图片，已恢复之前的位置'); return }
      if (drawn.id === this.draft?.annotation.id) {
        if (JSON.stringify(region) === JSON.stringify(this.draft.annotation.selector)) continue
        this.draft.annotation = {...this.draft.annotation, selector: region}
        this.syncCoordinateInputs()
        continue
      }
      const existing = this.doc.annotations.find((a) => a.id === drawn.id)
      if (existing && JSON.stringify(existing.selector) !== JSON.stringify(region)) {
        this.callbacks.onSave(this.doc.id, {...existing, selector: region, updatedAt: Date.now()}, existing)
      }
    }
  }

  focus(id: string): void {
    if (this.draft && this.draft.annotation.id !== id) return
    this.selected = id
    this.setTool('select')
    this.anno?.setSelected(id)
    this.updateEditButton()
    const region = this.doc?.annotations.find((a) => a.id === id)?.selector
    const viewport = this.root.querySelector<HTMLElement>('.image-viewport')
    if (region && viewport && this.image && this.doc) {
      const box = this.image.getBoundingClientRect()
      const frame = viewport.getBoundingClientRect()
      const scale = box.width / this.doc.image.width
      viewport.scrollTo({
        left: viewport.scrollLeft + box.left - frame.left + (region.x + region.width / 2) * scale - viewport.clientWidth / 2,
        top: viewport.scrollTop + box.top - frame.top + (region.y + region.height / 2) * scale - viewport.clientHeight / 2,
        behavior: 'smooth',
      })
    }
  }

  edit(id: string): void {
    if (!this.usable) return
    if (this.draft) { this.callbacks.onNotify('请先保存或取消当前区域批注'); return }
    const annotation = this.doc?.annotations.find((a) => a.id === id)
    if (annotation) { this.focus(id); this.startDraft(annotation.selector, annotation) }
  }

  private startDraft(selector: ImageRegion, original?: RegionAnnotation): void {
    const now = Date.now()
    const annotation = original ?? {id: newId('ann'), kind: 'suggestion', comment: '', status: 'open', source: 'manual', selector, createdAt: now, updatedAt: now}
    this.draft = {annotation, original, form: {kind: annotation.kind, comment: annotation.comment, replacement: ''}}
    this.setTool('select')
    this.renderComposer()
    this.syncAnnotations()
    this.composer?.focusComment()
  }

  private renderComposer(): void {
    if (!this.draft || !this.doc) return
    const host = this.root.querySelector<HTMLElement>('.image-composer')!
    host.hidden = false
    host.innerHTML = `<div class="image-composer-title"><strong>${this.draft.original ? '编辑区域批注' : '新建区域批注'}</strong><button class="btn btn-ghost btn-sm" data-image-cancel>取消</button></div>
      <p data-region-summary class="text-xs text-muted-foreground"></p>
      <div class="image-coordinates">${(['x', 'y', 'width', 'height'] as const).map((key) => `<label>${({x: 'X', y: 'Y', width: '宽', height: '高'})[key]}<input class="input-base" type="number" step="1" min="${key === 'x' || key === 'y' ? 0 : 1}" aria-label="区域${key}" data-coordinate="${key}" value="${this.draft!.annotation.selector[key]}" /></label>`).join('')}</div>
      <p data-region-error class="text-xs text-destructive" role="alert"></p><div data-image-form></div>
      <div class="image-composer-footer"><span class="text-xs text-muted-foreground">⌘ / Ctrl + Enter 保存</span><button class="btn btn-default btn-sm" data-image-save>保存批注</button></div>`
    this.composer = new ComposerForm(host.querySelector('[data-image-form]')!, {onChange: (form) => {
      if (this.draft) this.draft.form = form
      this.updateSaveButton()
    }}, this.draft.form, {image: true, commentClass: 'min-h-20 resize-y'})
    this.composer.render()
    host.querySelector('[data-image-save]')!.addEventListener('click', () => this.saveDraft())
    host.querySelector('[data-image-cancel]')!.addEventListener('click', () => this.cancelDraft())
    host.querySelectorAll<HTMLInputElement>('[data-coordinate]').forEach((input) => input.addEventListener('input', () => {
      if (!this.draft || !this.doc) return
      const region = this.readCoordinates()
      const valid = validRegion(region, this.doc.image)
      host.querySelector('[data-region-error]')!.textContent = valid ? '' : '请输入图片范围内的整数坐标，宽高至少为 1 px。'
      if (valid) { this.draft.annotation = {...this.draft.annotation, selector: region}; this.syncAnnotations() }
      this.updateSaveButton()
    }))
    this.syncCoordinateInputs()
    this.updateSaveButton()
  }

  private readCoordinates(): ImageRegion {
    const read = (key: string) => this.root.querySelector<HTMLInputElement>(`[data-coordinate="${key}"]`)!.valueAsNumber
    return {type: 'rectangle', x: read('x'), y: read('y'), width: read('width'), height: read('height')}
  }

  private syncCoordinateInputs(): void {
    if (!this.draft) return
    const region = this.draft.annotation.selector
    this.root.querySelectorAll<HTMLInputElement>('[data-coordinate]').forEach((input) => {
      if (input !== document.activeElement) input.value = String(region[input.dataset.coordinate as 'x' | 'y' | 'width' | 'height'])
    })
    const summary = this.root.querySelector('[data-region-summary]')
    if (summary) summary.textContent = describeRegion(region)
    this.updateSaveButton()
  }

  private updateSaveButton(): void {
    const button = this.root.querySelector<HTMLButtonElement>('[data-image-save]')
    if (!button || !this.doc) return
    const valid = validRegion(this.readCoordinates(), this.doc.image)
    const error = this.root.querySelector('[data-region-error]')
    if (error) error.textContent = valid ? '' : '请输入图片范围内的整数坐标，宽高至少为 1 px。'
    button.disabled = !this.composer?.canSubmit() || !valid
  }

  private saveDraft(): void {
    if (!this.usable || !this.draft || !this.doc || !this.composer?.canSubmit()) return
    const selector = this.readCoordinates()
    if (!validRegion(selector, this.doc.image)) return
    const form = this.composer.state()
    const ann = {...this.draft.annotation, selector, kind: form.kind, comment: form.comment.trim(), updatedAt: Date.now()}
    if (this.callbacks.onSave(this.doc.id, ann, this.draft.original)) {
      this.cancelDraft()
      this.focus(ann.id)
    }
  }

  private cancelDraft(): void {
    this.draft = null
    this.composer = null
    const host = this.root.querySelector<HTMLElement>('.image-composer')
    if (host) { host.hidden = true; host.replaceChildren() }
    this.syncAnnotations()
    this.setTool('draw')
  }

  private setTool(tool: 'draw' | 'select' | 'pan'): void {
    this.root.dataset.tool = tool
    if (tool === 'draw' || tool === 'pan') { this.selected = null; this.anno?.cancelSelected(); this.updateEditButton() }
    this.anno?.setDrawingEnabled(tool === 'draw')
    if (tool === 'select' && this.draft) this.anno?.setSelected(this.draft.annotation.id)
    for (const name of ['draw', 'select', 'pan']) {
      this.root.querySelector(`[data-image-action="${name}"]`)?.setAttribute('aria-pressed', String(name === tool))
    }
  }
  private updateEditButton(): void {
    const button = this.root.querySelector<HTMLButtonElement>('[data-image-action="edit"]')
    if (button) button.disabled = !this.selected
  }
  private showError(message: string): void {
    const error = this.root.querySelector<HTMLElement>('[data-image-error]')
    if (error) { error.hidden = false; error.textContent = message }
  }

  private dispose(): void {
    this.usable = false
    this.anno?.destroy()
    this.anno = null
    this.doc = null
    this.image = null
    this.draft = null
    this.selected = null
    this.root.replaceChildren()
  }
}
