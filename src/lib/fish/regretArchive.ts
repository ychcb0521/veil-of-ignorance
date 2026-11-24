import {openZipBytes} from '@/lib/workbookZip';
import {qualityEntryIdentity} from './quality';
import {PARALLEL_UNIVERSE_VERSION, validSignalAdditionCount, type ParallelAttempt} from './parallelUniverse';
import type {RegretRoundIdentity} from './parallelUniverseStore';

const MB = 1024 * 1024;
const sha = async (bytes: Uint8Array<ArrayBuffer>) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
const decoder = new TextDecoder('utf-8', {fatal: true});

export interface RegretArchive {
  round: RegretRoundIdentity;
  attempts: ParallelAttempt[];
  digest: string;
}

export async function readRegretArchive(file: Blob): Promise<RegretArchive> {
  if (file.size > 64 * MB) throw Error('后悔库 ZIP 归档不能超过 64 MB');
  const read = openZipBytes(await file.arrayBuffer(), 96 * MB);
  const checked = async (name: string, expected?: string) => {
    const bytes = await read(name);
    if (!bytes || (expected && await sha(bytes) !== expected)) throw Error('归档校验失败：' + name);
    return bytes;
  };
  const manifestBytes = await checked('manifest.json');
  const m = JSON.parse(decoder.decode(manifestBytes));
  const validHash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (m?.format !== 'veil-parallel-attempt-archive-v1'
    || typeof m.roundId !== 'string' || !/^[a-f0-9-]{36}$/.test(m.roundId)
    || !Number.isSafeInteger(m.total) || m.total < 1 || m.total > 5000
    || !validSignalAdditionCount(m.additionCount) || !Number.isFinite(m.observeHours) || m.observeHours < 0 || m.observeHours > 8784
    || !validHash(m.templateSHA256) || !m.files || typeof m.files !== 'object') throw Error('后悔库归档清单无效');
  const files = Object.entries(m.files).sort(([a], [b]) => a.localeCompare(b));
  if (!files.length || files.length > 32 || files.some(([name, digest]) => !/^(attempts|repair)-\d+\.jsonl$/.test(name) || !validHash(digest))) {
    throw Error('后悔库归档文件列表无效');
  }
  const {plan} = JSON.parse(decoder.decode(await checked('template.json', m.templateSHA256)));
  if (!plan?.id || typeof plan.label !== 'string' || !plan.snapshot) throw Error('归档缺少冻结方案');
  const planText = JSON.stringify(plan);
  const attempts = new Map<string, ParallelAttempt>();
  const identities = new Set<string>(), attemptIds = new Set<string>();
  let expandedBytes = 0;
  for (const [name, digest] of files) {
    const bytes = await checked(name, digest as string);
    expandedBytes += bytes.length;
    if (expandedBytes > 512 * MB) throw Error('归档解压后超过 512 MB');
    const text = decoder.decode(bytes);
    for (let start = 0; start < text.length;) {
      const end = text.indexOf('\n', start);
      const line = text.slice(start, end < 0 ? text.length : end).trim();
      start = end < 0 ? text.length : end + 1;
      if (!line) continue;
      const a = JSON.parse(line) as ParallelAttempt;
      const c = a.candidate;
      if (a.version !== PARALLEL_UNIVERSE_VERSION || typeof a.id !== 'string' || !a.id || typeof c?.id !== 'string' || !c.id
        || (c.signalId !== undefined && typeof c.signalId !== 'string') || c.binanceEntry || typeof c.source?.symbol !== 'string'
        || !Number.isFinite(c.source.timeMs) || (c.enteredAt !== null && !Number.isFinite(c.enteredAt))
        || !Number.isFinite(a.baseline?.evaluatedAt) || typeof a.simulation?.status !== 'string'
        || a.additionCount !== m.additionCount || a.observeHours !== m.observeHours || JSON.stringify(a.plan) !== planText) throw Error('归档推演记录无效：' + name);
      const signal = a.proposedSignal;
      if (signal && (signal.symbol !== c.source.symbol || signal.source !== '平行宇宙' || signal.additionCount !== a.additionCount
        || ![signal.time, signal.buyPrice, signal.stopPrice].every(n => Number.isFinite(n) && n > 0))) throw Error('归档信号无效：' + name);
      const id = c.signalId ?? c.id;
      if (attempts.has(id) && name.startsWith('repair-')) continue;
      const identity = qualityEntryIdentity(c.source, c.enteredAt);
      if (attempts.has(id) || attemptIds.has(a.id) || identities.has(identity) || attempts.size >= m.total) throw Error('归档存在重复或多余记录');
      attempts.set(id, {...a, plan});
      identities.add(identity);
      attemptIds.add(a.id);
    }
  }
  if (attempts.size !== m.total) throw Error(`归档应有 ${m.total} 条，实际读取 ${attempts.size} 条`);
  const values = [...attempts.values()];
  const startedAt = values.reduce((latest, a) => Math.max(latest, a.baseline.evaluatedAt), 0);
  return {round: {id: m.roundId, startedAt, total: m.total}, attempts: values, digest: await sha(manifestBytes)};
}
