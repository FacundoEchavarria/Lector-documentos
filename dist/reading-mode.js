/** Reading fullscreen, with Android system-bar control and a browser fallback. */
export function createReadingMode({ reader, button, exitButton, onLayoutChange = () => {}, onError = () => {} }) {
  const doc = reader.ownerDocument;
  const win = doc.defaultView;
  let active = false;
  let destroyed = false;
  const native = () => typeof win.HojaAndroid?.setReadingFullscreen === 'function';

  function apply(enabled) {
    if (destroyed) return;
    active = Boolean(enabled) && !reader.hidden;
    reader.classList.toggle('reading-fullscreen', active);
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', active ? 'Salir de pantalla completa' : 'Pantalla completa');
    button.title = button.getAttribute('aria-label');
    exitButton.hidden = !active;
    onLayoutChange();
  }

  async function setEnabled(enabled) {
    if (destroyed || (enabled && reader.hidden)) return;
    apply(enabled);
    if (native()) {
      try { win.HojaAndroid.setReadingFullscreen(active); }
      catch (error) { apply(false); onError('No se pudo activar la pantalla completa.'); }
      return;
    }
    try {
      if (active && !doc.fullscreenElement && reader.requestFullscreen) await reader.requestFullscreen();
      else if (!active && doc.fullscreenElement && doc.exitFullscreen) await doc.exitFullscreen();
    } catch (error) {
      // Retain the larger reading area even when the browser keeps its own bars.
      if (active) onError('El navegador mantiene sus barras. La vista de lectura está ampliada.');
    }
  }

  const toggle = () => setEnabled(!active);
  const exit = () => setEnabled(false);
  const browserChanged = () => { if (!native()) apply(doc.fullscreenElement === reader); };
  const keydown = event => {
    if (active && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); exit(); }
  };
  const nativeChanged = enabled => apply(enabled);
  win.hojaNativeFullscreenChanged = nativeChanged;
  button.addEventListener('click', toggle);
  exitButton.addEventListener('click', exit);
  doc.addEventListener('fullscreenchange', browserChanged);
  win.addEventListener('keydown', keydown, true);
  apply(false);
  return {
    get active() { return active; },
    setEnabled,
    exit,
    destroy() {
      destroyed = true;
      button.removeEventListener('click', toggle);
      exitButton.removeEventListener('click', exit);
      doc.removeEventListener('fullscreenchange', browserChanged);
      win.removeEventListener('keydown', keydown, true);
      if (win.hojaNativeFullscreenChanged === nativeChanged) delete win.hojaNativeFullscreenChanged;
    }
  };
}
