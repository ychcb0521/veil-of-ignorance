import { CUSTOM_RESEARCH_INDICATORS, researchSeriesNames } from './researchIndicators';
import { chartFeatureDef } from '@/lib/featureSource';
import { loadSignals, sortSignalsBy, SIGNAL_LIBRARY_STORAGE_KEY } from '@/lib/signalLibrary';
import { readAvgCache, writeAvgCache } from './avgHighlightStorage';
import { AVG_HIGHLIGHT_SPECS, avgCoreKey, avgResultKey, type AverageKind, type AverageLimits } from './avgHighlight';
import bootstrap from '@/data/avgHighlightBootstrap.json';

// Public assets contain only aggregate limits and SHA-256 fingerprints, never account formulas or the selected symbols.
const results = new Map<string, AverageLimits>();
async function bootstrapLimits(key: string): Promise<AverageLimits | undefined> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return (bootstrap.entries as { key: string; limits: AverageLimits }[]).find(entry => entry.key === hash)?.limits;
}
const states = new Map<string, string>();
const listeners = new Set<() => void>();
let worker: Worker | undefined, version = 0;
export const avgCalibrationVersion = () => version;
export function subscribeAvgCalibration(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
function notify() { version++; for (const fn of listeners) fn(); }
let population: { raw: string | null; selected: ReturnType<typeof loadSignals>; symbols: string[] } | undefined;
function calibrationPopulation() {
  const raw = localStorage.getItem(SIGNAL_LIBRARY_STORAGE_KEY);
  if (population?.raw === raw) return population;
  const seen = new Set<string>();
  const selected = sortSignalsBy(loadSignals().filter(s => s.quality != null && s.quality >= 1 && s.quality <= 5), 'quality', 'desc')
    .filter(s => { if (seen.has(s.symbol)) return false; seen.add(s.symbol); return true; }).slice(0, 30);
  return population = { raw, selected, symbols: selected.map(s => s.symbol).sort() };
}
export function avgCalibrationContext(featureId: string, period: number, hours: number, kind: AverageKind) {
  const { selected, symbols } = calibrationPopulation();
  if (selected.some(s => s.market === 'us_stock' || (s.exchange != null && s.exchange !== 'binance'))) return { limits: undefined, status: '样本含非币安合约，需先核对行情来源' };
  const spec = AVG_HIGHLIGHT_SPECS.find(s => s.featureId === featureId), def = chartFeatureDef(featureId);
  if (!spec || !def || symbols.length !== 30) return { limits: undefined, status: '需要30个已评分标的才能校准' };
  const coreKey = avgCoreKey(symbols, def, period), key = avgResultKey(coreKey, hours, kind);
  if (!results.has(key) && !states.has(key)) {
    states.set(key, '校准中');
    void readAvgCache<AverageLimits>(key).catch(() => undefined).then(hit => hit ?? bootstrapLimits(key).catch(() => undefined)).then(hit => {
      if (hit) { results.set(key, hit); states.set(key, '已缓存'); notify(); return; }
      try {
        if (!worker) {
          worker = new Worker(new URL('./avgHighlight.worker.ts', import.meta.url), { type: 'module' });
          worker.onmessage = ({ data }) => {
            if (data.limits) { results.set(data.key, data.limits); void writeAvgCache(data.key, data.limits).catch(() => {}); }
            states.set(data.key, data.error ? `校准失败：${data.error}` : data.progress ?? '已缓存');
            if (data.limits || data.error) notify();
          };
          worker.onerror = () => { for (const [k, state] of states) if (state.startsWith('校准中')) states.set(k, '校准失败，请重载后重试'); notify(); };
        }
        const definitions = AVG_HIGHLIGHT_SPECS.map(item => {
          const definition = chartFeatureDef(item.featureId)!;
          const defaultPeriod = ['state', 'cbi2', 'cdi2'].includes(item.featureId) ? definition.avgHours ?? 24 : ['bss', 'dss'].includes(item.featureId) ? 12 : definition.halfLifeHours ?? 6;
          const indicator = CUSTOM_RESEARCH_INDICATORS.find(i => i.featureId === item.featureId)!;
          return { spec: item, def: definition, names: researchSeriesNames(indicator, definition.formula), period: item.featureId === featureId ? period : defaultPeriod };
        });
        worker.postMessage({ key, coreKey, symbols, featureId, period, hours, kind, definitions });
      } catch (e) { states.set(key, `校准失败：${String(e)}`); notify(); }
    });
  }
  return { limits: results.get(key), status: states.get(key) ?? '已缓存' };
}
