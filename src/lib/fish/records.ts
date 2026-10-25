import type { TradeSignal } from '@/lib/signalLibrary';
import { stockCode } from '@/lib/signalMarket';
import { signalDedupKey } from '@/lib/signalLibrary';
import { CBI2_DEF, compileFeatureFormula, definitionKey } from '@/lib/deepDig/features';
import { constraintFingerprint, fishAlgorithmKey, type FishSnapshot } from './algorithm';
const archiveSuffix = (s: TradeSignal) => s.fishArchive ? `|archive:${s.fishArchive.id}` : '';
/** Migrate deterministically; never let normal signal-library dedup collapse different algorithms. */
export function migrateFishSignal(s: TradeSignal): TradeSignal {
  const r=s.fish;
  if(r?.algorithms?.length)return s;
  // 旧记录（外层 avg）有 H；最早的记录连算法键都没有，当时固定是 avg 24h。现在的记录没有 H。
  const texts=r?.constraints??[],H=r?.H??(r?.algorithmKey?undefined:24),direction=r?.direction??'>',threshold=r?.threshold??0.3,featureId=r?.featureId??'cbi2';
  const statistic=r?.statistic??'结果',constraintKey=constraintFingerprint(texts),algorithmKey=fishAlgorithmKey(featureId,H,direction,threshold,constraintKey,statistic);
  const fish={...r,average:r?.average??NaN,cbi2:r?.cbi2??r?.value??NaN,startAverage:r?.startAverage??NaN,previousAverage:r?.previousAverage??NaN,cutoffMs:r?.cutoffMs??s.timeMs,
    statistic,featureId,featureName:r?.featureName??CBI2_DEF.name,featureShort:r?.featureShort??CBI2_DEF.short,definitionKey:r?.definitionKey??definitionKey(CBI2_DEF),interval:r?.interval??'5m',H,direction,threshold,thresholdRaw:r?.thresholdRaw??threshold/(r?.scale??1),scale:r?.scale??1,unit:r?.unit??CBI2_DEF.unit,constraints:texts,constraintKey,algorithmKey,value:r?.value??r?.cbi2??NaN,startConstraints:r?.startConstraints??[],cutoffConstraints:r?.cutoffConstraints??[]};
  const venue=s.exchange&&s.exchange!=='binance'?`${s.exchange}-`:'';
  return {...s,...(s.market==='us_stock'?{underlying:stockCode(s),exchange:s.exchange??'binance'}:{}),id:`fish-${s.market==='us_stock'?`us-${s.exchange??'binance'}-${stockCode(s)}`:`${venue}${s.symbol}`}-${s.timeMs}-${encodeURIComponent(algorithmKey)}${archiveSuffix(s)}`,fish};
}
export const fishCatchKey=(s:TradeSignal)=>`${signalDedupKey(s)}|${migrateFishSignal(s).fish!.algorithmKey}`;
export const fishDedupKey=(s:TradeSignal)=>fishCatchKey(s)+archiveSuffix(s);
/** Archive before the next scan: re-catching the same signal must not consume an earlier round’s copy. */
export function archiveFishForNextRound(list: TradeSignal[], at = Date.now()): TradeSignal[] {
  if (!list.some(s => !s.fishArchive)) return list;
  const id = crypto.randomUUID();
  return list.map(s => {
    if (s.fishArchive) return s;
    const { freshCatch: _fresh, ...saved } = s;
    return { ...saved, id: `${s.id}|archive:${id}`, fishArchive: { id, at } };
  });
}
/** Ignore only the exact old fresh occurrence already present as an archive, never a later capture. */
export function withoutArchivedFreshCopies(list: readonly TradeSignal[]): TradeSignal[] {
  const versions = new Map<string, Set<number>>();
  for (const s of list) if (s.fishArchive) {
    const key = fishCatchKey(s), set = versions.get(key) ?? new Set<number>();
    set.add(s.caughtAt ?? 0); versions.set(key, set);
  }
  return list.filter(s => s.fishArchive || !s.freshCatch || !versions.get(fishCatchKey(s))?.has(s.caughtAt ?? 0));
}
export function mergeFishSignals(existing: readonly TradeSignal[],incoming: readonly TradeSignal[]): TradeSignal[] {
  const map=new Map<string,TradeSignal>();
  for(const raw of withoutArchivedFreshCopies([...existing,...incoming])){
    const s=migrateFishSignal(raw),key=fishDedupKey(s),previous=map.get(key);
    map.set(key,previous?{...previous,...s,quality:previous.quality??s.quality,freshCatch:previous.freshCatch||s.freshCatch||undefined}:s);
  }
  return [...map.values()];
}
const savedResultMetrics = new Map<string, { name?: string; metric?: string }>();
/** Resolve only the captured formula; cache repeated labels without reading today's definitions. */
function savedResultMetric(key: string): { name?: string; metric?: string } {
  const cached = savedResultMetrics.get(key);
  if (cached) return cached;
  let result: { name?: string; metric?: string } = {};
  try {
    const saved = JSON.parse(key);
    if (Array.isArray(saved) && typeof saved[0] === 'string') {
      const last = compileFeatureFormula(saved[0]).program.statements.at(-1);
      if (last) result = { name: last.name ?? undefined, metric: last.name ?? (last.expr.k === 'var' ? last.expr.name : saved[0].split('\n')[last.line - 1]?.split('//')[0].split(';').at(-1)?.trim()) };
    }
  } catch { /* Missing historical evidence must stay unknown. */ }
  if (savedResultMetrics.size >= 128) savedResultMetrics.clear();
  savedResultMetrics.set(key, result);
  return result;
}
function savedFishMetric(a: Partial<FishSnapshot>): string | undefined {
  const key = a.algorithmKey?.split('|');
  const selected = a.statistic ?? (key?.length === 6 ? key[1] : undefined);
  return selected && selected !== '结果' ? selected : savedResultMetric(a.definitionKey ?? 'null').metric;
}
/** Pre-subtype labels are retained only to recognize previously saved deletion markers. */
function legacyFishSourceLabel(a: Partial<FishSnapshot> | undefined): string {
  const short = a?.featureShort || a?.featureName || '—';
  const key = a?.algorithmKey?.split('|');
  if ((a?.featureId ?? key?.[0]) !== 'state' && !(a?.featureId == null && a?.featureShort === 'S')) return short;
  let statistic = a?.statistic ?? (key?.[0] === 'state' ? key[1] : undefined);
  // Earliest records applied an external average; later “结果” records retain the exact formula.
  if (a?.H != null && a.H > 0) return 'avg_S';
  if (statistic === '结果' && a?.definitionKey) {
    statistic = savedResultMetric(a.definitionKey).name;
  }
  if (statistic === 'state') return 'S 原值';
  if (statistic && /^avg_state(?:_\d+)?$/.test(statistic)) return 'avg_S';
  return statistic && statistic !== '结果' ? `S [${statistic}]` : 'S（序列不详）';
}
/** One label per captured subtype: original, avg, avg₂, avg₃, or an exact custom series. */
export function fishSourceLabel(a: Partial<FishSnapshot> | undefined): string {
  if (!a) return '—';
  const key = a.algorithmKey?.split('|'), parts = key?.length === 6 ? key : undefined;
  const id = a.featureId ?? parts?.[0];
  const state = id === 'state' || (id == null && a.featureShort === 'S');
  const short = state ? 'S' : a.featureShort || a.featureName || id || '—';
  const H = a.H ?? (parts && parts[2] !== '=' ? Number(parts[2]) : undefined);
  const metric = savedFishMetric(a);
  const average = metric ? /^avg_(.+?)(?:_(\d+))?$/.exec(metric) : null;
  const normalize = (name: string) => name.replace(/[-_\s]/g, '').toLowerCase();
  const aliases = state ? ['state'] : id === 'drift-speed-z' ? ['az', 'a'] : id === 'drift-speed' ? ['a'] : id === 'seller-control' ? ['bc'] : [];
  const raw = !!metric && [id, short, ...aliases].some(name=>name && normalize(name)===normalize(metric));
  const label = average ? `${short}·avg${average[2]?.replace(/\d/g, d => '₀₁₂₃₄₅₆₇₈₉'[Number(d)]) ?? ''}`
    : raw ? `${short} 原值` : metric ? `${short} [${metric}]` : state ? 'S（序列不详）' : short;
  if (H != null && Number.isFinite(H) && H > 0) return `${raw || !metric ? short : label}·avg(${H}h)`;
  return label;
}
/** 捕捞过程显示捕获时实际比较的序列；「结果」只从保存的公式解析，不读当前账号定义。 */
export function fishMetricLabel(a: Partial<FishSnapshot>): string {
  const key = a.algorithmKey?.split('|');
  const parts = key?.length === 6 ? key : undefined;
  const metric = savedFishMetric(a);
  const H = a.H ?? (parts && parts[2] !== '=' ? Number(parts[2]) : undefined);
  if (H != null && Number.isFinite(H) && H > 0) return `avg(${metric ?? '结果（指标未记录）'}, ${H}h)（旧版外层均值）`;
  if (!metric) return '结果（指标未记录）';
  const normalize = (name: string) => name.replace(/[-_\s]/g, '').toLowerCase();
  const raw = [a.featureId ?? parts?.[0], a.featureShort].some(name => name && normalize(name) === normalize(metric!));
  return raw ? `${metric}（原始值）` : metric;
}
/** 算法简称：交集「A ∩ B」，并集「A ∪ B」。 */
export const fishAlgorithmShort=(s:TradeSignal)=>s.fish?.algorithms?.length?s.fish.algorithms.map(fishSourceLabel).join(s.fish.combination==='or'?' ∪ ':' ∩ '):fishSourceLabel({...s.fish,featureShort:s.fish?.featureShort??'CBI-2'});

/**
 * 「算法类型」：这条鱼实际是哪个（些）算法捕到的。单算法 = 它自己；交集 = 每个算法；并集 = 命中的那几个。
 * 【用户要求】2026-10-20「把具体是哪个算法捕捞到的（如果是多个，就把多个都写上去），专门开设一列（命名为：算法类型）」。
 */
function caughtBy(s: TradeSignal, label: typeof fishSourceLabel): string[] {
  const r = s.fish;
  if (!r) return ['CBI-2'];
  if (r.algorithms?.length) {
    const picked = r.combination === 'or' ? (r.hitAlgorithms ?? []).map(i => r.algorithms![i - 1]) : r.algorithms;
    return [...new Set(picked.filter(Boolean).map(label))];
  }
  return [label({ ...r, featureShort: r.featureShort ?? 'CBI-2' })];
}
export const fishCaughtBy = (s: TradeSignal): string[] => caughtBy(s, fishSourceLabel);
export const legacyFishVisibleCatchKey = (s: TradeSignal) => `${signalDedupKey(s)}|${caughtBy(s, legacyFishSourceLabel).join(' · ')}`;

/**
 * 整行显示的内容：标的（含交易所 / 美股）、信号时间、算法类型。这几样都一样的鱼在列表里看起来完全重复。
 * 【用户要求】2026-10-21「鱼中，多个信号的信息整行完全重复时，只留一个就行，不要重复」——
 * 同一条信号换过阈值或交集 / 并集后会以不同的算法键各存一份（键不同、显示相同），按这个键再合并一次。
 */
export const fishVisibleCatchKey = (s: TradeSignal) => `${signalDedupKey(s)}|${fishCaughtBy(s).join(' · ')}`;
/** 鱼舱跨轮按表格内容去重；本轮新鱼仍与已入舱的记录分开。 */
export const fishVisibleKey = (s: TradeSignal) => fishVisibleCatchKey(s)+(s.freshCatch ? '' : '|archive');
/** 同一列表显示相同的只留最近捕到的一条，评分沿用；不因入舱编号不同而重复。 */
export function collapseVisibleFish(list: readonly TradeSignal[]): TradeSignal[] {
  const kept = new Map<string, TradeSignal>();
  let duplicate = false;
  for (const s of list) {
    const k = fishVisibleKey(s), prev = kept.get(k);
    if (!prev) { kept.set(k, s); continue; }
    duplicate = true;
    const takeNew = (s.caughtAt ?? s.fishArchive?.at ?? 0) > (prev.caughtAt ?? prev.fishArchive?.at ?? 0);
    const [win, lose] = takeNew ? [s, prev] : [prev, s];
    kept.set(k, { ...win, quality: win.quality ?? lose.quality });
  }
  return duplicate ? [...kept.values()] : list as TradeSignal[];
}
