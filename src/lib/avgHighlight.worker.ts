import { CDA_HOURLY_AVERAGE_HOURS, usesHourlyCda } from '@/lib/cdaPeriods';
import { appendResearchAverages } from '@/lib/researchAverageFormula';
import { fetchResearchKlines, clearMarketDataCache, intervalMs } from '@/lib/deepRsa/marketData';
import { compileFeatureFormula, evaluateOnBars, halfLifeOf, avgHoursOf, type DeepDigFeatureDef } from '@/lib/deepDig/features';
import { AVG_CALIBRATION_CUTOFF, avgCoreKey, calibratedAverageLimits, displayAverage, type AverageKind, type AvgHighlightSpec } from './avgHighlight';
import { readAvgCache, writeAvgCache } from './avgHighlightStorage';

interface Definition { spec: AvgHighlightSpec; def: DeepDigFeatureDef; period: number; names: { core: string; avg: string; avg2: string } }
interface Job { key: string; coreKey: string; symbols: string[]; featureId: string; period: number; hours: number; kind: AverageKind; definitions: Definition[] }
let queue = Promise.resolve();
const post = (message: unknown) => self.postMessage(message);
const btc = new Map<string, Map<number, number>>();
let exchangeInfo: Promise<{ symbols: { symbol: string; onboardDate: number; status: string }[] }> | undefined;
async function metadata() {
  return exchangeInfo ??= (async () => {
    const response = await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo');
    if (!response.ok) throw Error(`合约上市时间读取失败 (${response.status})`);
    const data = await response.json();
    if (!Array.isArray(data.symbols)) throw Error('合约资料格式错误');
    return data;
  })();
}
async function history(symbol: string, population: string[], interval: '5m' | '1h') {
  const step = intervalMs(interval);
  const cutoff = Math.floor(AVG_CALIBRATION_CUTOFF / step) * step;
  const info = await metadata();
  const selected = population.map(s => info.symbols.find(row => row.symbol === s));
  if (selected.some(row => !row || !Number.isFinite(row.onboardDate))) throw Error('样本中存在无法确认上市时间的合约');
  const contract = info.symbols.find(row => row.symbol === symbol);
  if (!contract) throw Error(`${symbol} 合约资料缺失`);
  const start = symbol === 'BTCUSDT' ? Math.min(...selected.map(row => row!.onboardDate)) : contract.onboardDate;
  const bars = await fetchResearchKlines(symbol, start, cutoff, undefined, undefined, interval);
  clearMarketDataCache();
  if (!bars.length) throw Error(`${symbol} 没有历史K线`);
  if (bars[0].openTime > Math.ceil(start / step) * step) throw Error(`${symbol} 上市初期历史缺失，停止校准`);
  if (contract.status === 'TRADING' && bars.at(-1)!.openTime + step !== cutoff) throw Error(`${symbol} 历史末端不完整，停止校准`);
  for (let i = 0; i < bars.length; i++) {
    if (i && bars[i].openTime !== bars[i - 1].openTime + step) throw Error(`${symbol} 历史缺K线，停止校准`);
    if (bars[i].quoteVolume == null || bars[i].takerBuyQuoteVolume == null) throw Error(`${symbol} 缺少成交额字段，停止校准`);
  }
  return bars;
}
async function run(job: Job) {
  const chunks: Float64Array[] = [];
  const wanted = job.definitions.find(d => d.def.id === job.featureId)!;
  const hourly = usesHourlyCda(wanted.def);
  const interval = hourly ? '1h' : '5m';
  const defaultHours = hourly ? CDA_HOURLY_AVERAGE_HOURS : 24;
  const namedAverage = job.hours === defaultHours;
  for (let index = 0; index < job.symbols.length; index++) {
    const symbol = job.symbols[index];
    const cacheKey = (d: Definition) => `core:${avgCoreKey(job.symbols, d.def, d.period)}:${symbol}`;
    const selectedKey = (d: Definition) => cacheKey(d) + (namedAverage ? `:named:${job.kind}` : '');
    let core = await readAvgCache<Float64Array>(selectedKey(wanted));
    if (!core) {
      const bars = await history(symbol, job.symbols, interval);
      if (!hourly || compileFeatureFormula(wanted.def.formula).usesBtc) {
        let reference = btc.get(interval);
        if (!reference) {
          reference = new Map((await history('BTCUSDT', job.symbols, interval)).map(b => [b.openTime, b.close]));
          btc.set(interval, reference);
        }
        for (const b of bars) {
          b.refClose = reference.get(b.openTime);
          if (b.refClose == null) throw Error(`${symbol} BTC对照缺失，停止校准`);
        }
      }
      for (const definition of job.definitions) {
        const { def, spec, period } = definition;
        const isWanted = def.id === job.featureId;
        if (await readAvgCache<Float64Array>(isWanted ? selectedKey(definition) : cacheKey(definition))) continue;
        let formula = def.formula;
        const names = new Set(compileFeatureFormula(formula).program.statements.map(s => s.name));
        // Keep the legacy calibration's helper namespace and formulas for all existing variants.
        if (hourly) formula = appendResearchAverages(formula, names, definition.names, defaultHours);
        else {
          if (!names.has(definition.names.avg)) formula += `\n${definition.names.avg} = avg(${definition.names.core}, 24)`;
          if (!names.has(definition.names.avg2)) {
            let helper = '_calibration_m6'; while (names.has(helper)) helper += '_';
            formula += `\n${helper} = avg(${definition.names.core}, 6)\n${definition.names.avg2} = (4 * ${helper} + 3 * ago(${helper}, 6) + 2 * ago(${helper}, 12) + ago(${helper}, 18)) / 10`;
          }
        }
        const compiled = compileFeatureFormula(formula);
        // Same chart parameter bindings; the account's formula text remains unchanged.
        if (['bss', 'dss'].includes(def.id)) compiled.program = { ...compiled.program, statements: compiled.program.statements.map(s => s.name === 'n' && s.expr.k === 'num' ? { ...s, expr: { ...s.expr, v: period } } : s) };
        const output = evaluateOnBars(bars, compiled, { interval, halfLifeHours: ['state', 'state2', 'cbi2', 'cdi2', 'bss', 'dss'].includes(def.id) ? halfLifeOf(def) : period, avgHours: ['state', 'state2', 'cbi2', 'cdi2'].includes(def.id) ? period : avgHoursOf(def) });
        const name = spec.id === 'DSP_Z' && !output.vars.has('az') ? 'a' : spec.core;
        const series = output.vars.get(name);
        if (!(series instanceof Float64Array)) throw Error(`${def.id} 缺少 ${name} 字段`);
        await writeAvgCache(cacheKey(definition), series);
        if (isWanted) {
          const selected = namedAverage ? output.vars.get(definition.names[job.kind]) : series;
          if (!(selected instanceof Float64Array)) throw Error(`${def.id} 均值字段缺失`);
          core = selected;
          if (namedAverage) await writeAvgCache(selectedKey(definition), core);
        }
      }
    }
    if (!core) throw Error(`${symbol} 未生成目标指标`);
    chunks.push((namedAverage ? core : displayAverage(core, job.hours, job.kind, hourly ? 60 : 5)).map(v => v * wanted.def.scale));
    post({ key: job.key, progress: `校准中 ${index + 1}/${job.symbols.length}` });
  }
  const pooled = new Float64Array(chunks.reduce((n, a) => n + a.length, 0));
  let offset = 0; for (const chunk of chunks) { pooled.set(chunk, offset); offset += chunk.length; }
  post({ key: job.key, limits: calibratedAverageLimits(pooled, wanted.spec) });
}
self.onmessage = ({ data }: MessageEvent<Job>) => {
  queue = queue.then(() => run(data)).catch(error => post({ key: data.key, error: error instanceof Error ? error.message : String(error) }));
};
