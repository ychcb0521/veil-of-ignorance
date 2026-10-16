/**
 * Deep RSA · 第 3–5 步的一键流程（在用户浏览器里跑，只读，不写任何数据、不下单）。
 *
 * 1. 事件：本机战役（排除组之外、有锚点的）按同标的 48h 单链去重成簇，每簇一个代表；
 *    簇标签：含正样本不含对照 → 正；含对照不含正样本 → 对照；一正一负或含冲突组 → 不进标签目标。
 *    另抽随机背景时点（不预设为失败，只进「24h 最大涨幅」目标）。
 * 2. 行情：每个事件取 [t₀ − 48h, t₀ 后第一根整点 + 24h) 的 5m K 线（含主动买入量）。
 * 3. 特征：观察窗覆盖率 ≥ 95% 才算；h ∈ {2, 6, 12} 三套；结果期覆盖率 ≥ 95% 才有结果值。
 * 4. 按时间 60/20/20 切分（隔离带 72h）；训练集上 3 类表征 × 3 个 h × 2 个目标做 Mantel 检验，整面板 Holm。
 * 5. 验证集上为每个 表征 × 目标 选 h 并冻结；训练集在该 h 上通过 Holm 的，才在测试集上检验（测试集只读一次）。
 * 5b. 测试集之后做 5 项稳健性检验（控制波动率 / 只看战役 / 换目标 / 按标的分块 / 标签用全部时间段），只描述，不改判定。
 * 6. 标签目标有样本外通过的，才拟合中心模型、在测试期逐 5m 扫描并与基线一起回测（滑点 0 / 5 / 10 个基点）。
 *
 * 用户确认（2026-10-15）：谢林三个候选并列算；订单流用 5m K 线主动买入量作代理；
 * 对照组保留现有规则，同时加跑「24h 真实涨幅」目标。
 */
import { CODE_VERSION } from '@/lib/deepRsa/campaignLabels';
import { computeDspFeatures } from '@/lib/deepRsa/dspFeatures';
import { computeFeatures, FEATURE_DEFINITIONS, type FeatureFamily, type FeatureKey } from '@/lib/deepRsa/features';
import { clusterEvents, normalizeResearchSymbol, sampleBackgroundAnchors, WINDOW_MS, type DeepRsaGroup } from '@/lib/deepRsa/grouping';
import { fetchFundingHistory, fetchResearchKlines, intervalMs, mapLimit, MarketDataError, type FetchFn, type ResearchInterval } from '@/lib/deepRsa/marketData';
import { forwardOutcome, OUTCOME_HORIZON_MS } from '@/lib/deepRsa/outcome';
import type { CampaignGroupReport } from '@/lib/deepRsa/report';
import {
  bhAdjust, holmAdjust, rsaEvaluate, runRsaPanel, selectHalfLife, type PanelRow, type RepresentationSpec, type Row, type RsaEvent,
} from '@/lib/deepRsa/rsa';
import { alwaysScorer, centroidScore, fitCentroidModel, modelScorer, momentumScorer, pickThreshold, prepareBars, scanSymbol } from '@/lib/deepRsa/scan';
import { featureContrast, runRobustness, type FeatureContrastRow, type RobustnessResult } from '@/lib/deepRsa/robustness';
import { chronologicalSplit } from '@/lib/deepRsa/splits';

export type { FeatureContrastRow };
import { simulateLongTrade, summarizeTrades, type TradeResult, type TradeSummary } from '@/lib/deepRsa/backtest';
import { BAR_MS, extractWindow, HALF_LIFE_CANDIDATES_H, type ObservationWindow, type ResearchBar } from '@/lib/deepRsa/window';

export const ALPHA = 0.05;
export const MIN_WINDOW_COVERAGE = 0.95;
export const BACKGROUND_CAP = 150;
export const BACKTEST_SYMBOL_CAP = 40;
export const SLIPPAGE_SCENARIOS = [0, 0.0005, 0.001] as const;

export const REPRESENTATIONS: readonly (RepresentationSpec & { name: FeatureFamily })[] = (['price', 'orderFlow', 'schelling'] as const)
  .map(name => ({ name, keys: FEATURE_DEFINITIONS.filter(d => d.family === name).map(d => d.key) }));

export type RunStage = 'events' | 'fetch' | 'features' | 'rsa' | 'oos' | 'robustness' | 'backtest_fetch' | 'backtest' | 'done';
export interface RunProgress { stage: RunStage; done: number; total: number }

export interface RunItem {
  id: string;
  symbol: string;
  anchorMs: number;
  kind: 'event' | 'background';
  label: 'positive' | 'control' | null;
  memberIds: string[];
}

export type RsaTarget = 'label' | 'outcome';

export interface PanelResultRow {
  representation: FeatureFamily;
  halfLifeHours: number;
  target: RsaTarget;
  rho: number;
  p: number;
  pHolm: number;
  pBh: number;
  nEvents: number;
  nPairs: number;
  usedKeys: string[];
  droppedKeys: string[];
}

export interface SelectionRow {
  representation: FeatureFamily;
  target: RsaTarget;
  valRhoByH: Record<number, number | null>;
  selectedH: number | null;
  trainPassed: boolean;
}

export type Verdict = '已验证' | '待验证' | '检验未获支持';

export interface OosRow {
  representation: FeatureFamily;
  target: RsaTarget;
  halfLifeHours: number;
  rho: number;
  p: number;
  pHolm: number;
  nEvents: number;
  verdict: Verdict;
}

export interface StrategyResult { name: string; signals: number; skipped: number; summary: TradeSummary }

export interface BacktestResult {
  skippedReason: string | null;
  representation?: FeatureFamily;
  halfLifeHours?: number;
  threshold?: number;
  momentumThreshold?: number;
  fromMs?: number;
  toMs?: number;
  symbols?: string[];
  droppedSymbols?: string[];
  failedSymbols?: { symbol: string; reason: string }[];
  fundingReal?: number;
  scenarios?: { slippage: number; strategies: StrategyResult[] }[];
  verdict?: Verdict;
}

export interface DeepRsaRunResult {
  codeVersion: string;
  startedAt: number;
  finishedAt: number;
  seed: number;
  permutations: number;
  coverage: {
    campaigns: number;
    clusters: number;
    labeled: { positive: number; control: number };
    background: number;
    fetched: number;
    failed: { id: string; symbol: string; reason: string }[];
    lowCoverage: number;
    outcomeMissing: number;
    missingTakerEvents: number;
  };
  split: { train: number; val: number; test: number; embargoed: number; valCut: number | null; testCut: number | null };
  featureContrast: { halfLifeHours: number; rows: FeatureContrastRow[] };
  panel: PanelResultRow[];
  selection: SelectionRow[];
  oos: OosRow[];
  /** 测试集之后的 5 项稳健性检验（不改判定）。旧版导出的 JSON 没有这一项。 */
  robustness?: RobustnessResult;
  backtest: BacktestResult;
  conclusions: { rsa: Verdict; backtest: Verdict };
}

export interface RunEvent extends RsaEvent {
  anchorMs: number;
  symbol: string;
  kind: 'event' | 'background';
  momentum: number | null;
  /** 客观结果三件套（结果期覆盖率 ≥ 95% 才有）：最大涨幅（= outcome）、最大跌幅、期末收益，都是对数。 */
  maxUp: number | null;
  maxDown: number | null;
  endRet: number | null;
  /** 这一簇里的战役 id（随机背景为空）；旧结果与测试数据可能没有。 */
  memberIds?: string[];
}

/** 第 1–3 步（事件、行情、特征）的产物：Deep RSA 主流程与特征深挖共用同一份。 */
export interface CollectedEvents {
  events: RunEvent[];
  campaigns: number;
  clusters: number;
  fetchedCount: number;
  failed: { id: string; symbol: string; reason: string }[];
  lowCoverage: number;
  outcomeMissing: number;
  missingTakerEvents: number;
}

export interface RunOptions {
  seed?: number;
  permutations?: number;
  fetchFn?: FetchFn;
  signal?: AbortSignal;
  onProgress?: (p: RunProgress) => void;
  concurrency?: number;
  backgroundCap?: number;
}

function clusterLabel(groups: readonly DeepRsaGroup[]): 'positive' | 'control' | null {
  if (groups.includes('conflict')) return null;
  const pos = groups.includes('positive');
  const ctl = groups.includes('control');
  if (pos && ctl) return null;
  return pos ? 'positive' : ctl ? 'control' : null;
}

/** 事件簇代表 + 随机背景时点。 */
/** 一个事件行：战役（或 Deep dig 的信号）的 id、标的、锚点与分组。 */
export interface EventRow { id: string; symbol: string; anchorMs: number; group: DeepRsaGroup }

export function buildRunItems(
  report: CampaignGroupReport,
  seed: number,
  backgroundCap = BACKGROUND_CAP,
  /** Deep dig：按特征值自己的分组标准与样本来源给出的事件行（排除项已去掉）；不给时用战役的默认分组。 */
  eventRows?: readonly EventRow[],
  /**
   * 同币 48h 内的事件合为一簇（战役的默认做法）。Deep dig 的信号样本不合并：
   * 【用户要求】2026-10-16「有一个信号，有具体的时间和评级，来自于信号库……这个信号也属于数据，也要纳入进来运行」——每条信号单独一个事件。
   */
  cluster = true,
): { items: RunItem[]; campaigns: number; clusters: number } {
  const rows: EventRow[] = eventRows ? [...eventRows] : report.rows
    .filter(r => r.grouping.group !== 'excluded' && r.anchorMs != null)
    .map(r => ({ id: r.campaignId, symbol: r.symbol, anchorMs: r.anchorMs!, group: r.grouping.group }));
  const groupById = new Map(rows.map(r => [r.id, r.group]));
  const clusters = cluster
    ? clusterEvents(rows.map(r => ({ id: r.id, symbol: r.symbol, anchorMs: r.anchorMs })))
    : [...rows].sort((a, b) => a.anchorMs - b.anchorMs).map(r => ({ clusterId: r.id, symbol: r.symbol, firstAnchorMs: r.anchorMs, memberIds: [r.id] }));
  const items: RunItem[] = clusters.map(c => ({
    id: c.clusterId, symbol: c.symbol, anchorMs: c.firstAnchorMs, kind: 'event',
    label: clusterLabel(c.memberIds.map(id => groupById.get(id)!)), memberIds: c.memberIds,
  }));
  if (items.length) {
    const anchors = items.map(i => i.anchorMs);
    const bg = sampleBackgroundAnchors({
      symbols: [...new Set(items.map(i => i.symbol))],
      fromMs: Math.min(...anchors),
      toMs: Math.max(...anchors),
      count: Math.min(backgroundCap, items.length),
      seed,
      avoid: rows.map(r => ({ id: r.id, symbol: r.symbol, anchorMs: r.anchorMs })),
    });
    items.push(...bg.map(b => ({ id: b.id, symbol: b.symbol, anchorMs: b.anchorMs, kind: 'background' as const, label: null, memberIds: [] })));
  }
  return { items, campaigns: rows.length, clusters: clusters.length };
}

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new MarketDataError('已取消', 'aborted');
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 第 1–3 步：事件簇 + 随机背景 → 拉 5m K 线 → 观察窗特征（h = 2 / 6 / 12）与客观结果。 */
export async function collectRunEvents(
  report: CampaignGroupReport,
  options: Pick<RunOptions, 'seed' | 'fetchFn' | 'signal' | 'onProgress' | 'concurrency' | 'backgroundCap'> & {
    eventRows?: readonly EventRow[];
    /** false = 事件不按同币 48h 合簇（Deep dig 的信号样本）。 */
    cluster?: boolean;
    /**
     * Deep dig：按用户公式在观察窗上算出的额外特征，并进每个半衰期的特征里。
     * 给了 featureKlines 时，传进来的是那个周期、那段长度的观察窗（取不到为 null）；否则是 5m、48h 的观察窗。
     */
    extraFeatures?: (window: ObservationWindow | null) => Row;
    /**
     * Deep dig 特征值用别的 K 线周期 / 观察窗长度：【用户要求】2026-10-16「周期这里可以做成能够自主选择的。选择哪个周期，就统计哪个周期的变量」。
     * 另外再取一次这个周期的 K 线；24h 客观结果、波动率等仍按 5m 算（结果口径不随周期变）。
     */
    featureKlines?: { interval: ResearchInterval; windowMs: number };
  } = {},
): Promise<CollectedEvents> {
  const seed = options.seed ?? 20261015;
  const fetchFn = options.fetchFn;
  const signal = options.signal;
  const progress = (stage: RunStage, done: number, total: number) => options.onProgress?.({ stage, done, total });
  const H = [...HALF_LIFE_CANDIDATES_H];
  // ── 1. 事件 ──
  progress('events', 0, 1);
  const { items, campaigns, clusters } = buildRunItems(report, seed, options.backgroundCap, options.eventRows, options.cluster ?? true);

  // ── 2. 行情 ──
  const failed: DeepRsaRunResult['coverage']['failed'] = [];
  progress('fetch', 0, items.length);
  const fetched = await mapLimit(items, options.concurrency ?? 4, item => {
    checkAbort(signal);
    const entry = Math.ceil(item.anchorMs / BAR_MS) * BAR_MS;
    return fetchResearchKlines(normalizeResearchSymbol(item.symbol), item.anchorMs - WINDOW_MS, entry + OUTCOME_HORIZON_MS, fetchFn, signal);
  }, done => progress('fetch', done, items.length * (options.featureKlines ? 2 : 1)));
  checkAbort(signal);
  const fk = options.featureKlines;
  const fkBarMs = fk ? intervalMs(fk.interval) : BAR_MS;
  const featureFetched = fk ? await mapLimit(items, options.concurrency ?? 4, item => {
    checkAbort(signal);
    return fetchResearchKlines(normalizeResearchSymbol(item.symbol), item.anchorMs - fk.windowMs, item.anchorMs, fetchFn, signal, fk.interval);
  }, done => progress('fetch', items.length + done, items.length * 2)) : null;
  checkAbort(signal);

  // ── 3. 特征 ──
  progress('features', 0, items.length);
  const events: RunEvent[] = [];
  let lowCoverage = 0;
  let outcomeMissing = 0;
  let missingTakerEvents = 0;
  items.forEach((item, i) => {
    const res = fetched[i];
    if (res.status === 'rejected') {
      if (res.reason instanceof MarketDataError && res.reason.kind === 'aborted') return;
      failed.push({ id: item.id, symbol: item.symbol, reason: reasonOf(res.reason) });
      return;
    }
    const bars: ResearchBar[] = res.value;
    const window = extractWindow(bars, item.anchorMs);
    if (window.coverage < MIN_WINDOW_COVERAGE) { lowCoverage++; return; }
    if (window.missingTakerBars > 0) missingTakerEvents++;
    const featuresByH: Record<number, Row> = {};
    // 第 7 步的 DSP 读数并在同一份特征里（键不在 FEATURE_DEFINITIONS 里：第 3–5 步的表征与特征对比都不会用到它们）
    let featureWindow: ObservationWindow | null = window;
    if (fk && featureFetched) {
      const fr = featureFetched[i];
      featureWindow = fr.status === 'fulfilled' ? extractWindow(fr.value, item.anchorMs, fk.windowMs, fkBarMs) : null;
    }
    const extra = options.extraFeatures?.(featureWindow) ?? {};
    for (const h of H) featuresByH[h] = { ...computeFeatures(window, { halfLifeHours: h }), ...computeDspFeatures(window, h), ...extra };
    const outcome = forwardOutcome(bars, item.anchorMs);
    const outcomeOk = outcome != null && outcome.coverage >= MIN_WINDOW_COVERAGE;
    const outcomeValue = outcomeOk ? outcome.maxUp : null;
    if (outcomeValue == null) outcomeMissing++;
    events.push({
      id: item.id, symbol: normalizeResearchSymbol(item.symbol), anchorMs: item.anchorMs, kind: item.kind,
      featuresByH, label: item.label, outcome: outcomeValue,
      block: new Date(item.anchorMs).toISOString().slice(0, 7),
      momentum: momentumScorer(window),
      maxUp: outcomeValue, maxDown: outcomeOk ? outcome.maxDown : null, endRet: outcomeOk ? outcome.endRet : null,
      memberIds: item.memberIds,
    });
  });
  progress('features', items.length, items.length);
  checkAbort(signal);

  return {
    events, campaigns, clusters,
    fetchedCount: fetched.filter(r => r.status === 'fulfilled').length,
    failed, lowCoverage, outcomeMissing, missingTakerEvents,
  };
}

export async function runDeepRsa(report: CampaignGroupReport, options: RunOptions = {}): Promise<DeepRsaRunResult> {
  const startedAt = Date.now();
  const seed = options.seed ?? 20261015;
  // 18 个检验做 Holm：p 的下限是 1/(置换次数+1)，1999 次时校正后最低约 0.009，999 次约 0.018，199 次永远过不了 0.05
  const permutations = options.permutations ?? 1999;
  const fetchFn = options.fetchFn;
  const signal = options.signal;
  const progress = (stage: RunStage, done: number, total: number) => options.onProgress?.({ stage, done, total });
  const H = [...HALF_LIFE_CANDIDATES_H];

  const { events, campaigns, clusters, fetchedCount, failed, lowCoverage, outcomeMissing, missingTakerEvents } = await collectRunEvents(report, {
    seed, fetchFn, signal, onProgress: options.onProgress, concurrency: options.concurrency, backgroundCap: options.backgroundCap,
  });

  // ── 4. 切分 + 训练集面板 ──
  const split = chronologicalSplit(events);
  const panelRaw: Omit<PanelRow, 'pHolm' | 'pBh'>[] = [];
  progress('rsa', 0, REPRESENTATIONS.length);
  for (const [k, rep] of REPRESENTATIONS.entries()) {
    await tick();
    checkAbort(signal);
    panelRaw.push(...runRsaPanel(split.train, [rep], H, { permutations, seed }));
    progress('rsa', k + 1, REPRESENTATIONS.length);
  }
  const holm = holmAdjust(panelRaw.map(r => r.p));
  const bh = bhAdjust(panelRaw.map(r => r.p));
  const panel: PanelResultRow[] = panelRaw.map((r, i) => ({
    representation: r.representation as FeatureFamily, halfLifeHours: r.halfLifeHours, target: r.target,
    rho: r.rho, p: r.p, pHolm: holm[i], pBh: bh[i], nEvents: r.nEvents, nPairs: r.nPairs, usedKeys: r.usedKeys, droppedKeys: r.droppedKeys,
  }));

  // ── 5. 验证集选 h，训练集是否通过 ──
  const selection: SelectionRow[] = [];
  for (const rep of REPRESENTATIONS) {
    for (const target of ['label', 'outcome'] as const) {
      const valRhoByH: Record<number, number | null> = {};
      for (const h of H) {
        const r = rsaEvaluate(split.train, split.val, rep, h, target, { permutations: 0 });
        valRhoByH[h] = Number.isFinite(r.rho) ? r.rho : null;
      }
      const selectedH = selectHalfLife(H.map(h => ({ halfLifeHours: h, rho: valRhoByH[h] ?? Number.NaN })));
      const trainRow = panel.find(r => r.representation === rep.name && r.target === target && r.halfLifeHours === selectedH);
      selection.push({
        representation: rep.name, target, valRhoByH, selectedH,
        trainPassed: !!trainRow && trainRow.rho > 0 && trainRow.pHolm < ALPHA,
      });
    }
  }

  // ── 6. 测试集（只读一次）──
  const passed = selection.filter(s => s.trainPassed && s.selectedH != null);
  progress('oos', 0, passed.length);
  const oosRaw = [];
  for (const [k, s] of passed.entries()) {
    await tick();
    checkAbort(signal);
    const rep = REPRESENTATIONS.find(r => r.name === s.representation)!;
    const r = rsaEvaluate(split.train, split.test, rep, s.selectedH!, s.target, { permutations, seed });
    oosRaw.push({ representation: s.representation, target: s.target, halfLifeHours: s.selectedH!, rho: r.rho, p: r.p, nEvents: r.nEvents });
    progress('oos', k + 1, passed.length);
  }
  const oosHolm = holmAdjust(oosRaw.map(r => r.p));
  const oos: OosRow[] = oosRaw.map((r, i) => ({
    ...r, pHolm: oosHolm[i], verdict: r.rho > 0 && oosHolm[i] < ALPHA ? '已验证' : '检验未获支持',
  }));

  // ── 6b. 稳健性检验（不改判定）：对测试集检验过的「结果」项 + 标签用全部时间段 ──
  progress('robustness', 0, 1);
  const robustness = await runRobustness(
    split, oos, REPRESENTATIONS,
    name => selection.find(s => s.representation === name && s.target === 'label')?.selectedH ?? null,
    { permutations, seed, alpha: ALPHA },
    { onStep: async (done, total) => { progress('robustness', done, total); await tick(); checkAbort(signal); } },
  );

  // ── 7. 回测（标签目标样本外通过才做）──
  const backtest = await runBacktest(oos, split, { fetchFn, signal, progress });

  const hContrast = 6;
  return {
    codeVersion: CODE_VERSION,
    startedAt,
    finishedAt: Date.now(),
    seed,
    permutations,
    coverage: {
      campaigns, clusters,
      labeled: { positive: events.filter(e => e.label === 'positive').length, control: events.filter(e => e.label === 'control').length },
      background: events.filter(e => e.kind === 'background').length,
      fetched: fetchedCount,
      failed, lowCoverage, outcomeMissing, missingTakerEvents,
    },
    split: {
      train: split.train.length, val: split.val.length, test: split.test.length, embargoed: split.embargoed.length,
      valCut: split.cutoffs.val, testCut: split.cutoffs.test,
    },
    featureContrast: { halfLifeHours: hContrast, rows: featureContrast(split.train, hContrast) },
    panel,
    selection,
    oos,
    robustness,
    backtest,
    conclusions: {
      rsa: oos.some(r => r.verdict === '已验证') ? '已验证' : '检验未获支持',
      backtest: backtest.verdict ?? '检验未获支持',
    },
  };
}

async function runBacktest(
  oos: readonly OosRow[],
  split: ReturnType<typeof chronologicalSplit<RunEvent>>,
  ctx: { fetchFn?: FetchFn; signal?: AbortSignal; progress: (stage: RunStage, done: number, total: number) => void },
): Promise<BacktestResult> {
  const best = oos.filter(r => r.target === 'label' && r.verdict === '已验证').sort((a, b) => b.rho - a.rho)[0];
  if (!best) return { skippedReason: '标签目标没有样本外通过的表征：按事先约定不进入交易回测' };
  const rep = REPRESENTATIONS.find(r => r.name === best.representation)!;
  const h = best.halfLifeHours;
  const trainLabeled = split.train.filter(e => e.label != null);
  const model = fitCentroidModel(trainLabeled.map(e => e.featuresByH[h] ?? {}), trainLabeled.map(e => e.label), rep.keys, h);
  if (!model) return { skippedReason: '训练集正样本或对照组为空，无法拟合模型' };
  const threshold = pickThreshold(split.val.map(e => centroidScore(model, e.featuresByH[h] ?? {})));
  const momentumThreshold = pickThreshold(split.val.map(e => e.momentum));
  if (threshold == null || momentumThreshold == null) return { skippedReason: '验证集有效分数不足 5 个，无法定阈值' };
  if (!split.test.length || split.cutoffs.test == null) return { skippedReason: '测试集为空' };

  const fromMs = split.cutoffs.test;
  const toMs = Math.max(...split.test.map(e => e.anchorMs));
  const allSymbols = [...new Set(split.test.map(e => e.symbol))].sort();
  const symbols = allSymbols.slice(0, BACKTEST_SYMBOL_CAP);
  const droppedSymbols = allSymbols.slice(BACKTEST_SYMBOL_CAP);
  const failedSymbols: { symbol: string; reason: string }[] = [];
  const barsBySymbol: Record<string, ResearchBar[]> = {};
  const fundingBySymbol: Record<string, { fundingTime: number; rate: number }[]> = {};
  ctx.progress('backtest_fetch', 0, symbols.length);
  await mapLimit(symbols, 3, async symbol => {
    checkAbort(ctx.signal);
    try {
      barsBySymbol[symbol] = await fetchResearchKlines(symbol, fromMs - WINDOW_MS, toMs + OUTCOME_HORIZON_MS + BAR_MS, ctx.fetchFn, ctx.signal);
    } catch (error) {
      failedSymbols.push({ symbol, reason: reasonOf(error) });
      return;
    }
    try {
      fundingBySymbol[symbol] = await fetchFundingHistory(symbol, fromMs, toMs + OUTCOME_HORIZON_MS + BAR_MS, ctx.fetchFn, ctx.signal);
    } catch {
      // 拿不到真实资金费：这个标的按假设费率算，汇总里计数
    }
  }, done => ctx.progress('backtest_fetch', done, symbols.length));
  checkAbort(ctx.signal);

  // 信号与滑点无关：每条策略每个标的只扫描一次，三种滑点只重算成交与成本
  const strategies = [
    { name: '模型', scorer: modelScorer(model), threshold },
    { name: '48h 动量', scorer: momentumScorer, threshold: momentumThreshold },
    { name: '定期买入', scorer: alwaysScorer, threshold: 0 },
  ];
  const prepared = Object.entries(barsBySymbol).map(([symbol, bars]) => [symbol, prepareBars(bars)] as const);
  const signalsByStrategy = strategies.map(() => [] as { symbol: string; t: number }[]);
  const totalScans = strategies.length * prepared.length;
  ctx.progress('backtest', 0, totalScans);
  let scanned = 0;
  for (const [k, strategy] of strategies.entries()) {
    for (const [symbol, bars] of prepared) {
      await tick();
      checkAbort(ctx.signal);
      for (const sig of scanSymbol(bars, { fromMs, toMs, threshold: strategy.threshold, scorer: strategy.scorer, cooldownMs: OUTCOME_HORIZON_MS })) {
        signalsByStrategy[k].push({ symbol, t: sig.t });
      }
      ctx.progress('backtest', ++scanned, totalScans);
    }
  }
  const barsMap = new Map(prepared);
  const scenarios: NonNullable<BacktestResult['scenarios']> = SLIPPAGE_SCENARIOS.map(slippage => ({
    slippage,
    strategies: strategies.map((strategy, k) => {
      const trades: TradeResult[] = [];
      let skipped = 0;
      for (const sig of signalsByStrategy[k]) {
        const trade = simulateLongTrade(barsMap.get(sig.symbol)!, sig.t, { horizonMs: OUTCOME_HORIZON_MS }, {
          slippage, funding: fundingBySymbol[sig.symbol] ?? null,
        });
        if (trade) trades.push(trade); else skipped++;
      }
      return { name: strategy.name, signals: signalsByStrategy[k].length, skipped, summary: summarizeTrades(trades) };
    }),
  }));
  // 结论按 5 个基点：模型平均净收益的 95% 区间下限 > 0，且平均净收益高于两条基线
  const main = scenarios.find(s => s.slippage === 0.0005)!.strategies;
  const m = main.find(s => s.name === '模型')!.summary;
  const beatsBaselines = main.filter(s => s.name !== '模型').every(s => !(s.summary.meanNet >= m.meanNet));
  const verdict: Verdict = m.n > 0 && m.meanNetCi95[0] > 0 && beatsBaselines ? '已验证' : '检验未获支持';
  return {
    skippedReason: null, representation: rep.name, halfLifeHours: h, threshold, momentumThreshold, fromMs, toMs,
    symbols, droppedSymbols, failedSymbols, fundingReal: Object.keys(fundingBySymbol).length, scenarios, verdict,
  };
}
