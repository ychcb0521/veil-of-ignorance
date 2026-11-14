/**
 * All account-state writes share one lane. Independent autosave/IDB queues must
 * not multiply concurrent JSONB writes on the same small Postgres instance.
 * This changes transport only: keys, values and saved template snapshots stay intact.
 */
interface SyncResponse { error: { message: string } | null }
type SyncRequest<T> = PromiseLike<T> & { abortSignal?(signal: AbortSignal): PromiseLike<T> };
let tail: Promise<unknown> = Promise.resolve();
let nextStart = 0;
let nextBulkStart = 0;
let failures = 0;
const REQUEST_TIMEOUT_MS = 20_000;
const BYTES_PER_SECOND = 128 * 1024;
// Wall-clock corrections must not indefinitely extend a throttle/cooldown.
const now = () => performance.now();

export function runAccountSyncRequest<T extends SyncResponse>(
  request: () => SyncRequest<T>,
  options: { bytes?: number; preference?: boolean; current?: () => boolean } = {},
): Promise<T | undefined> {
  const bulk = (options.bytes ?? 0) > 16 * 1024;
  // An explicit settings save can use the shared lane during archive pacing.
  // It still advances the bulk budget and honors the shared outage cooldown.
  const waitsForBulkBudget = bulk && !options.preference;
  const attempt = (): Promise<T | undefined> => {
    const task = tail.then(async (): Promise<{wait: number} | {response: T | undefined}> => {
      const delay = Math.max(nextStart, waitsForBulkBudget ? nextBulkStart : 0) - now();
      // A throttled archive releases the lane while waiting, so a small explicit
      // settings/trade save can proceed without waiting behind megabytes of data.
      if (delay > 0) return {wait: delay};
      // Recheck after waiting: an obsolete retry must never overwrite a newer save.
      if (options.current && !options.current()) return {response: undefined};
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const pending = request();
        const response = await Promise.race([
          Promise.resolve(pending.abortSignal ? pending.abortSignal(controller.signal) : pending),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new Error('账号云端同步超时，本机存档仍保留'));
            }, REQUEST_TIMEOUT_MS);
          }),
        ]);
        if (response.error) {
          failures += 1;
          nextStart = now() + Math.min(120_000, 3_000 * 2 ** Math.min(failures - 1, 6));
        } else {
          failures = 0;
          // Pace large JSONB payloads as well as limiting connection concurrency.
          // Small preferences/trades do not pay the cost of a large archive upload.
          const pause = Math.ceil((options.bytes ?? 0) / BYTES_PER_SECOND * 1_000);
          if (bulk) nextBulkStart = Math.max(nextBulkStart, now()) + pause;
          nextStart = now() + (bulk ? 0 : pause);
        }
        return {response};
      } catch (error) {
        failures += 1;
        nextStart = now() + Math.min(120_000, 3_000 * 2 ** Math.min(failures - 1, 6));
        throw error;
      } finally {
        if (timer) clearTimeout(timer);
      }
    });
    tail = task.catch(() => undefined);
    return task.then(async result => {
      if ('response' in result) return result.response;
      await new Promise(resolve => setTimeout(resolve, result.wait));
      return attempt();
    });
  };
  return attempt();
}

export function __resetAccountSyncTransportForTests(): void {
  tail = Promise.resolve(); nextStart = 0; nextBulkStart = 0; failures = 0;
}
