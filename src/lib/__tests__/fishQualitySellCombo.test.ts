// 【用户要求】2026-10-27「卖出算法组合1」：前半段用 CDA，价格涨幅超过 5.1% 之后用状态 S
import { expect, it } from 'vitest';
import { CDA_DEF, definitionKey, STATE_DEF } from '@/lib/deepDig/features';
import { evaluateQualitySample, importQualityLibrary, newQualityStudy, qualityResultKey, qualityRuleText, type QualityGroup, type QualitySample } from '@/lib/fish/quality';
import { enableQualityComparison, ensureQualitySellCombo, QUALITY_SELL_COMBO_ID, syncQualitySellDefinitions } from '@/lib/fish/qualityComparison';
import { qualityRuleLabel, qualitySellKey } from '@/lib/fish/qualityCampaignArchive';
import { qualitySellType } from '@/lib/fish/qualityStatistics';
import { makeQualityHoldingVeto } from '@/lib/fish/qualityFilters';
import type { ResearchBar } from '@/lib/deepRsa/window';
import type { FishReconstructionLoader } from '@/lib/fish/reconstruction';

const M = 60_000, T = Date.UTC(2026, 9, 20), signal = () => new AbortController().signal;
const sample: QualitySample = { id: 'a', enteredAt: T, basis: 'signal', importedAt: T, groups: [], source: { id: 'a', symbol: 'AAAUSDT', timeMs: T, timeLabel: '', fallbackZone: '' } };
// 读数 = 收盘价：前段「价格 < 95」、后段「价格 < 104」，分水岭 5.1%（买入价 100 → 最高价 ≥ 105.1）
const def = { id: 'custom', name: '自定义价格', short: '价格', definition: '', formula: 'raw = C', scale: 1, unit: '', positive: '1', control: '0', interval: '5m' as const };
const snapshot = { featureId: 'custom', definitionKey: definitionKey(def), statistic: 'raw', interval: '5m', scale: 1, threshold: 0, direction: '<' as const, average: 0, cbi2: 0, startAverage: 0, previousAverage: 0, cutoffMs: 0 };
const combo = (switchPct = 5.1): QualityGroup => ({ id: QUALITY_SELL_COMBO_ID, label: '卖出算法组合1', metric: 'raw', execution: 'intrabar-1m', snapshot, rule: { metric: 'raw', direction: '<', threshold: 95 },
  combo: { switchPct, beforeLabel: '价格前段', after: { label: '价格后段', metric: 'raw', snapshot, rule: { metric: 'raw', direction: '<', threshold: 104 } } } });
const bar = (t: number, open = 100, high = open, low = open, close = open): ResearchBar => ({ openTime: t, open, high, low, close, volume: 1, quoteVolume: 100, takerBuyVolume: .5, takerBuyQuoteVolume: 50 });
const loader = (f: (t: number) => ResearchBar): FishReconstructionLoader => async (_r, a, b, p) => Array.from({ length: (b - a) / p.step }, (_, i) => p.step === M ? f(a + i * M) : bar(a + i * p.step));
const run = (g: QualityGroup, l: FishReconstructionLoader, now = T + 10 * M, prior?: Awaited<ReturnType<typeof evaluateQualitySample>>) => evaluateQualitySample(sample, g, 0, now, l, signal(), prior);
// 第 1 分钟收在 103（已低于后段 104，但没过分水岭不能卖）；第 2 分钟最高 106 收 106（过分水岭）；第 3 分钟收 103.5 → 后段达标；第 4 分钟开盘 103 卖出
const path = (t: number) => t === T ? bar(t, 100) : t === T + M ? bar(t, 101, 103, 101, 103) : t === T + 2 * M ? bar(t, 103, 106, 103, 106) : t === T + 3 * M ? bar(t, 106, 106, 103.5, 103.5) : bar(t, 103);

it('uses only the first-phase rule until the high clears the switch point, then only the second-phase rule', async () => {
  const result = await run(combo(), loader(path));
  expect(result).toMatchObject({ status: 'closed', endTime: T + 4 * M, endPrice: 103, exitSnapshot: { stage: 'after' } });
  expect(result.reason).toContain('涨幅已达 5.1%');
  // 分水岭定得更高（10%）就一直停在前段：价格没跌破 95，不卖
  const held = await run(combo(10), loader(path));
  expect(held.status).toBe('open');
});

it('sells on the first-phase rule when the price falls before reaching the switch point', async () => {
  const result = await run(combo(), loader(t => t === T ? bar(t, 100) : t === T + M ? bar(t, 100, 104, 94, 94) : bar(t, 93)));
  expect(result).toMatchObject({ status: 'closed', endTime: T + 2 * M, endPrice: 93, exitSnapshot: { stage: 'before' } });
  expect(result.reason).toContain('涨幅未达 5.1%');
  expect(qualitySellType(result, combo())).toBe('组合前段（价格前段）卖出');
});

it('resumes an open position on the second phase when its recorded peak already passed the switch point', async () => {
  const prior = { key: qualityResultKey(sample, combo(), 0), sampleId: 'a', groupId: QUALITY_SELL_COMBO_ID, evaluatedAt: T + 3 * M, status: 'open' as const,
    entryTime: T, entryPrice: 100, endTime: T + 3 * M, endPrice: 105, returnPct: 5, peakPct: 6, adversePct: 0, drawdownPct: 1 };
  const result = await run(combo(), loader(t => t < T + 3 * M ? bar(t, 105) : t === T + 3 * M ? bar(t, 105, 105, 103, 103) : bar(t, 102)), T + 10 * M, prior);
  expect(result).toMatchObject({ status: 'closed', endTime: T + 4 * M, endPrice: 102, exitSnapshot: { stage: 'after' } });
});

it('keeps holding vetoes active in both phases', async () => {
  const g = { ...combo(), vetoFill: 'stop' as const, holdingVetoes: [makeQualityHoldingVeto('static-drawdown', '>=', 3)] };
  const result = await run(g, loader(t => t === T ? bar(t, 100) : bar(t, 100, 100, 96, 99)));
  expect(result).toMatchObject({ status: 'closed', endPrice: 97, exitSnapshot: { cause: { kind: 'static-drawdown' } } });
});

it('gives the combo its own result identity and readable labels', () => {
  const plain = { ...combo(), combo: undefined };
  expect(qualityResultKey(sample, combo(), 0)).not.toBe(qualityResultKey(sample, plain, 0));
  expect(qualityResultKey(sample, combo(5.1), 0)).not.toBe(qualityResultKey(sample, combo(6), 0));
  expect(qualitySellKey(combo())).not.toBe(qualitySellKey(plain));
  expect(qualityRuleText(combo())).toBe('价格前段 < 95 → 涨 5.1% 后 价格后段 < 104');
  expect(qualityRuleLabel(combo())).toContain('卖出算法组合1 价格前段 < 95 → 涨 5.1% 后');
});

it('adds 卖出算法组合1 once to existing studies, copying the CDA and S thresholds and the CDA plan conditions, and syncs both formulas', () => {
  const study = enableQualityComparison(importQualityLibrary(newQualityStudy(T), [sample.source]), [STATE_DEF, CDA_DEF]);
  // 新研究：CDA 还没设门槛 → 组合先不启用（显示「设置门槛」）
  const fresh = ensureQualitySellCombo(study).sellPlans!;
  expect(fresh.map(p => p.id)).toEqual(['sell-state-raw', 'sell-cda-raw', QUALITY_SELL_COMBO_ID]);
  expect(fresh[2].rule).toBeUndefined(); expect(qualityRuleText(fresh[2])).toBe('设置门槛');
  // 已有账号：只有两套方案、各自设过门槛与条件
  const veto = makeQualityHoldingVeto('static-drawdown', '>=', 5);
  const legacy = { ...study, sellPlans: study.sellPlans!.map(p => ({ ...p, rule: { metric: p.metric, direction: '<' as const, threshold: p.metric === 'state' ? .5 : .3 }, holdingVetoes: p.metric === 'CDA' ? [veto] : [] })) };
  const added = ensureQualitySellCombo(legacy), c = added.sellPlans!.find(p => p.id === QUALITY_SELL_COMBO_ID)!;
  expect(c).toMatchObject({ label: '卖出算法组合1', metric: 'CDA', rule: { direction: '<', threshold: .3 }, combo: { switchPct: 5.1, beforeLabel: 'CDA', after: { label: '状态 S', metric: 'state', rule: { threshold: .5 } } } });
  expect(c.holdingVetoes).toEqual([veto]);
  expect(c.snapshot.featureId).toBe('cda'); expect(c.combo!.after.snapshot.featureId).toBe('state');
  expect(ensureQualitySellCombo(added)).toBe(added);
  // 账号公式改了：两段快照都跟上
  const edited = { ...STATE_DEF, formula: `${STATE_DEF.formula}\n# edited` };
  const synced = syncQualitySellDefinitions(added, [edited, CDA_DEF]).sellPlans!.find(p => p.id === QUALITY_SELL_COMBO_ID)!;
  expect(synced.combo!.after.snapshot.definitionKey).toBe(definitionKey({ ...edited, interval: '5m' }));
});
