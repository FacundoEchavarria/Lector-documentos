// Track one pair of fingers and report its scale and midpoint in viewport pixels.
export function bindPinchZoom(target, { onStart, onMove, onEnd, project = point }) {
  const types = ['touchstart', 'touchmove', 'touchend', 'touchcancel'];
  let gesture;

  function handleTouch(event) {
    const touches = Array.from(event.touches);
    if (!gesture) {
      if (event.type !== 'touchstart' || touches.length !== 2 ||
          !touches.every(touch => target.contains(touch.target))) return;
      const [first, second] = touches;
      const start = measure(project(first), project(second));
      if (start.span < 1 || !onStart(start.center)) return;
      gesture = { ids: [first.identifier, second.identifier], span: start.span };
    } else {
      const [first, second] = gesture.ids.map(id => touches.find(touch => touch.identifier === id));
      if (!first || !second || event.type === 'touchcancel') {
        gesture = null;
        onEnd();
        return;
      }
      if (event.type === 'touchmove') {
        const current = measure(project(first), project(second));
        onMove(current.span / gesture.span, current.center);
      }
    }
    if (event.cancelable) event.preventDefault();
  }

  for (const type of types) target.addEventListener(type, handleTouch, { passive: false });
  return () => {
    gesture = null;
    for (const type of types) target.removeEventListener(type, handleTouch);
  };
}

export function clampPinchZoom(value) {
  return Math.max(.6, Math.min(2.5, value));
}

function point(touch) {
  return { x: touch.clientX, y: touch.clientY };
}

function measure(first, second) {
  return {
    span: Math.hypot(first.x - second.x, first.y - second.y),
    center: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
  };
}
