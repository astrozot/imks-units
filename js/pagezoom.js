// Keep browser magnification out of interactive app surfaces. Custom sky,
// globe and map gestures still receive their events and control their views.
export function preventPageZoom(scope) {
  const controller = new AbortController();
  const options = { capture: true, passive: false, signal: controller.signal };
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    scope.addEventListener(type, (ev) => ev.preventDefault(), options);
  }
  scope.addEventListener('touchmove', (ev) => {
    if (ev.touches.length > 1) ev.preventDefault();
  }, options);
  scope.addEventListener('wheel', (ev) => {
    if (ev.ctrlKey || ev.metaKey) ev.preventDefault();
  }, options);
  scope.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ['+', '=', '-', '_'].includes(ev.key)) ev.preventDefault();
  }, options);
  return () => controller.abort();
}
