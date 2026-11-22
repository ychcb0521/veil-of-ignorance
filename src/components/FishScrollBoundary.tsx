import {useEffect, useRef} from 'react';

/** Mounted at the end of a batch. Fires once when its scroll container is nearly filled or scrolled to the end. */
export function FishScrollBoundary({onReach}: {onReach: () => void}) {
  const marker = useRef<HTMLDivElement>(null);
  const action = useRef(onReach);
  action.current = onReach;
  useEffect(() => {
    const viewport = marker.current?.closest<HTMLElement>('[data-fish-scroll]');
    if (!viewport) return;
    let reached = false;
    function check() {
      if (!viewport || reached || viewport.clientHeight === 0) return;
      if (viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight > 120) return;
      reached = true;
      action.current();
    }
    viewport.addEventListener('scroll', check, {passive: true});
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(check);
    observer?.observe(viewport);
    check();
    return () => {
      reached = true;
      viewport.removeEventListener('scroll', check);
      observer?.disconnect();
    };
  }, []);
  return <div aria-hidden="true" ref={marker}/>;
}
