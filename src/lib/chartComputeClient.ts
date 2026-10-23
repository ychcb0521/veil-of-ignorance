import type { KLineData } from 'klinecharts';
import type { CompiledFeature, DeepDigFeatureDef } from './deepDig/features';
import type { ChartFeatureSeries } from './featureSource';
import type { ChartComputeJob } from './chartCompute.worker';
const enabled = new WeakSet<KLineData[]>(), firstBars = new WeakSet<object>();
export function enableChartComputation(data: KLineData[], inheritFirstBar = true) { enabled.add(data); if (inheritFirstBar && data[0]) firstBars.add(data[0]); }
export const isChartComputationEnabled = (data: KLineData[]) => !failed && typeof Worker !== 'undefined' && (enabled.has(data) || !!data[0] && firstBars.has(data[0]));
const listeners = new Set<() => void>();
let version = 0, notification = false, sequence = 0, failed = false;
export const chartComputationVersion = () => version;
export function subscribeChartComputation(fn: () => void) { listeners.add(fn); return () => {
    listeners.delete(fn);
    if (!listeners.size) {
      if (worker) { worker.onmessage = null; worker.onerror = null; worker.terminate(); }
      clearWatchdog(); worker = undefined; active = undefined; queued.clear(); channels.clear(); packet = undefined;
    }
  }; }
function notify() {
  if (notification) return;
  notification = true;
  requestAnimationFrame(() => { notification = false; version++; for (const fn of listeners) fn(); });
}
interface Request {
  delta?: { revision:number; changes:readonly [number,number][]; referenceVersion:number };
  data: KLineData[]; refs?: (number | null)[]; signature: string;
  compiled: CompiledFeature; params: ChartComputeJob['params']; variables: string[]; core: string | null; def: DeepDigFeatureDef;
}
interface Channel { id: number; request: Request; requested: string; initialized: boolean; result: ChartFeatureSeries | null; first: number; last: number; sent?: {revision:number; referenceVersion:number; first:number; length:number} }
const perData = new WeakMap<KLineData[], Map<string, Channel>>(), channels = new Map<number, Channel>(), queued = new Set<Channel>();
let worker: Worker | undefined, active: Channel | undefined, packet: ArrayBuffer | undefined;
let activeTimes: number[] = [];
/** A same-chart forward repair may insert missing timestamps. Keep the worker's
 * incremental program cache; replies are aligned by their captured timestamps. */
export function resetChartComputationAlignment(data: KLineData[]) {
  for (const channel of perData.get(data)?.values() ?? []) {
    channel.result = null; channel.requested = ''; channel.sent = undefined;
  }
}
let watchdog: ReturnType<typeof setTimeout> | undefined;
function clearWatchdog() { if (watchdog != null) clearTimeout(watchdog); watchdog = undefined; }
function startWorker() {
  if (worker) return;
  worker = new Worker(new URL('./chartCompute.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    clearWatchdog();
    packet = data.packet;
    const channel = channels.get(data.id);
    if (channel && !data.error) {
      const latest = channel.request.data;
      // Rewinds/replacements must never paint a result from the future or another history window.
      if (data.first === latest[0]?.timestamp && data.last <= (latest.at(-1)?.timestamp ?? -Infinity)) {
        const vars = new Map<string, (number | null)[]>();
        const indices = new Map(activeTimes.map((time, i) => [time, i]));
        for (const [name, values] of Object.entries(data.vars as Record<string, Float64Array>)) vars.set(name, latest.map(bar => {
          const index = indices.get(bar.timestamp), value = index == null ? NaN : values[index];
          return Number.isFinite(value) ? value : null;
        }));
        channel.result = { def: channel.request.def, vars, core: vars.get(channel.request.core ?? '') ?? [] };
        channel.first = data.first; channel.last = data.last;
        notify();
      }
    }
    active = undefined;
    if (data.error) { fallback(); return; }
    pump();
  };
  worker.onerror = fallback;
}
function fallback() {
  clearWatchdog(); failed = true; worker?.terminate(); worker = undefined; active = undefined; queued.clear(); channels.clear(); notify();
}
function pump() {
  if (active || failed || !queued.size) return;
  const channel = queued.values().next().value!; queued.delete(channel);
  if (!channels.has(channel.id)) { pump(); return; }
  const r = channel.request, n = r.data.length, sent = channel.sent;
  let from = 0;
  if (sent && r.delta && sent.first === r.data[0]?.timestamp && n >= sent.length && sent.referenceVersion === r.delta.referenceVersion
    && r.delta.changes.length && r.delta.changes[0][0] <= sent.revision + 1) {
    from = Math.max(0, Math.min(sent.length - 1, ...r.delta.changes.filter(([v]) => v > sent.revision).map(([, start]) => start)));
  }
  const size = (n - from) * 10;
  if (!packet || packet.byteLength < size * 8) packet = new ArrayBuffer(Math.max(8, 2 ** Math.ceil(Math.log2(Math.max(1, size)))) * 8);
  const values = new Float64Array(packet, 0, size);
  for (let i = from; i < n; i++) {
    const b = r.data[i], at = (i - from) * 10;
    const number = (v: unknown) => typeof v === 'number' ? v : NaN;
    values[at] = number(b.timestamp); values[at+1] = number(b.open); values[at+2] = number(b.high); values[at+3] = number(b.low); values[at+4] = number(b.close);
    values[at+5] = number(b.volume); values[at+6] = number(b.turnover); values[at+7] = number(b.takerBuyTurnover); values[at+8] = number(r.refs?.[i]);
  }
  try {
    startWorker(); active = channel; activeTimes = r.data.map(bar => bar.timestamp);
    const job: ChartComputeJob = { id: channel.id, length:n, from, packet, params:r.params, variables:r.variables, compiled:r.compiled };
    worker!.postMessage(job, [packet]); packet = undefined; channel.initialized = true;
    watchdog = setTimeout(fallback, 15_000);
    channel.sent = r.delta ? {revision:r.delta.revision,referenceVersion:r.delta.referenceVersion,first:r.data[0]?.timestamp,length:n} : undefined;
  } catch { fallback(); }
}
/** At most one in-flight job and one latest pending snapshot per formula; never build a replay backlog. */
export function requestChartComputation(context: string, request: Request): ChartFeatureSeries | null {
  let map = perData.get(request.data);
  if (!map) { map = new Map(); perData.set(request.data, map); }
  let channel = map.get(context);
  if (!channel || !channels.has(channel.id)) {
    channel = { id:++sequence, request, requested:'', initialized:false, result:null, first:NaN, last:NaN };
    map.set(context, channel); channels.set(channel.id, channel);
    if (channels.size > 64) { const oldest = channels.keys().next().value!; const old = channels.get(oldest)!; queued.delete(old); channels.delete(oldest); }
  }
  const first = request.data[0]?.timestamp, last = request.data.at(-1)?.timestamp;
  if (channel.first !== first || channel.last > (last ?? -Infinity)) channel.result = null;
  if (channel.requested !== request.signature) {
    channel.request = request; channel.requested = request.signature; queued.add(channel); pump();
  }
  return channel.result;
}
