import type { ImageDocument, ImageRegion, RegionAnnotation } from '../core/types'
import { validRegion } from '../core/image'
import { newId } from '../core/identity'
import {canSubmitComposition, type ComposerState} from '../workbench/composition'
import type {ImageControls, ImageAction} from '../workbench/surface-controls'
import type {ImageCanvas} from './image-canvas'
import { escapeHtml } from '../core/text'

interface ImageViewCallbacks {
  onSave: (docId: string, annotation: RegionAnnotation, expected?: RegionAnnotation) => boolean
  onFocus: (id: string | null) => void
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
  private canvas: ImageCanvas | null = null
  private image: HTMLImageElement | null = null
  private draft: Draft | null = null
  private selected: string | null = null
  private usable = false
  private visibleIds: Set<string> | null = null
  private zoom: number | null = null
  private offset = {x: 0, y: 0}
  private resize: ResizeObserver

  constructor(private root: HTMLElement, private callbacks: ImageViewCallbacks, private controls: ImageControls) {
    this.resize = new ResizeObserver(() => { this.canvas?.cancelGesture(); this.sizeImage() })
    root.addEventListener('keydown', (e) => {
      if (e.isComposing) return
      if (e.key === 'Escape') {
        e.stopPropagation()
        if (this.draft) this.cancelDraft()
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
      this.offset = {x: 0, y: 0}
      this.mount()
    } else this.doc = doc
    this.syncAnnotations()
    this.renderControls()
  }

  private mount(): void {
    const doc = this.doc!
    this.root.innerHTML = `
      <p data-image-error role="alert" class="text-sm text-destructive px-5" hidden></p>
      <div class="image-viewport" tabindex="0" aria-label="图片批注画布">
        <div class="image-stage"><img draggable="false" alt="${escapeHtml(doc.name)}" /></div>
        <div class="image-canvas"></div>
      </div>
      `
    this.controls.mount(this.root, action => this.action(action))
    this.image = this.root.querySelector('img')!
    this.resize.observe(this.root.querySelector('.image-viewport')!)
    this.image.src = doc.image.dataUrl
    const image = this.image
    void image.decode().then(async () => {
      const {ImageCanvas} = await import('./image-canvas')
      if (this.image !== image) return
      if (image.naturalWidth !== doc.image.width || image.naturalHeight !== doc.image.height) {
        this.showError('图片尺寸不匹配，已禁止标注。请重新导入原图。')
        return
      }
      this.sizeImage()
      this.canvas = new ImageCanvas(this.root.querySelector('.image-viewport')!, image, {
        select: id => { if (!this.draft) this.select(id) },
        pan: (x, y) => this.pan(x, y),
        create: region => this.startDraft(region),
        change: (original, region) => this.changeRegion(original, region),
        zoom: (factor, anchor) => this.zoomAt(factor, anchor),
        edit: id => this.edit(id),
        invalid: () => this.callbacks.onNotify('区域不能超出图片，已恢复之前的位置'),
      })
      this.usable = true
      this.renderControls()
      this.syncAnnotations()
    }).catch(() => { if (this.image === image) this.showError('图片无法解码，请从备份或原文件重新导入') })

  }

  private action(action: ImageAction): void {
    if (!this.doc) return
    if (action === 'in' || action === 'out' || action === 'fit' || action === 'original') {
      this.canvas?.cancelGesture()
      if (action === 'fit') { this.zoom = null; this.offset = {x: 0, y: 0}; this.sizeImage() }
      else {
        const frame = this.root.querySelector('.image-viewport')!.getBoundingClientRect()
        const current = this.image!.getBoundingClientRect().width / this.doc.image.width
        this.zoomAt(action === 'original' ? 1 / current : action === 'in' ? 1.25 : .8, {x: frame.left + frame.width / 2, y: frame.top + frame.height / 2})
      }
      return
    }
    if (!this.usable) return
    if (this.draft) { this.callbacks.onNotify('请先保存或取消当前区域批注'); return }
    if (action === 'edit' && this.selected) this.edit(this.selected)
    if (action === 'coordinates') {
      this.canvas?.cancelGesture()
      this.startDraft({type: 'rectangle', x: 0, y: 0, width: Math.min(100, this.doc.image.width), height: Math.min(100, this.doc.image.height)})
    }
  }

  private sizeImage(): void {
    if (!this.doc || !this.image) return
    const viewport = this.root.querySelector<HTMLElement>('.image-viewport')!
    const fit = Math.min(1, Math.max(1, viewport.clientWidth - 48) / this.doc.image.width, Math.max(1, viewport.clientHeight - 48) / this.doc.image.height)
    const scale = this.zoom ?? fit
    this.image.style.width = `${this.doc.image.width * scale}px`
    this.image.style.height = `${this.doc.image.height * scale}px`
    this.positionImage()
    this.renderControls()
  }

  private positionImage(): void {
    if (!this.image) return
    const viewport = this.root.querySelector<HTMLElement>('.image-viewport')!
    const stage = this.root.querySelector<HTMLElement>('.image-stage')!
    const box = this.image.getBoundingClientRect()
    stage.style.left = `${(viewport.clientWidth - box.width) / 2 + this.offset.x}px`
    stage.style.top = `${(viewport.clientHeight - box.height) / 2 + this.offset.y}px`
    this.canvas?.layout()
  }

  private pan(x: number, y: number): void {
    this.offset = {x: this.offset.x + x, y: this.offset.y + y}
    this.positionImage()
  }

  private select(id: string | null): void {
    this.selected = id
    this.syncAnnotations()
    this.renderControls()
    this.callbacks.onFocus(id)
  }

  private syncAnnotations(): void {
    if (!this.canvas || !this.doc) return
    const items = this.doc.annotations.filter(a => this.visibleIds?.has(a.id) && a.id !== this.draft?.annotation.id)
    if (this.draft) items.push(this.draft.annotation)
    if (this.selected && !items.some(item => item.id === this.selected)) {
      this.selected = null
      this.callbacks.onFocus(null)
    }
    this.canvas.render(items, this.draft?.annotation.id ?? this.selected, Boolean(this.draft))
  }

  private zoomAt(factor: number, anchor: {x: number; y: number}): void {
    if (!this.doc || !this.image) return
    const before = this.image.getBoundingClientRect()
    const point = {x: (anchor.x - before.left) / before.width, y: (anchor.y - before.top) / before.height}
    const current = before.width / this.doc.image.width
    this.zoom = Math.max(Math.min(current, 1 / Math.max(this.doc.image.width, this.doc.image.height)), Math.min(4, current * factor))
    this.sizeImage()
    const after = this.image.getBoundingClientRect()
    this.pan(anchor.x - after.left - point.x * after.width, anchor.y - after.top - point.y * after.height)
  }

  private changeRegion(original: RegionAnnotation, region: ImageRegion): boolean {
    if (!this.doc) return false
    if (JSON.stringify(original.selector) === JSON.stringify(region)) return true
    if (original.id === this.draft?.annotation.id) {
      this.draft.annotation = {...this.draft.annotation, selector: region}
      this.controls.region(region)
      this.syncAnnotations()
      return true
    }
    return this.callbacks.onSave(this.doc.id, {...original, selector: region, updatedAt: Date.now()}, original)
  }

  cancelGesture(): void { this.canvas?.cancelGesture() }

  focus(id: string): void {
    if (this.draft && this.draft.annotation.id !== id) return
    this.canvas?.cancelGesture()
    this.select(id)
    const region = this.doc?.annotations.find(a => a.id === id)?.selector
    const viewport = this.root.querySelector<HTMLElement>('.image-viewport')
    if (region && viewport && this.image && this.doc) {
      const box = this.image.getBoundingClientRect()
      const frame = viewport.getBoundingClientRect()
      const scale = box.width / this.doc.image.width
      this.pan(frame.left + frame.width / 2 - box.left - (region.x + region.width / 2) * scale,
        frame.top + frame.height / 2 - box.top - (region.y + region.height / 2) * scale)
    }
  }

  edit(id: string): void {
    if (!this.usable) return
    if (this.draft) { this.callbacks.onNotify('请先保存或取消当前区域批注'); return }
    const annotation = this.doc?.annotations.find((a) => a.id === id)
    if (annotation) { this.canvas?.cancelGesture(); this.select(id); this.startDraft(annotation.selector, annotation) }
  }

  private startDraft(selector: ImageRegion, original?: RegionAnnotation): void {
    if (this.draft) { this.callbacks.onNotify('请先保存或取消当前区域批注'); return }
    const now = Date.now()
    const annotation = original ?? {id: newId('ann'), kind: 'suggestion', comment: '', status: 'open', source: 'manual', selector, createdAt: now, updatedAt: now}
    const draft = {annotation, original, form: {kind: annotation.kind, comment: annotation.comment, replacement: ''}}
    try { this.controls.compose({editing: Boolean(original), bounds: {width: this.doc!.image.width, height: this.doc!.image.height}, region: selector, value: draft.form}, {
      change: (value, region) => {
        if (!this.draft || !this.doc) return
        this.draft.form = value
        if (validRegion(region, this.doc.image)) { this.draft.annotation = {...this.draft.annotation, selector: region}; this.syncAnnotations() }
      },
      save: (value, region) => this.saveDraft(value, region),
      cancel: () => this.cancelDraft(),
    }) } catch (error) {
      this.controls.closeComposer()
      this.callbacks.onNotify(error instanceof Error ? error.message : '无法打开区域批注，请重试')
      return
    }
    this.draft = draft
    this.syncAnnotations()
  }

  private saveDraft(form: ComposerState, selector: ImageRegion): boolean {
    if (!this.usable || !this.draft || !this.doc || !canSubmitComposition(form) || !validRegion(selector, this.doc.image)) return false
    const ann = {...this.draft.annotation, selector, kind: form.kind, comment: form.comment.trim(), updatedAt: Date.now()}
    if (!this.callbacks.onSave(this.doc.id, ann, this.draft.original)) return false
    this.cancelDraft()
    this.select(ann.id)
    return true
  }

  private cancelDraft(): void {
    this.draft = null
    this.controls.closeComposer()
    this.syncAnnotations()
    this.renderControls()
  }

  private renderControls(): void {
    if (!this.doc) return
    this.controls.render({name: this.doc.name, width: this.doc.image.width, height: this.doc.image.height, count: this.doc.annotations.length,
      usable: this.usable, selected: Boolean(this.selected),
      scale: this.image ? this.image.getBoundingClientRect().width / this.doc.image.width : 1})
  }

  private showError(message: string): void {
    const error = this.root.querySelector<HTMLElement>('[data-image-error]')
    if (error) { error.hidden = false; error.textContent = message }
  }

  private dispose(): void {
    this.resize.disconnect()
    this.controls.dispose()
    this.usable = false
    this.canvas?.destroy()
    this.canvas = null
    this.doc = null
    this.image = null
    this.draft = null
    this.selected = null
    this.root.replaceChildren()
  }
}
