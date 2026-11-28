import type { HistoryVetoResult } from './qualityVetoHistory';

/** One scanner owns completed closed-market observations. In-flight work belongs to its poll's abort signal. */
export class LiveAdditionVetoCache {
  private readonly completed = new Map<string, HistoryVetoResult>();

  poll(position: string, boundary: number, signal: AbortSignal) {
    const inflight = new Map<string, Promise<HistoryVetoResult>>();
    const read = (rule: string, cut: number, calculate: () => Promise<HistoryVetoResult>) => {
      if (signal.aborted) throw new DOMException('已取消', 'AbortError');
      const key = JSON.stringify([position, rule, cut]);
      const saved = this.completed.get(key);
      if (saved) return Promise.resolve(saved);
      const running = inflight.get(key);
      if (running) return running;
      const work = Promise.resolve().then(calculate).then(value => {
        if (signal.aborted) throw new DOMException('已取消', 'AbortError');
        if (!value.pending) {
          this.completed.set(key, value);
          if (this.completed.size > 256) this.completed.delete(this.completed.keys().next().value!);
        }
        return value;
      }).finally(() => inflight.delete(key));
      inflight.set(key, work);
      return work;
    };
    return {boundary, read};
  }
}
