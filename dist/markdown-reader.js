import { Marked } from './vendor/marked.mjs';
import { bindPinchZoom, clampPinchZoom } from './pinch-zoom.js';

const embeddedImage = /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z0-9+/=]+$/i;
const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const escapeText = text => text.replace(/[&<>]/g, character => entities[character]);
const parser = new Marked({
  gfm: true,
  renderer: {
    html({ text }) { return escapeText(text); },
    image({ href, text }) {
      // Linked images stay as alt text so opening a note makes no network requests.
      return embeddedImage.test(href) ? false : escapeText(text);
    }
  }
});

export class MarkdownReader {
  constructor({ article, viewport, onZoomChange }) {
    Object.assign(this, { article, viewport, onZoomChange });
    this.window = article.ownerDocument.defaultView;
    this.zoom = 1;
  }

  open(bytes) {
    const data = new Uint8Array(bytes);
    const encoding = data[0] === 255 && data[1] === 254 ? 'utf-16le'
      : data[0] === 254 && data[1] === 255 ? 'utf-16be' : 'utf-8';
    const source = new TextDecoder(encoding).decode(data);
    const fragment = this.window.DOMPurify.sanitize(parser.parse(source), {
      RETURN_DOM_FRAGMENT: true,
      ALLOWED_TAGS: [
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'blockquote', 'ul', 'ol', 'li',
        'pre', 'code', 'em', 'strong', 'del', 'a', 'img', 'br', 'hr', 'table',
        'thead', 'tbody', 'tr', 'td', 'th', 'input'
      ],
      ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'align', 'start', 'type', 'disabled', 'checked'],
      ALLOW_DATA_ATTR: false
    });
    if (!fragment.textContent.trim() && !fragment.querySelector('img, hr')) {
      const message = this.article.ownerDocument.createElement('p');
      message.textContent = 'Este archivo Markdown está vacío.';
      fragment.replaceChildren(message);
    }
    this.setUpLinks(fragment);
    this.article.classList.add('markdown-content');
    this.article.replaceChildren(fragment);
    this.article.hidden = false;
    this.viewport.classList.add('markdown-zoomable');
    this.setZoom(1);
    this.unbindPinch = bindPinchZoom(this.viewport, {
      onStart: center => this.startPinch(center),
      onMove: (factor, center) => this.movePinch(factor, center),
      onEnd: () => this.endPinch()
    });
  }

  setUpLinks(fragment) {
    const headings = new Map();
    for (const heading of fragment.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
      const slug = heading.textContent.trim().toLowerCase()
        .replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s+/g, '-') || 'seccion';
      let key = slug;
      for (let index = 1; headings.has(key); index++) key = `${slug}-${index}`;
      heading.id = `md-heading-${key}`;
      headings.set(key, heading);
    }
    for (const link of fragment.querySelectorAll('a[href]')) {
      const href = link.getAttribute('href');
      if (href.startsWith('#')) {
        let key = href.slice(1);
        try { key = decodeURIComponent(key); } catch {}
        const heading = headings.get(key);
        if (!heading) {
          link.removeAttribute('href');
          continue;
        }
        link.setAttribute('href', `#${heading.id}`);
        link.addEventListener('click', event => {
          event.preventDefault();
          heading.scrollIntoView({ block: 'start' });
        });
      } else if (/^(https?:\/\/|mailto:)/i.test(href)) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      } else link.removeAttribute('href');
    }
  }

  startPinch(center) {
    const hit = this.article.ownerDocument.elementFromPoint?.(center.x, center.y);
    const block = hit?.closest('h1, h2, h3, h4, h5, h6, p, pre, li, tr, blockquote, img');
    const element = block && this.article.contains(block) ? block : this.article;
    const bounds = element.getBoundingClientRect();
    this.pinch = {
      element, offset: (center.y - bounds.top) / Math.max(1, bounds.height),
      startZoom: this.zoom, zoom: this.zoom, center, frame: null
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

  endPinch() {
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
    if (!focus) this.clearPinch();
    const changed = this.zoom !== value;
    this.zoom = value;
    this.article.style.fontSize = `${16 * value}px`;
    if (focus) {
      const bounds = focus.element.getBoundingClientRect();
      this.viewport.scrollTop += bounds.top + focus.offset * bounds.height - focus.center.y;
    }
    if (changed) this.onZoomChange(value);
  }

  destroy() {
    this.clearPinch();
    this.unbindPinch?.();
    this.viewport.classList.remove('markdown-zoomable');
    this.article.classList.remove('markdown-content');
    this.article.replaceChildren();
  }
}
