import {ArchiveReadFailure} from './accountArchiveRead';

/** Resume verified, complete batches of the same account revision on this page. */
export type RecoveryProgress = {phase: 'download' | 'decode' | 'save'; done: number; total: number};
export interface RecoveryRead {
  signal: AbortSignal;
  report: (progress: RecoveryProgress) => void;
}
export function checkRecoverySignal(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}

interface Batch {key: string; value: {rev?: string; data?: string}}
interface PartCache {id: string; rev: string; parts: (string | undefined)[]; count: number}
let retained: PartCache | undefined;

export function clearRecoveryParts(id?: string) {
  if (id === undefined || id === retained?.id) retained = undefined;
}

export async function readQualityRecoveryParts(
  id: string, rev: string, keys: string[],
  read: (keys: string[], signal: AbortSignal) => Promise<Batch[]>,
  context: RecoveryRead,
): Promise<string[]> {
  checkRecoverySignal(context.signal);
  if (retained?.id !== id || retained.rev !== rev || retained.parts.length !== keys.length) {
    retained = {id, rev, parts: new Array(keys.length), count: 0};
  }
  const cache = retained;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  const report = () => context.report({phase: 'download', done: cache.count, total: keys.length});
  context.signal.addEventListener('abort', cancel, {once: true});
  let cursor = 0;
  const batchSize = 4;
  async function worker() {
    while (cursor < keys.length) {
      checkRecoverySignal(controller.signal);
      const from = cursor;
      cursor += batchSize;
      if (cache.parts[from] !== undefined) continue;
      const batch = keys.slice(from, from + batchSize);
      const rows = await read(batch, controller.signal);
      checkRecoverySignal(controller.signal);
      const values = new Map(rows.map(row => [row.key, row.value]));
      const verified = batch.map(key => {
        const part = values.get(key);
        if (part?.rev !== rev || typeof part.data !== 'string') throw new ArchiveReadFailure('revision');
        return part.data;
      });
      verified.forEach((part, index) => { cache.parts[from + index] = part; });
      cache.count += verified.length;
      report();
    }
  }
  try {
    report();
    await Promise.all([worker(), worker()]);
    return cache.parts as string[];
  } finally {
    controller.abort();
    context.signal.removeEventListener('abort', cancel);
  }
}
