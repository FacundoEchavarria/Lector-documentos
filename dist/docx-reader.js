import { bindPinchZoom, clampPinchZoom } from './pinch-zoom.js';

const pageSelector = 'section.hoja-docx';
// These faces match the spacing of common Word fonts when they are absent on Android.
const substituteFonts = [['Calibri', 'carlito'], ['Cambria', 'caladea']].flatMap(([family, file]) =>
  [['normal', 400, ''], ['normal', 700, ' Bold'], ['italic', 400, ' Italic'], ['italic', 700, ' Bold Italic']]
    .map(([style, weight, suffix]) => {
      const url = new URL(`./type/${file}-${style}-${weight}.woff2`, import.meta.url);
      return `@font-face {
        font-family: "${family}";
        font-style: ${style};
        font-weight: ${weight};
        src: local("${family}${suffix}"), url("${url.href}") format("woff2");
      }`;
    })
).join('\n');
const frameHtml = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'self' data:; base-uri 'none'; form-action 'none'">
<style>
${substituteFonts}
html, body {
  margin: 0;
  overflow: hidden;
  touch-action: pan-x pan-y;
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}
body > .hoja-docx-wrapper {
  background: transparent;
  padding: 1px;
  gap: 20px;
  font-family: Calibri, Arial, sans-serif;
  color-scheme: light;
}
body > .hoja-docx-wrapper > section.hoja-docx {
  flex: none;
  width: 612pt;
  min-height: 792pt;
  margin: 0;
  outline: 1px solid #bfb6aa;
  box-shadow: none;
}
</style></head><body></body></html>`;

export class DocxReader {
  constructor({ container, viewport, onZoomChange = () => {} }) {
    this.container = container;
    this.viewport = viewport;
    this.onZoomChange = onZoomChange;
    this.window = container.ownerDocument.defaultView;
    this.zoom = 1;
    this.scale = 1;
    viewport.classList.add('docx-zoomable');
  }

  async open(bytes) {
    const host = this.container.ownerDocument;
    const content = host.createElement('div');
    const styles = host.createElement('div');
    await host.defaultView.docx.renderAsync(new host.defaultView.Uint8Array(bytes), content, styles, {
      className: 'hoja-docx',
      ignoreLastRenderedPageBreak: false,
      renderAltChunks: false,
      useBase64URL: true
    });
    if (this.destroyed) return 0;

    // Keep document styles and content inside a frame that cannot execute scripts.
    const sanitized = host.defaultView.DOMPurify.sanitize(content.firstElementChild, {
      RETURN_DOM_FRAGMENT: true,
      FORBID_TAGS: ['style', 'iframe', 'form', 'object', 'embed', 'input', 'button', 'foreignobject'],
      FORBID_ATTR: ['contenteditable', 'srcset']
    });
    for (const link of sanitized.querySelectorAll('a[href]')) {
      if (!/^(#|https?:\/\/)/i.test(link.getAttribute('href'))) link.removeAttribute('href');
    }
    this.frame = host.createElement('iframe');
    this.frame.title = 'Páginas del documento Word';
    this.frame.setAttribute('sandbox', 'allow-same-origin');
    this.container.append(this.frame);
    const doc = this.frame.contentDocument;
    doc.open();
    doc.write(frameHtml);
    doc.close();
    doc.head.append(...styles.querySelectorAll('style'));
    doc.body.append(sanitized);

    const wrapper = doc.body.querySelector('.hoja-docx-wrapper');
    if (!wrapper || !wrapper.querySelector(pageSelector)) throw new Error('Empty Word document');
    const pages = Array.from(wrapper.children);
    this.width = Math.ceil(Math.max(1, ...pages.map(page => page.offsetWidth || 816))) + 2;
    this.frame.style.height = '1px';
    this.frame.style.width = `${this.width}px`;

    // Resolve embedded fonts and image sizes before measuring the page breaks.
    const resources = Array.from(doc.images, image => image.decode?.().catch(() => {}));
    if (doc.fonts) resources.push(doc.fonts.ready);
    await Promise.all(resources);
    if (this.destroyed) return 0;
    for (const page of pages) paginateDocxPage(page);
    for (const [number, page] of Array.from(wrapper.children).entries()) {
      page.setAttribute('aria-label', `Página ${number + 1}`);
    }
    this.height = Math.ceil(wrapper.getBoundingClientRect().height);
    this.frame.style.height = `${this.height}px`;
    this.resize();
    const gesture = {
      onStart: center => this.startPinch(center),
      onMove: (factor, center) => this.movePinch(factor, center),
      onEnd: () => this.finishPinch()
    };
    this.unbindPinch = [
      bindPinchZoom(this.viewport, gesture),
      bindPinchZoom(doc.documentElement, {
        ...gesture,
        // The frame reports touches in its own unscaled coordinates.
        project: touch => {
          const { left, top } = this.frame.getBoundingClientRect();
          return { x: left + touch.clientX * this.scale, y: top + touch.clientY * this.scale };
        }
      })
    ];
    doc.addEventListener('click', event => {
      const href = event.target.closest?.('a[href]')?.getAttribute('href');
      if (!href) return;
      event.preventDefault();
      if (href.startsWith('#')) {
        const target = doc.getElementById(href.slice(1));
        if (target) this.viewport.scrollTop = this.container.offsetTop + target.getBoundingClientRect().top * this.scale;
      } else host.defaultView.open(href, '_blank', 'noopener,noreferrer');
    });
    doc.addEventListener('keydown', event => {
      if (event.defaultPrevented) return;
      const keyEvent = new host.defaultView.KeyboardEvent('keydown', { key: event.key, bubbles: true, cancelable: true });
      if (!this.viewport.dispatchEvent(keyEvent)) event.preventDefault();
    });
    return wrapper.children.length;
  }

  startPinch(center) {
    if (!this.height || this.pinch) return false;
    const rect = this.frame.getBoundingClientRect();
    this.pinch = {
      x: (center.x - rect.left) / this.scale,
      y: (center.y - rect.top) / this.scale,
      center,
      startZoom: this.zoom,
      zoom: this.zoom,
      frame: null
    };
    return true;
  }

  movePinch(factor, center) {
    const pinch = this.pinch;
    if (!pinch) return;
    pinch.zoom = clampPinchZoom(pinch.startZoom * factor);
    pinch.center = center;
    if (pinch.frame !== null) return;
    pinch.frame = this.window.requestAnimationFrame(() => {
      pinch.frame = null;
      this.setZoom(pinch.zoom, pinch);
    });
  }

  finishPinch() {
    const pinch = this.pinch;
    if (!pinch) return;
    this.clearPinch();
    if (pinch.frame !== null) this.setZoom(pinch.zoom, pinch);
  }

  clearPinch() {
    if (this.pinch?.frame != null) this.window.cancelAnimationFrame(this.pinch.frame);
    this.pinch = null;
  }

  setZoom(value, focus) {
    if (this.destroyed) return;
    if (!focus) this.clearPinch();
    const changed = this.zoom !== value;
    this.zoom = value;
    this.resize(focus);
    if (changed) this.onZoomChange(value);
  }

  resize(focus) {
    if (this.destroyed || !this.height) return;
    const style = this.window.getComputedStyle(this.viewport);
    const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const availableWidth = Math.max(1, this.viewport.clientWidth - padding);
    const scale = Math.min(1, availableWidth / this.width) * this.zoom;
    const top = this.viewport.scrollTop * scale / this.scale;
    const left = this.viewport.scrollLeft * scale / this.scale;
    this.frame.style.transform = `scale(${scale})`;
    this.container.style.width = `${Math.ceil(this.width * scale)}px`;
    this.container.style.height = `${Math.ceil(this.height * scale)}px`;
    if (focus) {
      const rect = this.frame.getBoundingClientRect();
      this.viewport.scrollLeft += rect.left + focus.x * scale - focus.center.x;
      this.viewport.scrollTop += rect.top + focus.y * scale - focus.center.y;
    } else {
      this.viewport.scrollTop = top;
      this.viewport.scrollLeft = left;
    }
    this.scale = scale;
  }

  destroy() {
    this.destroyed = true;
    this.clearPinch();
    this.unbindPinch?.forEach(unbind => unbind());
    this.viewport.classList.remove('docx-zoomable');
    this.frame?.remove();
    this.container.removeAttribute('style');
  }
}

export function paginateDocxPage(original) {
  const win = original.ownerDocument.defaultView;
  const height = parseFloat(win.getComputedStyle(original).minHeight);
  if (!height || original.getBoundingClientRect().height <= height + 1) return;

  const articles = Array.from(original.children).filter(element => element.tagName === 'ARTICLE');
  const contents = articles.map(article => Array.from(article.childNodes));
  for (const article of articles) article.replaceChildren();
  const template = original.cloneNode(true);
  for (const child of Array.from(template.children)) {
    if (!['HEADER', 'ARTICLE', 'FOOTER'].includes(child.tagName)) child.remove();
  }
  for (const element of template.querySelectorAll('[id]')) element.removeAttribute('id');

  let page = original;
  let hasContent = false;
  const continuations = [];
  const fits = () => page.getBoundingClientRect().height <= height + 1;
  function nextPage() {
    const next = template.cloneNode(true);
    page.after(next);
    continuations.push(next);
    page = next;
    hasContent = false;
  }

  for (const [index, blocks] of contents.entries()) {
    const article = () => page.querySelectorAll(':scope > article')[index];
    for (let block of blocks) {
      article().append(block);
      while (!fits()) {
        const rest = splitBlock(block, fits);
        if (!rest && !hasContent) break;
        if (!rest) block.remove();
        nextPage();
        block = rest || block;
        article().append(block);
      }
      hasContent = true;
    }
  }

  // Empty continuation articles can produce additional columns or flex spacing.
  for (const pagePart of continuations) {
    for (const article of pagePart.querySelectorAll(':scope > article:empty')) article.remove();
  }
}

function splitBlock(block, fits) {
  if (block.tagName === 'TABLE') return splitTable(block, fits);
  if (block.tagName === 'P') return splitParagraph(block, fits);
  return null;
}

function splitTable(table, fits) {
  // docx-preview emits one TR per Word row. Split only after intact vertical merges.
  const rows = Array.from(table.rows);
  if (rows.length < 2) return null;
  const rowParent = rows[0].parentNode;
  if (rows.some(row => row.parentNode !== rowParent)) return null;
  for (const row of rows) row.remove();
  let split = 0;
  let endOfMerge = 0;
  for (const [index, row] of rows.entries()) {
    rowParent.append(row);
    for (const cell of row.cells) {
      endOfMerge = Math.max(endOfMerge, cell.rowSpan ? index + cell.rowSpan : rows.length);
    }
    if (index + 1 < endOfMerge) continue;
    if (!fits()) break;
    split = index + 1;
  }
  if (!split || split === rows.length) {
    rowParent.append(...rows);
    return null;
  }
  const rest = table.cloneNode(false);
  for (const columns of table.querySelectorAll(':scope > colgroup')) rest.append(columns.cloneNode(true));
  if (rowParent === table) rest.append(...rows.slice(split));
  else {
    const body = rowParent.cloneNode(false);
    body.append(...rows.slice(split));
    rest.append(body);
  }
  rest.removeAttribute('id');
  return rest;
}

function splitParagraph(block, fits) {
  const doc = block.ownerDocument;
  const content = doc.createDocumentFragment();
  content.append(...block.childNodes);
  const text = content.textContent;
  const range = doc.createRange();
  const walker = doc.createTreeWalker(content, doc.defaultView.NodeFilter.SHOW_TEXT);
  const nodes = [];
  let end = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    nodes.push({ node, start: end });
    end += node.length;
  }
  const wordBreaks = Array.from(text.matchAll(/\s+\S/gu), match => match.index + match[0].length - 1);
  const breaks = [...new Set([...wordBreaks, ...nodes.slice(1).map(item => item.start)])]
    .filter(offset => offset > 0 && offset < text.length).sort((a, b) => a - b);
  function slice(offset, head) {
    const { node, start } = nodes.findLast(item => item.start < offset);
    range.selectNodeContents(content);
    if (head) range.setEnd(node, offset - start);
    else range.setStart(node, offset - start);
    return range.cloneContents();
  }
  let low = 0;
  let high = breaks.length - 1;
  let split = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    block.replaceChildren(slice(breaks[middle], true));
    if (fits()) {
      split = breaks[middle];
      low = middle + 1;
    } else high = middle - 1;
  }
  if (!split) {
    block.replaceChildren(content);
    return null;
  }
  block.replaceChildren(slice(split, true));
  const rest = block.cloneNode(false);
  rest.removeAttribute('id');
  rest.append(slice(split, false));
  for (const element of rest.querySelectorAll('[id]')) element.removeAttribute('id');
  return rest;
}
