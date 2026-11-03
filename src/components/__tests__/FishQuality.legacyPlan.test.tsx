/**
 * 【用户要求】2026-11-03 旧模板复原：在条件设置里打开旧引擎方案并保存，方案必须原样不动。
 * （11-03 用户从模板新建「算法组合3-0」后点了保存，新版加仓表单把 8 次加仓全改写成 DBL-5 箱体，RAVE 从 +10027.38 变成 +460.11。）
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FishQuality } from '@/components/FishQuality';
import { QualityMonitorSettingsButton } from '@/components/FishQualityMonitorSettingsView';
import { importQualityFish, newQualityStudy, qualityDisplayRows, type QualityGroup } from '@/lib/fish/quality';
import { enableQualityComparison } from '@/lib/fish/qualityComparison';
import { withLegacyEngine } from '@/lib/fish/qualityLegacyEngine';
import { planVersionChanges } from '@/lib/fish/qualityPlanVersions';
import { BSS_DEF, definitionKey } from '@/lib/deepDig/features';
import type { FishQualityState } from '@/hooks/useFishQuality';

afterEach(cleanup);
const T = Date.UTC(2026, 9, 20);
const original = (JSON.parse(gunzipSync(readFileSync(join(process.cwd(), 'src/lib/fish/legacy/__tests__/fixtures/rave-2026-04-09-combo2.json.gz'))).toString('utf8')) as { plan: QualityGroup }).plan;
const legacy = withLegacyEngine({ ...original, id: 'sell-legacy', label: '算法组合3-0（b=2005.48）' });
function state(): FishQualityState {
  const signals = [{ id: '0', symbol: 'AAAUSDT', timeMs: T, timeLabel: '', fallbackZone: '', fish: { featureId: 'bss', featureShort: 'BSS', definitionKey: definitionKey(BSS_DEF), statistic: 'BSS', cutoffMs: T, threshold: 1, average: 4, cbi2: 4, startAverage: 4, previousAverage: 0, direction: '>' as const, scale: 1 } }];
  const study = enableQualityComparison(importQualityFish(newQualityStudy(T + 1), signals));
  study.selectedRowIds = qualityDisplayRows(study).map(r => r.id);
  study.sellPlans = [structuredClone(legacy), ...study.sellPlans!];
  return { study, ready: true, running: false, progress: null, filterRunning: false, filterProgress: null, filterError: '', startFilter: vi.fn(), cancelFilter: vi.fn(), warning: '', error: '', start: vi.fn(), restart: vi.fn(), cancel: vi.fn(), setRule: vi.fn(), setCombo: vi.fn(), setObserveHours: vi.fn(), selectSell: vi.fn(), setSelectedRows: vi.fn(), setPriority: vi.fn(), setScope: vi.fn(), setFilters: vi.fn(), setHoldingVetoes: vi.fn(), setSellPlans: vi.fn() };
}
const savedLegacy = (s: FishQualityState) => (vi.mocked(s.setSellPlans).mock.calls.at(-1)![0] as QualityGroup[]).find(p => p.id === legacy.id)!;
const params = ({ label: _l, ...rest }: QualityGroup) => rest;

it('旧引擎方案在条件设置里只读，按 10-31 原始参数显示；保存时原样不动', () => {
  const s = state(); render(<FishQuality state={s}/>);
  fireEvent.click(screen.getByRole('button', { name: '持仓监测条件' }));
  expect(screen.getByTestId('sell-plan-legacy-0')).toHaveTextContent('2026-10-31 旧引擎 · 只读');
  expect(screen.getByLabelText('卖出算法 1 类型')).toBeDisabled();
  expect(screen.getByLabelText('卖出算法 1 门槛')).toBeDisabled();
  const view = screen.getByTestId('quality-monitor-legacy');
  expect(within(view).getByTestId('quality-legacy-engine-note')).toBeInTheDocument();
  expect(within(view).queryByTestId('quality-monitor-editor')).toBeNull();
  expect(within(view).getByTestId('quality-legacy-round-1')).toHaveTextContent('状态 S 原始值 > 0.7T ≥ S＋2 ATRK＝T−1.5 ATR相对持仓均价 ≥ 10%');
  expect(within(view).getByTestId('quality-legacy-round-8')).toHaveTextContent('状态 S 原始值 > 0.9T ≥ S＋3.5 ATRK＝T−2.5 ATR');
  fireEvent.click(within(view).getByRole('button', { name: /^保存全部 \d+ 套方案$/ }));
  const saved = savedLegacy(s);
  expect(saved).toEqual(legacy);
  expect(planVersionChanges(saved)).toEqual([]);
});

it('可以改名称，其余参数（含 8 次加仓的入场距离）不变；改另一套普通方案也不碰它', () => {
  const s = state(); render(<FishQuality state={s}/>);
  fireEvent.click(screen.getByRole('button', { name: '持仓监测条件' }));
  fireEvent.change(screen.getByLabelText('卖出算法 1 名称'), { target: { value: 'RAVE 复原' } });
  fireEvent.click(screen.getByRole('tab', { name: /状态 S 原始值/ }));
  fireEvent.click(screen.getByRole('button', { name: /^保存全部 \d+ 套方案$/ }));
  const saved = savedLegacy(s);
  expect(saved.label).toBe('RAVE 复原');
  expect(params(saved)).toEqual(params(legacy));
  expect(saved.addition!.rounds!.map(r => [r.source, r.entryBufferAtr, r.supportOffsetAtr])).toEqual(original.addition!.rounds!.map(r => ['custom', r.entryBufferAtr, r.supportOffsetAtr]));
});

it('交易战役里的「持仓监测」：10-31 的方案（没有旧引擎标记）也按原始参数显示，不换算成箱体', () => {
  render(<QualityMonitorSettingsButton plan={original}/>);
  fireEvent.click(screen.getByRole('button', { name: '查看持仓监测设置' }));
  expect(screen.getByTestId('quality-legacy-engine-note')).toBeInTheDocument();
  expect(screen.getByTestId('quality-legacy-round-6')).toHaveTextContent('T ≥ S＋3 ATRK＝T−2 ATR相对持仓均价 ≥ 15%');
});
