import { expect, it } from 'vitest';
import { newQualityStudy } from '@/lib/fish/quality';
import { enableQualityComparison } from '@/lib/fish/qualityComparison';
import { buildMonitorSheets, monitorAlgorithmKey, monitorValue, sortMonitorRecords } from '@/lib/fish/qualityMonitorTable';
import type { QualityMonitorRecord, QualityMonitorSetting } from '@/lib/fish/qualityMonitorLibrary';
const T = Date.UTC(2026, 9, 27);
const plan = enableQualityComparison(newQualityStudy(T)).sellPlans![0];
const setting: QualityMonitorSetting = { id: 's', signature: 'frozen', plan: { ...plan, rule: { metric: plan.metric, direction: '<', threshold: .5 } }, detectors: [], filtersKnown: true, detectorsKnown: true, observeHours: 0, entryMode: 'capture', notional: 100, leverage: 1 };
const settings = new Map([['s', setting]]);
function row(id: string, pct?: number): QualityMonitorRecord {
  return { id, settingId: 's', source: { id, symbol: `${id}USDT`, timeMs: T, timeLabel: '', fallbackZone: '' }, enteredAt: T, basis: 'capture', filterStatus: { state: 'none', detail: '' }, readings: [], firstSavedAt: T, updatedAt: T,
    result: { key: id, sampleId: id, groupId: plan.id, status: 'closed', evaluatedAt: T, returnPct: pct, pnl: pct, adversePct: pct == null ? undefined : -Math.abs(pct), drawdownPct: pct == null ? undefined : Math.abs(pct), heldHours: pct == null ? undefined : 0 } };
}
it('sorts numerical outcomes and durations, keeps missing values last in both directions, and does not mutate records', () => {
  const rows = [row('two', 2), row('missing'), row('ten', 10), row('zero', 0)];
  expect(sortMonitorRecords(rows, settings, 'return', true).map(r => r.id)).toEqual(['zero', 'two', 'ten', 'missing']);
  expect(sortMonitorRecords(rows, settings, 'return', false).map(r => r.id)).toEqual(['ten', 'two', 'zero', 'missing']);
  expect(sortMonitorRecords(rows, settings, 'held', false).at(-1)?.id).toBe('missing');
  expect(rows[0].id).toBe('two');
});
it('hides unbought and waiting outcomes consistently in sorting and export without losing their frozen conditions', () => {
  const unbought = { ...row('failed', 90), filterStatus: { state: 'fail' as const, detail: '未满足 > 0.7' } }, waiting = { ...row('waiting', 50), result: { ...row('waiting', 50).result!, status: 'waiting' as const } };
  for (const r of [unbought, waiting]) for (const key of ['return', 'static', 'dynamic', 'held'] as const) expect(monitorValue(r, setting, key)).toBeNull();
  const sheets = buildMonitorSheets([unbought, row('zero', 0), waiting], settings);
  const headers = sheets[0].columns.map(c => c.header), failed = sheets[0].rows[0], zero = sheets[0].rows[1];
  expect(failed[headers.indexOf('收益率 %')]).toBeNull(); expect(failed[headers.indexOf('盈亏 USDT')]).toBeNull();
  expect(failed[headers.indexOf('结果')]).toBe('未买入'); expect(failed[headers.indexOf('过滤判断')]).toBe('未满足 > 0.7');
  expect(sheets[0].rows[2][headers.indexOf('盈亏 USDT')]).toBeNull();
  expect(zero[headers.indexOf('收益率 %')]).toBe(0); expect(zero[headers.indexOf('持仓时间 小时')]).toBe(0);
});
it('exports every supplied page in order and only its frozen algorithms, formula snapshots and readings', () => {
  const rows = Array.from({ length: 61 }, (_, i) => ({ ...row(String(i), i), readings: [{ key: 'original', value: .9, at: T }] }));
  const extra = { ...setting, id: 'unused' }, map = new Map([...settings, ['unused', extra] as const]);
  const sheets = buildMonitorSheets(rows, map);
  expect(sheets[0].rows).toHaveLength(61); expect(sheets[0].rows[60][0]).toBe('60USDT');
  expect(sheets[1].rows).toHaveLength(1); expect(sheets[1].rows[0][1]).toContain('< 0.5');
  expect(sheets[1].rows[0].at(-1)).toBe(JSON.stringify(setting.plan.snapshot));
  expect(sheets[0].rows[0][sheets[0].columns.findIndex(c => c.header === '过滤读数 JSON')]).toContain('original');
});
it('keeps same-name algorithms with different thresholds or formula versions distinguishable', () => {
  expect(monitorAlgorithmKey(setting)).not.toBe(monitorAlgorithmKey({ ...setting, plan: { ...setting.plan, rule: { ...setting.plan.rule!, threshold: .4 } } }));
  expect(monitorAlgorithmKey(setting)).not.toBe(monitorAlgorithmKey({ ...setting, plan: { ...setting.plan, snapshot: { ...setting.plan.snapshot, definitionKey: 'different frozen formula' } } }));
});
