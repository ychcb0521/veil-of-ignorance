import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FishQuality } from '@/components/FishQuality';
import { importQualityFish, newQualityStudy } from '@/lib/fish/quality';
import { BSS_DEF, definitionKey } from '@/lib/deepDig/features';
import type { FishQualityState } from '@/hooks/useFishQuality';
const T = Date.UTC(2026, 9, 20);
function state(): FishQualityState {
  const study = importQualityFish(newQualityStudy(), [{ id: 'a', symbol: 'AAAUSDT', timeMs: T, timeLabel: '', fallbackZone: '', fish: { featureId: 'bss', featureShort: 'BSS', definitionKey: definitionKey({ ...BSS_DEF, formula: 'BSS = C\navg_BSS = avg(BSS, 1)\navg_BSS_2 = avg_BSS' }), statistic: '结果', cutoffMs: T, threshold: .12, average: .2, cbi2: .2, startAverage: .2, previousAverage: .1, direction: '>', scale: 1 } }]);
  return { study, ready: true, running: false, progress: null, warning: '', error: '', start: vi.fn(), cancel: vi.fn(), setRule: vi.fn(), setObserveHours: vi.fn(), setTracking: vi.fn() };
}
afterEach(cleanup);
it('shows the third collapsible module, simple group statistics and an unset exit until the user applies an editable suggestion', () => {
  const s = state(); render(<FishQuality state={s}/>);
  expect(screen.getByText('平均收益率')).toBeVisible(); expect(screen.getByText(/尚未选择/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /缓冲 50%/ }));
  expect(screen.getByLabelText('卖出门槛')).toHaveValue(.06); expect(s.setRule).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('卖出指标'), { target: { value: 'BSS' } });
  fireEvent.change(screen.getByLabelText('卖出门槛'), { target: { value: '.04' } });
  fireEvent.click(screen.getByRole('button', { name: '应用并重算' }));
  expect(s.setRule).toHaveBeenCalledWith(s.study.groups[0].id, { metric: 'BSS', direction: '<', threshold: .04 });
  fireEvent.click(screen.getByRole('button', { name: /^鱼质量/ })); expect(screen.queryByLabelText('卖出指标')).toBeNull();
  expect(s.study.samples).toHaveLength(1);
});
it('validates the observation horizon and exposes manual update, automatic tracking and incomplete-data semantics', () => {
  const s = state(); render(<FishQuality state={s}/>);
  fireEvent.change(screen.getByLabelText('鱼质量观察小时'), { target: { value: '-1' } }); fireEvent.blur(screen.getByLabelText('鱼质量观察小时'));
  expect(s.setObserveHours).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toHaveTextContent('8784');
  fireEvent.change(screen.getByLabelText('鱼质量观察小时'), { target: { value: '72' } }); fireEvent.blur(screen.getByLabelText('鱼质量观察小时'));
  expect(s.setObserveHours).toHaveBeenCalledWith(72);
  fireEvent.click(screen.getByRole('button', { name: '更新收益' })); expect(s.start).toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText('自动跟踪新鱼及更新收益')); expect(s.setTracking).toHaveBeenCalledWith(false);
  expect(screen.getByText(/选择卖出规则后评估收益/)).toHaveTextContent('不合计为账户收益');
});
