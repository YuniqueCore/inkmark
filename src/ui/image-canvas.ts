import Konva from 'konva'
import {normalizeRegion, validRegion} from '../core/image'
import type {ImageRegion, RegionAnnotation} from '../core/types'

type Point = {x: number; y: number}
type Gesture = {type: 'idle'} | {type: 'draw'; id: number; start: Point}
  | {type: 'pan'; id: number; last: Point} | {type: 'pinch'; center: Point; distance: number} | {type: 'blocked'}
interface CanvasCallbacks {
  select(id: string | null): void
  create(region: ImageRegion): void
  change(original: RegionAnnotation, region: ImageRegion): boolean
  pan(x: number, y: number): void
  zoom(factor: number, anchor: Point): void
  edit(id: string): void
  invalid(): void
}

/** A viewport-sized geometry layer over the original image. Konva owns hit testing,
 * object dragging and resize handles; viewport gestures never mutate annotations. */
export class ImageCanvas {
  private stage: Konva.Stage
  private layer = new Konva.Layer()
  private transformer = new Konva.Transformer({rotateEnabled: false, flipEnabled: false, keepRatio: false,
    ignoreStroke: true, padding: 0, anchorSize: 10, anchorCornerRadius: 5, borderStroke: '#0866ce', anchorStroke: '#0866ce'})
  private drawing = new Konva.Rect({listening: false, stroke: '#0866ce', strokeWidth: 2, strokeScaleEnabled: false, fill: '#0866ce22', visible: false})
  private nodes = new Map<string, Konva.Rect>()
  private annotations = new Map<string, RegionAnnotation>()
  private selected: string | null = null
  private locked = false
  private original: RegionAnnotation | null = null
  private restoring = false
  private gesture: Gesture = {type: 'idle'}
  private pointers = new Map<number, Point>()
  private space = false
  private scope = new AbortController()

  constructor(private viewport: HTMLElement, private image: HTMLImageElement, private callbacks: CanvasCallbacks) {
    const host = viewport.querySelector<HTMLDivElement>('.image-canvas')!
    this.stage = new Konva.Stage({container: host, width: 1, height: 1})
    this.stage.add(this.layer)
    this.layer.add(this.drawing, this.transformer)
    this.transformer.on('transformstart', () => this.beginEdit())
    this.transformer.on('transformend', () => this.commit())
    const options = {signal: this.scope.signal, capture: true}
    window.addEventListener('pointerdown', event => {
      if (this.pointers.size && event.target instanceof Node && !viewport.contains(event.target)) this.cancel(true)
    }, options)
    viewport.addEventListener('pointerdown', event => this.down(event), options)
    window.addEventListener('pointermove', event => {
      if (this.pointers.has(event.pointerId) || (event.target instanceof Node && viewport.contains(event.target))) this.move(event)
    }, options)
    window.addEventListener('pointerup', event => { if (this.pointers.has(event.pointerId)) this.up(event) }, options)
    window.addEventListener('pointercancel', event => {
      if (this.pointers.delete(event.pointerId)) this.cancel(true)
    }, options)
    viewport.addEventListener('lostpointercapture', event => { if (event.target === viewport && this.pointers.has(event.pointerId) && this.gesture.type !== 'idle') this.cancel(true) }, options)
    // Konva's object dragging uses mouse/touch events. Only viewport-owned
    // gestures suppress them; existing objects and their handles remain native Konva gestures.
    for (const type of ['mousedown', 'mousemove', 'mouseup', 'touchstart', 'touchmove', 'touchend']) {
      viewport.addEventListener(type, event => {
        if (this.gesture.type !== 'idle') { event.preventDefault(); event.stopImmediatePropagation() }
      }, {...options, passive: false})
    }
    viewport.addEventListener('keydown', event => {
      if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.target !== viewport) return
      if (event.key === 'Escape') {
        event.preventDefault()
        if (this.gesture.type !== 'idle' || this.original) event.stopPropagation()
        this.cancel(true)
        if (!this.locked) this.callbacks.select(null)
      }
      const direction = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]}[event.key]
      if (direction && !this.pointers.size) {
        event.preventDefault()
        const annotation = this.selected && this.annotations.get(this.selected)
        if (annotation && !this.space) {
          const step = event.shiftKey ? 10 : 1
          const region = {...annotation.selector, x: annotation.selector.x + direction[0]! * step, y: annotation.selector.y + direction[1]! * step}
          if (validRegion(region, {width: image.naturalWidth, height: image.naturalHeight})) this.callbacks.change(annotation, region)
          else this.callbacks.invalid()
        } else {
          this.callbacks.pan(-direction[0]! * 40, -direction[1]! * 40)
        }
        this.layout()
      }
      if (['PageUp', 'PageDown', 'Home', 'End'].includes(event.key) && !this.pointers.size) {
        event.preventDefault()
        if (event.key === 'Home' || event.key === 'End') {
          const frame = viewport.getBoundingClientRect(), box = image.getBoundingClientRect()
          this.callbacks.pan(event.key === 'Home' ? frame.left + 24 - box.left : frame.right - 24 - box.right,
            event.key === 'Home' ? frame.top + 24 - box.top : frame.bottom - 24 - box.bottom)
        } else this.callbacks.pan(0, viewport.clientHeight * (event.key === 'PageUp' ? .8 : -.8))
        this.layout()
      }
    }, {signal: this.scope.signal})
    window.addEventListener('keydown', event => {
      if (event.code !== 'Space' || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"]')) return
      this.space = true
      if (target === viewport || target === document.body) event.preventDefault()
      this.cursor()
    }, {signal: this.scope.signal})
    window.addEventListener('keyup', event => {
      if (event.code === 'Space') { this.space = false; this.cursor() }
    }, {signal: this.scope.signal})
    window.addEventListener('blur', () => { this.space = false; this.cancel() }, {signal: this.scope.signal})
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.space = false; this.cancel() } }, {signal: this.scope.signal})
    viewport.addEventListener('wheel', event => {
      event.preventDefault()
      if (this.pointers.size) return
      if (event.ctrlKey || event.metaKey) this.callbacks.zoom(Math.exp(-event.deltaY * .01), {x: event.clientX, y: event.clientY})
      else this.callbacks.pan(-(event.shiftKey ? event.deltaY : event.deltaX), -(event.shiftKey ? event.deltaX : event.deltaY))
    }, {signal: this.scope.signal, passive: false})
    this.layout()
  }

  render(annotations: RegionAnnotation[], selected: string | null, locked: boolean): void {
    this.annotations = new Map(annotations.map(annotation => [annotation.id, annotation]))
    this.selected = selected
    this.locked = locked
    for (const [id, node] of this.nodes) if (!this.annotations.has(id)) { node.destroy(); this.nodes.delete(id) }
    const style = getComputedStyle(this.viewport)
    // Larger regions are painted first, so a small overlapping region remains reachable.
    for (const annotation of [...annotations].sort((a, b) => b.selector.width * b.selector.height - a.selector.width * a.selector.height)) {
      let node = this.nodes.get(annotation.id)
      if (!node) {
        node = new Konva.Rect({id: annotation.id, strokeWidth: 2, strokeScaleEnabled: false, dragDistance: 1})
        node.on('dragstart', () => this.beginEdit())
        node.on('dragend', () => this.commit())
        node.on('dblclick dbltap', () => { if (!this.locked) this.callbacks.edit(annotation.id) })
        this.layer.add(node)
        this.nodes.set(annotation.id, node)
      }
      const color = style.getPropertyValue(`--kind-${annotation.kind}`).trim() || '#0866ce'
      const rgb = Konva.Util.getRGB(color)
      node.setAttrs({draggable: !locked || selected === annotation.id, stroke: color,
        fill: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${annotation.status === 'resolved' ? .04 : .12})`})
      if (this.original?.id !== annotation.id) node.setAttrs({...annotation.selector, scaleX: 1, scaleY: 1})
      node.moveToTop()
    }
    this.drawing.moveToTop()
    this.transformer.moveToTop()
    this.transformer.nodes(selected && this.nodes.has(selected) ? [this.nodes.get(selected)!] : [])
    this.cursor()
    this.layer.batchDraw()
  }

  layout(): void {
    const frame = this.viewport.getBoundingClientRect()
    const image = this.image.getBoundingClientRect()
    const scale = image.width / this.image.naturalWidth
    this.stage.size({width: Math.max(1, this.viewport.clientWidth), height: Math.max(1, this.viewport.clientHeight)})
    this.layer.position({x: image.left - frame.left, y: image.top - frame.top})
    this.layer.scale({x: scale, y: scale})
    this.layer.batchDraw()
  }

  private imagePoint(point: Point): Point {
    const box = this.image.getBoundingClientRect()
    return {x: (point.x - box.left) * this.image.naturalWidth / box.width, y: (point.y - box.top) * this.image.naturalHeight / box.height}
  }
  private inside(point: Point): boolean { return point.x >= 0 && point.y >= 0 && point.x <= this.image.naturalWidth && point.y <= this.image.naturalHeight }
  private pinch(): {center: Point; distance: number} {
    const [a, b] = [...this.pointers.values()]
    return {center: {x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2}, distance: Math.max(1, Math.hypot(a!.x - b!.x, a!.y - b!.y))}
  }
  private block(event: PointerEvent): void { event.preventDefault(); event.stopImmediatePropagation() }
  private capture(id: number): void { this.viewport.setPointerCapture(id) }

  private down(event: PointerEvent): void {
    if (event.target instanceof Element && !event.target.closest('.image-canvas')) return
    if (event.button !== 0 && event.button !== 1) return
    const point = {x: event.clientX, y: event.clientY}
    this.pointers.set(event.pointerId, point)
    this.viewport.focus({preventScroll: true})
    if (this.gesture.type === 'blocked') { this.block(event); return }
    if (this.pointers.size >= 2) {
      this.restoreEdit()
      this.drawing.hide()
      this.gesture = {type: 'pinch', ...this.pinch()}
      for (const id of this.pointers.keys()) this.capture(id)
      this.block(event); this.cursor(); return
    }
    if (this.space || event.button === 1) {
      this.gesture = {type: 'pan', id: event.pointerId, last: point}
      this.capture(event.pointerId); this.block(event); this.cursor(); return
    }
    if (this.gesture.type !== 'idle') { this.block(event); return }
    const box = this.viewport.getBoundingClientRect()
    // Hit testing must see the current camera even before Konva's next paint frame.
    this.layer.drawHit()
    const target = this.stage.getIntersection({x: point.x - box.left, y: point.y - box.top})
    if (target && this.transformer.isAncestorOf(target)) return
    const id = target?.id()
    if (id && this.annotations.has(id)) {
      if (this.locked && id !== this.selected) { this.block(event); return }
      this.callbacks.select(id)
      return
    }
    this.block(event)
    if (this.locked) return
    this.callbacks.select(null)
    const start = this.imagePoint(point)
    if (!this.inside(start)) return
    this.gesture = {type: 'draw', id: event.pointerId, start}
    this.drawing.setAttrs({x: start.x, y: start.y, width: 0, height: 0, visible: true})
    this.capture(event.pointerId)
  }

  private move(event: PointerEvent): void {
    const point = {x: event.clientX, y: event.clientY}
    if (this.pointers.has(event.pointerId)) this.pointers.set(event.pointerId, point)
    const gesture = this.gesture
    if (gesture.type === 'idle') {
      const box = this.viewport.getBoundingClientRect()
      const target = this.stage.getIntersection({x: point.x - box.left, y: point.y - box.top})
      this.viewport.style.cursor = this.space ? 'grab' : target && this.transformer.isAncestorOf(target) ? '' : target ? 'move' : 'crosshair'
      return
    }
    this.block(event)
    if (gesture.type === 'draw' && gesture.id === event.pointerId) {
      const current = this.imagePoint(point)
      const region = normalizeRegion(gesture.start.x, gesture.start.y, current.x - gesture.start.x, current.y - gesture.start.y, {width: this.image.naturalWidth, height: this.image.naturalHeight})
      if (region) this.drawing.setAttrs(region)
    } else if (gesture.type === 'pan' && gesture.id === event.pointerId) {
      this.callbacks.pan(point.x - gesture.last.x, point.y - gesture.last.y)
      gesture.last = point
      this.layout()
    } else if (gesture.type === 'pinch' && this.pointers.size >= 2) {
      const next = this.pinch()
      this.callbacks.zoom(next.distance / gesture.distance, gesture.center)
      this.callbacks.pan(next.center.x - gesture.center.x, next.center.y - gesture.center.y)
      this.gesture = {type: 'pinch', ...next}
      this.layout()
    }
  }

  private up(event: PointerEvent): void {
    this.pointers.delete(event.pointerId)
    const gesture = this.gesture
    if (gesture.type === 'idle') return
    this.block(event)
    this.gesture = gesture.type === 'pinch' && this.pointers.size >= 2 ? {type: 'pinch', ...this.pinch()} : this.pointers.size ? {type: 'blocked'} : {type: 'idle'}
    if (this.viewport.hasPointerCapture(event.pointerId)) this.viewport.releasePointerCapture(event.pointerId)
    if (gesture.type === 'draw' && gesture.id === event.pointerId) {
      this.drawing.hide()
      const end = this.imagePoint({x: event.clientX, y: event.clientY})
      const region = normalizeRegion(gesture.start.x, gesture.start.y, end.x - gesture.start.x, end.y - gesture.start.y, {width: this.image.naturalWidth, height: this.image.naturalHeight})
      if (region && Math.hypot(end.x - gesture.start.x, end.y - gesture.start.y) * this.layer.scaleX() >= 3) this.callbacks.create(region)
    }
    this.cursor()
    this.layer.batchDraw()
  }

  private beginEdit(): void { if (!this.restoring && this.selected) this.original = this.annotations.get(this.selected) ?? null }
  private commit(): void {
    if (!this.original || this.restoring) return
    const original = this.original
    this.original = null
    const node = this.nodes.get(original.id)
    if (!node) return
    const region: ImageRegion = {type: 'rectangle', x: Math.round(node.x()), y: Math.round(node.y()), width: Math.round(node.width() * node.scaleX()), height: Math.round(node.height() * node.scaleY())}
    const valid = validRegion(region, {width: this.image.naturalWidth, height: this.image.naturalHeight})
    if (!valid) this.callbacks.invalid()
    if (!valid || !this.callbacks.change(original, region)) node.setAttrs({...original.selector, scaleX: 1, scaleY: 1})
    else node.setAttrs({...region, scaleX: 1, scaleY: 1})
    this.transformer.forceUpdate()
  }
  private restoreEdit(): void {
    this.restoring = true
    this.transformer.stopTransform()
    for (const node of this.nodes.values()) node.stopDrag()
    if (this.original) this.nodes.get(this.original.id)?.setAttrs({...this.original.selector, scaleX: 1, scaleY: 1})
    this.original = null
    this.restoring = false
    this.transformer.forceUpdate()
  }
  private cancel(keepPointers = false): void {
    this.gesture = keepPointers && this.pointers.size ? {type: 'blocked'} : {type: 'idle'}
    if (!keepPointers) {
      const pointers = [...this.pointers.keys()]
      this.pointers.clear()
      for (const id of pointers) if (this.viewport.hasPointerCapture(id)) this.viewport.releasePointerCapture(id)
    }
    this.restoreEdit()
    this.drawing.hide()
    this.cursor()
    this.layer.batchDraw()
  }
  private cursor(): void { this.viewport.style.cursor = this.gesture.type === 'pan' || this.gesture.type === 'pinch' ? 'grabbing' : this.space ? 'grab' : 'crosshair' }
  cancelGesture(): void { this.cancel(true) }
  destroy(): void { this.cancel(); this.scope.abort(); this.stage.destroy() }
}
