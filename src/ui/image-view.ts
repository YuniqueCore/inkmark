import type { ImageAnnotator, ImageAnnotation, Color } from '@annotorious/annotorious'
import '@annotorious/annotorious/annotorious.css'
import type { ImageDocument, ImageRegion, RegionAnnotation } from '../core/types'
import { validRegion } from '../core/image'
import { newId } from '../core/identity'
import {canSubmitComposition, type ComposerState} from '../workbench/composition'
import type {ImageControls, ImageAction} from '../workbench/surface-controls'
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
  private selected: string | null = null
  private syncing = false
  private usable = false
  private visibleIds: Set<string> | null = null
  private zoom: number | null = null
  private resize: ResizeObserver

  constructor(private root: HTMLElement, private callbacks: ImageViewCallbacks, private controls: ImageControls) {
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
    this.renderControls()
  }

  private mount(): void {
    const doc = this.doc!
    this.root.innerHTML = `
      <p data-image-error role="alert" class="text-sm text-destructive px-5" hidden></p>
      <div class="image-viewport" tabindex="0" aria-label="图片批注画布">
        <div class="image-stage"><img draggable="false" alt="${escapeHtml(doc.name)}" /></div>
      </div>
      `
    this.controls.mount(this.root, action => this.action(action))
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
      this.renderControls()
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

  }

  private action(action: ImageAction): void {
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
    }
  }

  private sizeImage(): void {
    if (!this.doc || !this.image) return
    const viewport = this.root.querySelector<HTMLElement>('.image-viewport')!
    const fit = Math.min(1, Math.max(1, viewport.clientWidth - 48) / this.doc.image.width, Math.max(1, viewport.clientHeight - 48) / this.doc.image.height)
    const scale = this.zoom ?? fit
    this.image.style.width = `${this.doc.image.width * scale}px`
    this.image.style.height = `${this.doc.image.height * scale}px`
    this.renderControls()
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
        this.controls.region(this.draft.annotation.selector)
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
    this.setTool('select')
    this.syncAnnotations()
  }

  private saveDraft(form: ComposerState, selector: ImageRegion): boolean {
    if (!this.usable || !this.draft || !this.doc || !canSubmitComposition(form) || !validRegion(selector, this.doc.image)) return false
    const ann = {...this.draft.annotation, selector, kind: form.kind, comment: form.comment.trim(), updatedAt: Date.now()}
    if (!this.callbacks.onSave(this.doc.id, ann, this.draft.original)) return false
    this.cancelDraft()
    this.focus(ann.id)
    return true
  }

  private cancelDraft(): void {
    this.draft = null
    this.controls.closeComposer()
    this.syncAnnotations()
    this.setTool('draw')
  }

  private setTool(tool: 'draw' | 'select' | 'pan'): void {
    this.root.dataset.tool = tool
    if (tool === 'draw' || tool === 'pan') { this.selected = null; this.anno?.cancelSelected(); this.updateEditButton() }
    this.anno?.setDrawingEnabled(tool === 'draw')
    if (tool === 'select' && this.draft && this.anno?.getAnnotationById(this.draft.annotation.id)) this.anno.setSelected(this.draft.annotation.id)
    this.renderControls()
  }
  private updateEditButton(): void { this.renderControls() }
  private renderControls(): void {
    if (!this.doc) return
    this.controls.render({name: this.doc.name, width: this.doc.image.width, height: this.doc.image.height, count: this.doc.annotations.length,
      usable: this.usable, selected: Boolean(this.selected), tool: (this.root.dataset.tool ?? 'draw') as 'draw' | 'select' | 'pan',
      scale: this.image ? this.image.getBoundingClientRect().width / this.doc.image.width : 1})
  }

  private showError(message: string): void {
    const error = this.root.querySelector<HTMLElement>('[data-image-error]')
    if (error) { error.hidden = false; error.textContent = message }
  }

  private dispose(): void {
    this.controls.dispose()
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
