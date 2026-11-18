import { bindPinchZoom, clampPinchZoom } from './pinch-zoom.js';

const maxScrollSize = 24_000_000;
let legacyCodepages;

export class SpreadsheetReader {
  constructor({ view, viewport, onZoomChange }) {
    Object.assign(this, { view, viewport, onZoomChange });
    this.document = view.ownerDocument;
    this.window = this.document.defaultView;
    this.scroller = view.querySelector('.sheet-scroll');
    this.table = view.querySelector('.sheet-table');
    this.heading = view.querySelector('.sheet-heading');
    this.rows = view.querySelector('.sheet-rows');
    this.select = view.querySelector('select');
    this.preview = view.querySelector('.sheet-value');
    this.zoom = 1;

    this.onScroll = () => this.scheduleDraw();
    this.onSheet = () => this.showSheet(this.select.value);
    this.onCell = event => {
      const button = event.target.closest('[data-cell]');
      if (!button) return;
      this.preview.querySelector('strong').textContent = button.dataset.cell;
      this.preview.querySelector('span').textContent = button.textContent;
      this.preview.hidden = false;
      this.scheduleDraw();
    };
    this.onDismiss = () => {
      this.preview.hidden = true;
      this.scroller.focus();
      this.scheduleDraw();
    };
    this.scroller.addEventListener('scroll', this.onScroll, { passive: true });
    this.table.addEventListener('click', this.onCell);
    this.select.addEventListener('change', this.onSheet);
    this.preview.querySelector('button').addEventListener('click', this.onDismiss);
    this.unbindPinch = bindPinchZoom(this.scroller, {
      onStart: center => this.startPinch(center),
      onMove: (factor, center) => this.movePinch(factor, center),
      onEnd: () => this.finishPinch()
    });
  }

  async open(bytes, extension) {
    this.engine = await import('./vendor/xlsx.mjs');
    if (extension === 'xls') {
      legacyCodepages ||= import('./vendor/xlsx-codepages.mjs');
      this.engine.set_cptable(await legacyCodepages);
    }
    if (this.destroyed) return 0;
    this.book = this.engine.read(bytes, { type: 'array', cellHTML: false, cellText: true });
    const visible = this.book.SheetNames.filter(name =>
      !this.book.Workbook?.Sheets?.find(sheet => sheet.name === name)?.Hidden
    );
    const names = visible.length ? visible : this.book.SheetNames;
    if (!names.length) throw new Error('Empty Excel workbook');
    this.select.replaceChildren(...names.map(name => {
      const option = this.element('option');
      option.value = option.textContent = name;
      return option;
    }));
    this.view.hidden = false;
    this.viewport.classList.add('spreadsheet-mode');
    this.showSheet(names[0]);
    return names.length;
  }

  showSheet(name) {
    this.clearPinch();
    this.preview.hidden = true;
    this.sheet = this.book.Sheets[name];
    const range = this.sheet?.['!ref'] && this.engine.utils.decode_range(this.sheet['!ref']);
    this.view.querySelector('.sheet-empty').hidden = Boolean(range);
    this.scroller.hidden = !range;
    this.rowCount = range ? Math.min(1_048_576, range.e.r + 1) : 0;
    this.columnCount = range ? Math.min(16_384, range.e.c + 1) : 0;
    this.scroller.scrollTop = this.scroller.scrollLeft = 0;
    this.resize();
    if (!range) return;
    this.scroller.scrollTop = scrollFor(range.s.r * this.rowSize, this.vertical, this.scroller.clientHeight);
    this.scroller.scrollLeft = scrollFor(range.s.c * this.columnSize, this.horizontal, this.scroller.clientWidth);
    this.draw();
  }

  resize() {
    if (!this.sheet || !this.rowCount || !this.columnCount) return;
    this.rowSize = Math.round(34 * this.zoom);
    this.columnSize = Math.round(152 * this.zoom);
    this.rowLabelSize = Math.round(44 * this.zoom);
    this.vertical = axis(this.rowCount * this.rowSize + this.rowSize);
    this.horizontal = axis(this.columnCount * this.columnSize + this.rowLabelSize);
    Object.assign(this.table.style, {
      width: `${this.horizontal.physical}px`,
      height: `${this.vertical.physical}px`,
      fontSize: `${14 * this.zoom}px`
    });
    this.table.style.setProperty('--sheet-row', `${this.rowSize}px`);
    this.table.style.setProperty('--sheet-label', `${this.rowLabelSize}px`);
    this.table.setAttribute('aria-rowcount', this.rowCount + 1);
    this.table.setAttribute('aria-colcount', this.columnCount + 1);
    this.renderedRange = null;
    this.draw();
  }

  scheduleDraw() {
    if (this.drawFrame != null) return;
    this.drawFrame = this.window.requestAnimationFrame(() => {
      this.drawFrame = null;
      this.draw();
    });
  }

  draw() {
    if (!this.horizontal || this.scroller.hidden) return;
    const { scrollTop, scrollLeft, clientWidth, clientHeight } = this.scroller;
    const y = logicalScroll(scrollTop, this.vertical, clientHeight);
    const x = logicalScroll(scrollLeft, this.horizontal, clientWidth);
    const firstRow = Math.max(0, Math.floor(y / this.rowSize) - 2);
    const lastRow = Math.min(this.rowCount, Math.ceil((y + (clientHeight || 640)) / this.rowSize) + 2);
    const firstColumn = Math.max(0, Math.floor(x / this.columnSize) - 1);
    const lastColumn = Math.min(this.columnCount, Math.ceil((x + (clientWidth || 360)) / this.columnSize) + 1);
    this.table.style.setProperty('--sheet-shift-x', `${scrollLeft - x}px`);
    this.table.style.setProperty('--sheet-shift-y', `${scrollTop - y}px`);

    const range = `${firstRow}:${lastRow}:${firstColumn}:${lastColumn}`;
    if (range === this.renderedRange) return;
    this.renderedRange = range;
    const columns = [];
    const headers = this.document.createDocumentFragment();
    const corner = this.element('span', 'sheet-corner');
    corner.setAttribute('aria-hidden', 'true');
    headers.append(corner);
    for (let column = firstColumn; column < lastColumn; column++) {
      const name = this.engine.utils.encode_col(column);
      const header = this.element('span', 'sheet-column');
      header.setAttribute('role', 'columnheader');
      header.setAttribute('aria-colindex', column + 2);
      header.textContent = name;
      this.positionColumn(header, column);
      columns.push({ column, name });
      headers.append(header);
    }

    const rows = this.document.createDocumentFragment();
    for (let rowNumber = firstRow; rowNumber < lastRow; rowNumber++) {
      const row = this.element('div', 'sheet-row');
      row.setAttribute('role', 'row');
      row.setAttribute('aria-rowindex', rowNumber + 2);
      row.style.top = `calc(${this.rowSize * (rowNumber + 1)}px + var(--sheet-shift-y))`;
      const number = this.element('span', 'sheet-row-number');
      number.setAttribute('role', 'rowheader');
      number.setAttribute('aria-colindex', 1);
      number.textContent = rowNumber + 1;
      row.append(number);
      for (const { column, name } of columns) {
        const address = name + (rowNumber + 1);
        const data = this.sheet[address];
        const cell = this.element('div', 'sheet-cell');
        cell.setAttribute('role', 'cell');
        cell.setAttribute('aria-colindex', column + 2);
        this.positionColumn(cell, column);
        const value = data?.w ?? data?.v ?? (data?.f ? '=' + data.f : '');
        if (value !== '') {
          const button = this.element('button');
          button.type = 'button';
          button.dataset.cell = address;
          button.textContent = String(value);
          button.title = String(value);
          if (data?.t === 'n') button.classList.add('sheet-number');
          cell.append(button);
        }
        row.append(cell);
      }
      rows.append(row);
    }
    this.heading.replaceChildren(headers);
    this.rows.replaceChildren(rows);
  }

  positionColumn(element, column) {
    element.style.left = `calc(${this.rowLabelSize + this.columnSize * column}px + var(--sheet-shift-x))`;
    element.style.width = `${this.columnSize}px`;
  }

  element(tag, className) {
    const element = this.document.createElement(tag);
    if (className) element.className = className;
    return element;
  }

  startPinch(center) {
    if (!this.rowCount || !this.columnCount) return false;
    const point = this.anchor(center);
    this.pinch = { ...point, startZoom: this.zoom, zoom: this.zoom, frame: null };
    return true;
  }

  movePinch(factor, center) {
    const pinch = this.pinch;
    if (!pinch) return;
    pinch.zoom = clampPinchZoom(pinch.startZoom * factor);
    pinch.center = center;
    if (pinch.frame != null) return;
    pinch.frame = this.window.requestAnimationFrame(() => {
      pinch.frame = null;
      this.setZoom(pinch.zoom, pinch);
    });
  }

  finishPinch() {
    const pinch = this.pinch;
    this.clearPinch();
    if (pinch?.frame != null) this.setZoom(pinch.zoom, pinch);
  }

  clearPinch() {
    if (this.pinch?.frame != null) this.window.cancelAnimationFrame(this.pinch.frame);
    this.pinch = null;
  }

  anchor(center) {
    const { left, top } = this.scroller.getBoundingClientRect();
    const { scrollLeft, scrollTop, clientWidth, clientHeight } = this.scroller;
    return {
      center,
      column: (logicalScroll(scrollLeft, this.horizontal, clientWidth) + center.x - left - this.rowLabelSize) / this.columnSize,
      row: (logicalScroll(scrollTop, this.vertical, clientHeight) + center.y - top - this.rowSize) / this.rowSize
    };
  }

  setZoom(value, focus) {
    if (!focus) this.clearPinch();
    if (this.destroyed) return;
    const changed = value !== this.zoom;
    if (this.scroller.hidden) {
      this.zoom = value;
      if (changed) this.onZoomChange(value);
      return;
    }
    const { left, top } = this.scroller.getBoundingClientRect();
    const anchor = focus || this.anchor({ x: left + this.rowLabelSize, y: top + this.rowSize });
    this.zoom = value;
    if (changed) this.resize();
    this.scroller.scrollLeft = scrollFor(this.rowLabelSize + anchor.column * this.columnSize + left - anchor.center.x, this.horizontal, this.scroller.clientWidth);
    this.scroller.scrollTop = scrollFor(this.rowSize + anchor.row * this.rowSize + top - anchor.center.y, this.vertical, this.scroller.clientHeight);
    this.draw();
    if (changed) this.onZoomChange(value);
  }

  destroy() {
    this.destroyed = true;
    this.clearPinch();
    this.unbindPinch();
    if (this.drawFrame != null) this.window.cancelAnimationFrame(this.drawFrame);
    this.scroller.removeEventListener('scroll', this.onScroll);
    this.table.removeEventListener('click', this.onCell);
    this.select.removeEventListener('change', this.onSheet);
    this.preview.querySelector('button').removeEventListener('click', this.onDismiss);
    this.viewport.classList.remove('spreadsheet-mode');
    this.view.hidden = true;
    this.heading.replaceChildren();
    this.rows.replaceChildren();
    this.select.replaceChildren();
    this.book = this.sheet = null;
  }
}

// Large Excel sheets can exceed the browser's maximum element dimension.
function axis(size) {
  return { size, physical: Math.min(size, maxScrollSize) };
}

function logicalScroll(position, axis, visible) {
  const overflow = axis.physical - visible;
  return overflow > 0 ? position * (axis.size - visible) / overflow : 0;
}

function scrollFor(position, axis, visible) {
  const overflow = axis.size - visible;
  if (overflow <= 0) return 0;
  return Math.max(0, Math.min(overflow, position)) * (axis.physical - visible) / overflow;
}
