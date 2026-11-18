import { bindPinchZoom, clampPinchZoom } from './pinch-zoom.js';

/** Continuous, lazy PDF pages. Only pages near the viewport keep their canvases. */
export class ContinuousPdfReader {
  constructor({ pdfjs, container, viewport, onPositionChange = () => {}, onZoomChange = () => {}, onError = () => {} }) {
    Object.assign(this, { pdfjs, container, viewport, onPositionChange, onZoomChange, onError });
    this.window = viewport.ownerDocument.defaultView;
    this.pages = [];
    this.active = new Set();
    this.queue = [];
    this.generation = 0;
    this.zoom = 1;
    this.ready = false;
    this.destroyed = false;
    this.handleScroll = () => {
      if (!this.ready || this.frame) return;
      this.frame = this.window.requestAnimationFrame(() => {
        this.frame = null;
        this.updateVisible();
      });
    };
    viewport.addEventListener('scroll', this.handleScroll, { passive: true });
    this.unbindPinch = bindPinchZoom(viewport, {
      onStart: center => this.startPinch(center),
      onMove: (factor, center) => this.movePinch(factor, center),
      onEnd: () => this.finishPinch()
    });
    viewport.classList.add('pdf-zoomable');
  }

  async open(pdf, { page = 1, offset = 0 } = {}) {
    this.pdf = pdf;
    const first = await pdf.getPage(1);
    if (this.destroyed) return;
    const natural = first.getViewport({ scale: 1 });
    const doc = this.container.ownerDocument;
    const fragment = doc.createDocumentFragment();
    for (let n = 1; n <= pdf.numPages; n++) {
      const element = doc.createElement('section');
      element.className = 'pdf-page';
      element.dataset.page = n;
      element.setAttribute('aria-label', `Página ${n} de ${pdf.numPages}`);
      const placeholder = doc.createElement('span');
      placeholder.className = 'pdf-placeholder';
      placeholder.textContent = `Página ${n}`;
      placeholder.setAttribute('aria-hidden', 'true');
      element.append(placeholder);
      fragment.append(element);
      this.pages.push({ number: n, element, placeholder, natural, pdfPage: n === 1 ? first : null });
    }
    this.container.replaceChildren(fragment);
    this.layout();
    const target = Math.max(1, Math.min(pdf.numPages, Number(page) || 1));
    this.restorePosition({ page: target, offset: Math.max(0, Math.min(1, Number(offset) || 0)) });
    await this.start(this.pages[target - 1]);
    if (this.destroyed) return;
    this.ready = true;
    this.updateVisible();
  }

  availableWidth() {
    const style = this.window.getComputedStyle(this.viewport);
    const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    return Math.max(100, this.viewport.clientWidth - padding);
  }

  scaleFor(state, availableWidth = this.availableWidth()) {
    return Math.min(availableWidth / state.natural.width, 1.35) * this.zoom;
  }

  layout(anchor) {
    const availableWidth = this.availableWidth();
    let width = availableWidth;
    for (const state of this.pages) {
      const scale = this.scaleFor(state, availableWidth);
      state.height = state.natural.height * scale;
      state.width = state.natural.width * scale;
      state.element.style.width = `${state.width}px`;
      state.element.style.height = `${state.height}px`;
      state.element.style.setProperty('--scale-factor', scale);
      width = Math.max(width, state.width);
    }
    this.container.style.width = `${Math.ceil(width)}px`;
    if (anchor) this.restorePosition(anchor);
  }

  topOf(state) { return this.container.offsetTop + state.element.offsetTop; }

  pageAt(y) {
    let low = 0, high = this.pages.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (this.topOf(this.pages[middle]) <= y) low = middle;
      else high = middle - 1;
    }
    return this.pages[low];
  }

  getPosition() {
    if (!this.pages.length) return { page: 1, offset: 0 };
    const state = this.pageAt(this.viewport.scrollTop + 1);
    return { page: state.number, offset: Math.max(0, Math.min(1, (this.viewport.scrollTop - this.topOf(state)) / state.height)) };
  }

  restorePosition({ page, offset = 0 }) {
    const state = this.pages[page - 1];
    if (state) this.viewport.scrollTop = this.topOf(state) + offset * state.height;
  }

  leftOf(state) { return this.container.offsetLeft + state.element.offsetLeft; }

  pointInViewport({ x, y }) {
    const rect = this.viewport.getBoundingClientRect();
    return { x: x - rect.left - this.viewport.clientLeft, y: y - rect.top - this.viewport.clientTop };
  }

  zoomAnchor(center) {
    const point = this.pointInViewport(center);
    const documentX = point.x + this.viewport.scrollLeft;
    const documentY = point.y + this.viewport.scrollTop;
    const state = this.pageAt(documentY);
    return {
      state,
      x: (documentX - this.leftOf(state)) / state.width,
      y: (documentY - this.topOf(state)) / state.height
    };
  }

  startPinch(start) {
    if (!this.ready) return false;
    const rect = this.container.getBoundingClientRect();
    this.container.style.transformOrigin = `${start.x - rect.left}px ${start.y - rect.top}px`;
    this.pinch = {
      start,
      anchor: this.zoomAnchor(start),
      scrollLeft: this.viewport.scrollLeft,
      scrollTop: this.viewport.scrollTop,
      center: start,
      zoom: this.zoom
    };
    return true;
  }

  movePinch(factor, center) {
    const pinch = this.pinch;
    if (!pinch) return;
    pinch.center = center;
    pinch.zoom = clampPinchZoom(this.zoom * factor);
    if (pinch.frame) return;
    pinch.frame = this.window.requestAnimationFrame(() => {
      pinch.frame = null;
      const dx = pinch.center.x - pinch.start.x + this.viewport.scrollLeft - pinch.scrollLeft;
      const dy = pinch.center.y - pinch.start.y + this.viewport.scrollTop - pinch.scrollTop;
      this.container.style.transform = `translate(${dx}px, ${dy}px) scale(${pinch.zoom / this.zoom})`;
    });
  }

  finishPinch() {
    const pinch = this.pinch;
    if (!pinch) return;
    this.clearPinch();
    if (pinch.zoom !== this.zoom || pinch.center !== pinch.start || pinch.needsResize) {
      this.setZoom(pinch.zoom, pinch);
    }
  }

  clearPinch() {
    if (!this.pinch) return;
    if (this.pinch.frame) this.window.cancelAnimationFrame(this.pinch.frame);
    this.pinch = null;
    this.container.style.transform = '';
    this.container.style.transformOrigin = '';
  }

  updateVisible() {
    if (!this.ready || this.destroyed || !this.pages.length) return;
    const height = this.viewport.clientHeight || 700;
    const start = this.pageAt(Math.max(0, this.viewport.scrollTop - height)).number - 1;
    const end = this.pageAt(this.viewport.scrollTop + height * 2).number - 1;
    const position = this.getPosition();
    this.onPositionChange(position, this.pages.length);
    this.queue = [];
    for (let i = start; i <= end; i++) {
      const state = this.pages[i];
      if (state.rendered !== this.generation && state.failed !== this.generation && !state.work) this.queue.push(state);
    }
    this.queue.sort((a, b) => Math.abs(a.number - position.page) - Math.abs(b.number - position.page));
    for (let i = 0; i < this.pages.length; i++) {
      if ((i < start - 1 || i > end + 1) && (this.pages[i].canvas || this.pages[i].task || this.pages[i].textElement)) this.release(this.pages[i]);
    }
    this.pump();
  }

  pump() {
    if (!this.ready || this.destroyed) return;
    while (this.active.size < 2 && this.queue.length) {
      const state = this.queue.shift();
      if (!state.work && state.rendered !== this.generation && state.failed !== this.generation) this.start(state);
    }
  }

  start(state) {
    const generation = this.generation;
    state.placeholder.textContent = `Página ${state.number}`;
    const work = this.render(state, generation).catch(error => {
      if (this.destroyed || generation !== this.generation || error.name === 'RenderingCancelledException' || error.name === 'AbortException') return;
      this.release(state);
      state.failed = generation;
      state.placeholder.hidden = false;
      state.placeholder.textContent = `No se pudo mostrar la página ${state.number}.`;
      this.onError(error, state.number);
    }).finally(() => {
      if (state.work === work) state.work = null;
      this.active.delete(work);
      if (this.ready && !this.destroyed) this.updateVisible();
    });
    state.work = work;
    this.active.add(work);
    return work;
  }

  valid(generation) { return !this.destroyed && generation === this.generation; }

  async render(state, generation) {
    const pdfPage = state.pdfPage || await this.pdf.getPage(state.number);
    if (!this.valid(generation)) return;
    state.pdfPage = pdfPage;
    const natural = pdfPage.getViewport({ scale: 1 });
    if (natural.width !== state.natural.width || natural.height !== state.natural.height) {
      const anchor = this.getPosition();
      state.natural = natural;
      this.layout(anchor);
    }
    const viewport = pdfPage.getViewport({ scale: this.scaleFor(state) });
    const ratio = Math.min(this.window.devicePixelRatio || 1, 2, Math.sqrt(4000000 / (viewport.width * viewport.height)));
    const canvas = this.container.ownerDocument.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
    canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    state.canvas = canvas;
    state.element.append(canvas);
    const task = pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null });
    state.task = task;
    try { await task.promise; }
    finally { if (state.task === task) state.task = null; }
    if (!this.valid(generation) || state.canvas !== canvas) return;
    state.placeholder.hidden = true;
    state.rendered = generation;
    // Text extraction must not hide an otherwise readable page if its text is malformed.
    try {
      const text = await pdfPage.getTextContent();
      if (!this.valid(generation) || state.canvas !== canvas) return;
      const layer = this.container.ownerDocument.createElement('div');
      layer.className = 'textLayer';
      state.textElement = layer;
      state.element.append(layer);
      const textTask = new this.pdfjs.TextLayer({ textContentSource: text, container: layer, viewport });
      state.textTask = textTask;
      await textTask.render();
      if (state.textTask === textTask) state.textTask = null;
    } catch (error) {
      if (this.valid(generation) && state.canvas === canvas) state.textElement?.remove();
    }
  }

  release(state) {
    state.task?.cancel();
    state.textTask?.cancel();
    state.textTask = null;
    state.textElement?.remove();
    state.textElement = null;
    if (state.canvas) {
      state.canvas.remove();
      state.canvas.width = state.canvas.height = 0;
      state.canvas = null;
    }
    state.rendered = null;
    state.placeholder.hidden = false;
  }

  setZoom(value, focus) {
    if (this.destroyed) return;
    this.clearPinch();
    const changed = value !== this.zoom;
    const position = focus ? null : this.getPosition();
    if (changed || !focus || focus.needsResize) {
      this.generation++;
      this.queue = [];
      for (const state of this.pages) this.release(state);
    }
    this.zoom = value;
    this.layout(position);
    if (focus) {
      const point = this.pointInViewport(focus.center);
      const { state, x, y } = focus.anchor;
      this.viewport.scrollLeft = this.leftOf(state) + x * state.width - point.x;
      this.viewport.scrollTop = this.topOf(state) + y * state.height - point.y;
    }
    if (changed) this.onZoomChange(value);
    this.updateVisible();
  }

  resize() {
    // Android can report its new viewport size shortly after entering fullscreen.
    if (this.pinch) this.pinch.needsResize = true;
    else this.setZoom(this.zoom);
  }

  destroy() {
    this.ready = false;
    this.destroyed = true;
    this.generation++;
    this.queue = [];
    this.viewport.removeEventListener('scroll', this.handleScroll);
    this.unbindPinch();
    this.viewport.classList.remove('pdf-zoomable');
    this.clearPinch();
    if (this.frame) this.window.cancelAnimationFrame(this.frame);
    for (const state of this.pages) this.release(state);
    this.container.replaceChildren();
  }
}
