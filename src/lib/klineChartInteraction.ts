export type InteractionController = {
  /**
   * Re-arm the chart's lazy pointer listeners. When the pointer is currently
   * resting inside the chart, also repaint the crosshair at that resting point
   * so it appears without the user having to move. Returns true when the chart
   * event root was reachable.
   */
  prime: () => boolean;
  /**
   * Mark the chart's native pointer subscription as stale. The next prime or
   * real pointer event will rebuild KlineCharts' lazy listeners.
   */
  invalidate: () => void;
  destroy: () => void;
};

type BeforeActivate = () => void;

type PointerSample = { clientX: number; clientY: number; seen: boolean };

/**
 * Maps a chart host to its live prime(), so the free
 * primeKlineChartPointerInteraction() can reuse the tracked pointer instead of
 * blindly re-centering. Charts unregister on destroy.
 */
const interactionRegistry = new WeakMap<HTMLElement, InteractionController>();

const getChartEventRoot = (host: HTMLElement): HTMLElement | null => {
  // KlineCharts v9 mounts its event target (_chartContainer) with tabIndex === 1.
  const root = Array.from(host.children).find(
    (child): child is HTMLElement => child instanceof HTMLElement && child.tabIndex === 1,
  );
  if (root) return root;
  return host.firstElementChild instanceof HTMLElement ? host.firstElementChild : null;
};

const buildMouseEvent = (
  view: Window & typeof globalThis,
  type: "mouseenter" | "mousemove",
  clientX: number,
  clientY: number,
  bubbles: boolean,
): MouseEvent => new view.MouseEvent(type, {
  bubbles,
  cancelable: bubbles,
  clientX,
  clientY,
  screenX: 0,
  screenY: 0,
});

const pointerInsideRoot = (root: HTMLElement, pointer: PointerSample): boolean => {
  if (!pointer.seen) return false;
  const bounds = root.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return false;
  return (
    pointer.clientX >= bounds.left
    && pointer.clientX <= bounds.right
    && pointer.clientY >= bounds.top
    && pointer.clientY <= bounds.bottom
  );
};

/**
 * KlineCharts v9 attaches its `mousemove`/`wheel` listeners lazily inside
 * `_mouseEnterHandler` and drops them again on `mouseleave`; the crosshair is
 * only ever painted from a real `mousemove`. When a chart finishes loading (or
 * re-lays-out / re-commits data) underneath a stationary pointer, the browser
 * emits no `mouseenter`, so those listeners are never (re)installed and no
 * crosshair appears until the pointer happens to move or click.
 *
 * This controller repairs that by (1) tracking the live pointer position and
 * (2) replaying a synthetic `mouseenter` + `mousemove` at that resting point
 * whenever the caller signals a desync moment via prime(), so the crosshair
 * appears immediately and then follows real movement. It also arms on the very
 * first real move/press after a stationary mount, as a belt-and-suspenders
 * fallback for the case where no pointer position is known yet.
 */
export const installKlineChartPointerInteraction = (
  host: HTMLElement,
  beforeActivate?: BeforeActivate,
): InteractionController => {
  const chartEventRoot = getChartEventRoot(host);
  const view = host.ownerDocument.defaultView as (Window & typeof globalThis) | null;
  if (!chartEventRoot || !view) {
    return {
      prime: () => false,
      invalidate: () => undefined,
      destroy: () => undefined,
    };
  }
  const doc = host.ownerDocument;

  const pointer: PointerSample = { clientX: 0, clientY: 0, seen: false };
  // Guards our own synthetic dispatches out of the real-event handlers below.
  let synthesizing = false;
  // True while KlineCharts' lazy listeners are known to be live for this hover.
  let armed = false;

  const trackPointer = (event: MouseEvent) => {
    pointer.clientX = event.clientX;
    pointer.clientY = event.clientY;
    pointer.seen = true;
  };
  // Document-level so we learn the resting coordinate even when the chart mounts
  // under a pointer that is not moving over this specific element right now.
  doc.addEventListener("pointermove", trackPointer as EventListener, { capture: true, passive: true });
  doc.addEventListener("pointerdown", trackPointer as EventListener, { capture: true, passive: true });
  doc.addEventListener("mousemove", trackPointer, { capture: true, passive: true });

  // (Re)subscribe KlineCharts' lazy listeners by replaying an enter, and
  // optionally paint the crosshair at (clientX, clientY).
  const activate = (
    clientX: number,
    clientY: number,
    paint: boolean,
    syncBounds: boolean,
  ) => {
    const root = getChartEventRoot(host) ?? chartEventRoot;
    if (syncBounds) beforeActivate?.();
    synthesizing = true;
    try {
      // enter re-subscribes mousemove/wheel; keep it non-bubbling so it does not
      // reach the document pointer tracker with a synthetic coordinate.
      root.dispatchEvent(buildMouseEvent(view, "mouseenter", clientX, clientY, false));
      if (paint) {
        root.dispatchEvent(buildMouseEvent(view, "mousemove", clientX, clientY, true));
      }
    } finally {
      synthesizing = false;
    }
  };

  const prime = (): boolean => {
    const root = getChartEventRoot(host);
    if (!root) return false;
    if (pointerInsideRoot(root, pointer)) {
      armed = true;
      activate(pointer.clientX, pointer.clientY, true, true);
      return true;
    }
    // Pointer is outside or its position is not yet known: re-subscribe so the
    // next real move paints even without a fresh native enter, but do NOT paint
    // a crosshair at a fabricated (centered) coordinate.
    armed = false;
    const bounds = root.getBoundingClientRect();
    activate(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2, false, false);
    return true;
  };

  const invalidate = () => {
    // Browser hover state and KlineCharts' internal listener state can diverge
    // after a large async data commit or pane resize. Never infer native health
    // from the previous mouseenter once the chart lifecycle has advanced.
    armed = false;
  };

  const handleRealEnter = () => {
    // A native entry already makes KlineCharts subscribe its own listeners.
    if (synthesizing) return;
    armed = true;
  };

  const handleRealLeave = () => {
    if (synthesizing) return;
    armed = false;
  };

  const handleRealMove = (event: MouseEvent) => {
    if (synthesizing || armed) return;
    // Chart appeared under a stationary pointer, so no native enter fired and
    // KlineCharts never subscribed. Arm now and paint in this same frame.
    armed = true;
    activate(event.clientX, event.clientY, true, true);
  };

  const handleRealDown = (event: MouseEvent) => {
    if (synthesizing || armed) return;
    armed = true;
    activate(event.clientX, event.clientY, true, true);
  };

  chartEventRoot.addEventListener("mouseenter", handleRealEnter, true);
  chartEventRoot.addEventListener("mouseleave", handleRealLeave, true);
  chartEventRoot.addEventListener("mousemove", handleRealMove, true);
  chartEventRoot.addEventListener("mousedown", handleRealDown, true);

  const controller: InteractionController = {
    prime,
    invalidate,
    destroy: () => {
      interactionRegistry.delete(host);
      doc.removeEventListener("pointermove", trackPointer as EventListener, true);
      doc.removeEventListener("pointerdown", trackPointer as EventListener, true);
      doc.removeEventListener("mousemove", trackPointer, true);
      chartEventRoot.removeEventListener("mouseenter", handleRealEnter, true);
      chartEventRoot.removeEventListener("mouseleave", handleRealLeave, true);
      chartEventRoot.removeEventListener("mousemove", handleRealMove, true);
      chartEventRoot.removeEventListener("mousedown", handleRealDown, true);
    },
  };

  interactionRegistry.set(host, controller);

  return controller;
};

/**
 * Prime KlineCharts' lazy native listeners after data or viewport updates.
 * Reuses the installed controller (and its tracked pointer) when present so the
 * crosshair repaints at the resting point; otherwise falls back to replaying a
 * centered enter that just re-subscribes the listeners.
 */
export const primeKlineChartPointerInteraction = (host: HTMLElement): boolean => {
  const registered = interactionRegistry.get(host);
  if (registered) return registered.prime();

  const root = getChartEventRoot(host);
  const view = host.ownerDocument.defaultView as (Window & typeof globalThis) | null;
  if (!root || !view) return false;
  const bounds = root.getBoundingClientRect();
  root.dispatchEvent(buildMouseEvent(
    view,
    "mouseenter",
    bounds.left + bounds.width / 2,
    bounds.top + bounds.height / 2,
    false,
  ));
  return true;
};

export const invalidateKlineChartPointerInteraction = (host: HTMLElement): void => {
  interactionRegistry.get(host)?.invalidate();
};
