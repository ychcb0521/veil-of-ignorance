type InteractionController = {
  prime: () => boolean;
  destroy: () => void;
};

type BeforeActivate = () => void;

const getChartEventRoot = (host: HTMLElement): HTMLElement | null => {
  const root = Array.from(host.children).find(
    (child): child is HTMLElement => child instanceof HTMLElement && child.tabIndex === 1,
  );
  if (root) return root;
  return host.firstElementChild instanceof HTMLElement ? host.firstElementChild : null;
};

const dispatchMouseEnter = (
  host: HTMLElement,
  source?: Pick<MouseEvent, "clientX" | "clientY" | "screenX" | "screenY">,
): boolean => {
  const chartEventRoot = getChartEventRoot(host);
  const view = host.ownerDocument.defaultView;
  if (!chartEventRoot || !view) return false;

  const bounds = chartEventRoot.getBoundingClientRect();
  chartEventRoot.dispatchEvent(new view.MouseEvent("mouseenter", {
    bubbles: false,
    cancelable: false,
    clientX: source?.clientX ?? bounds.left + bounds.width / 2,
    clientY: source?.clientY ?? bounds.top + bounds.height / 2,
    screenX: source?.screenX ?? 0,
    screenY: source?.screenY ?? 0,
  }));
  return true;
};

/**
 * KlineCharts v9 installs mousemove and wheel listeners lazily from mouseenter.
 * If a chart finishes loading underneath a stationary pointer, the browser does
 * not emit that mouseenter and the first movement is otherwise ignored. This
 * bridge repairs exactly that first interaction, then gets out of the hot path.
 */
export const installKlineChartPointerInteraction = (
  host: HTMLElement,
  beforeActivate?: BeforeActivate,
): InteractionController => {
  const chartEventRoot = getChartEventRoot(host);
  const view = host.ownerDocument.defaultView;
  if (!chartEventRoot || !view) {
    return { prime: () => false, destroy: () => undefined };
  }

  let readyForRealPointer = false;
  let replayingFirstMove = false;

  const prepare = (event: MouseEvent, dispatchEnter: boolean) => {
    if (readyForRealPointer) return;
    readyForRealPointer = true;
    beforeActivate?.();
    if (dispatchEnter) dispatchMouseEnter(host, event);
  };

  const handleMouseEnter = (event: MouseEvent) => {
    // Synthetic priming must not consume the real first-entry repair below.
    if (event.isTrusted) prepare(event, false);
  };

  const handleMouseMove = (event: MouseEvent) => {
    if (replayingFirstMove || readyForRealPointer) return;

    prepare(event, true);

    // The native listener was added by the synthetic mouseenter during this
    // event's capture phase. Replay the same coordinate once so the crosshair
    // appears in the current frame instead of waiting for another movement.
    replayingFirstMove = true;
    try {
      chartEventRoot.dispatchEvent(new view.MouseEvent("mousemove", {
        bubbles: true,
        cancelable: true,
        clientX: event.clientX,
        clientY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
        button: event.button,
        buttons: event.buttons,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
      }));
    } finally {
      replayingFirstMove = false;
    }
  };

  const handleMouseDown = (event: MouseEvent) => {
    // A click can be the first event when the chart appeared under the cursor.
    // Prime before KlineCharts receives the original mousedown so drag works too.
    prepare(event, true);
  };

  chartEventRoot.addEventListener("mouseenter", handleMouseEnter, true);
  chartEventRoot.addEventListener("mousemove", handleMouseMove, true);
  chartEventRoot.addEventListener("mousedown", handleMouseDown, true);

  return {
    prime: () => dispatchMouseEnter(host),
    destroy: () => {
      chartEventRoot.removeEventListener("mouseenter", handleMouseEnter, true);
      chartEventRoot.removeEventListener("mousemove", handleMouseMove, true);
      chartEventRoot.removeEventListener("mousedown", handleMouseDown, true);
    },
  };
};

/** Prime KlineCharts' lazy native listeners after data or viewport updates. */
export const primeKlineChartPointerInteraction = (host: HTMLElement): boolean => (
  dispatchMouseEnter(host)
);
