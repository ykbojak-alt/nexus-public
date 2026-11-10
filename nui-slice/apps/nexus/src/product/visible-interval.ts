/** Run periodic visual work only while its owning document is visible. */
export function runWhileDocumentVisible(
  callback: () => void,
  intervalMs: number,
  doc: Document = document,
): () => void {
  let timer: number | null = null;
  let wasHidden = doc.hidden;
  const start = () => {
    if (timer == null && !doc.hidden) timer = window.setInterval(callback, intervalMs);
  };
  const stop = () => {
    if (timer == null) return;
    window.clearInterval(timer);
    timer = null;
  };
  const onVisibilityChange = () => {
    if (doc.hidden) {
      wasHidden = true;
      stop();
      return;
    }
    start();
    if (wasHidden) callback();
    wasHidden = false;
  };

  doc.addEventListener('visibilitychange', onVisibilityChange);
  start();

  return () => {
    stop();
    doc.removeEventListener('visibilitychange', onVisibilityChange);
  };
}

/** Schedule one animation frame at a time only while the owner is visible. */
export function runAnimationFrameWhileVisible(
  callback: (time: number) => void,
  doc: Document = document,
): () => void {
  let frame = 0;
  let active = true;
  const tick: FrameRequestCallback = (time) => {
    frame = 0;
    if (!active || doc.hidden) return;
    callback(time);
    schedule();
  };
  const schedule = () => {
    if (active && !doc.hidden && frame === 0) frame = window.requestAnimationFrame(tick);
  };
  const onVisibilityChange = () => {
    if (doc.hidden) {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      frame = 0;
      return;
    }
    schedule();
  };

  doc.addEventListener('visibilitychange', onVisibilityChange);
  schedule();

  return () => {
    active = false;
    if (frame !== 0) window.cancelAnimationFrame(frame);
    frame = 0;
    doc.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
