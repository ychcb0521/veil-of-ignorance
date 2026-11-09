/** A macrotask yields to input/painting without setTimeout's nested minimum delay.
 * Both ports and the abort listener are released after every yield. */
export function yieldScreening(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new DOMException('已暂停', 'AbortError'));
  return new Promise((resolve, reject) => {
    let channel: MessageChannel | undefined, timer: ReturnType<typeof setTimeout> | undefined, settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      channel?.port1.close(); channel?.port2.close();
      if (timer != null) clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      if (signal.aborted) reject(new DOMException('已暂停', 'AbortError')); else resolve();
    };
    signal.addEventListener('abort', finish, { once: true });
    if (typeof MessageChannel === 'undefined') timer = setTimeout(finish, 0);
    else {
      channel = new MessageChannel();
      channel.port1.onmessage = finish;
      channel.port2.postMessage(null);
    }
  });
}

/** Share this budget across successive minute reads. Cheap work keeps running;
 * sustained work yields at most once per slice, including during resume. */
export function screeningTimeSlice(signal: AbortSignal, budgetMs = 12) {
  let last = performance.now();
  return (): Promise<void> | undefined => {
    if (signal.aborted) throw new DOMException('已暂停', 'AbortError');
    if (performance.now() - last < budgetMs) return;
    return yieldScreening(signal).then(() => { last = performance.now(); });
  };
}
