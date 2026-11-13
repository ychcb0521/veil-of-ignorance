import { expect, it, vi } from 'vitest';
import { computeCampaignRealizedPnl } from '@/lib/campaignRealizedPnl';
import { buildCampaignPricePathTask } from '@/hooks/useCampaignPricePaths';
import { buildCampaignCardData } from '@/lib/campaignListCache';
import { buildInstantCampaignData, freezeInstantCampaign, instantCampaignInput } from '../instantCampaign';
import { qualityCampaignSheets } from '../qualityCampaignExport';
import type { PreEntryRecord, PreEntryRound } from '../preEntryMonitor';
import type { FishReconstructionLoader } from '../reconstruction';

const at = Date.UTC(2026, 10, 13, 1, 20);
const minute = 60_000, buyAt = at + minute, sellAt = at + 5 * minute;
const source = { id: 'signal', symbol: 'TESTUSDT', timeMs: at, timeLabel: '', fallbackZone: '', exchange: 'okx' as const };
const record: PreEntryRecord = {
  id: 'automatic:0:plan', roundId: 'automatic', status: 'matched', matchedAt: buyAt, startTime: at, cursor: buyAt, updatedAt: buyAt,
  readings: [], sample: { id: 'sample', source, basis: 'signal', groups: [], enteredAt: at, importedAt: at },
};
const round: PreEntryRound = { id: record.roundId, startedAt: at, updatedAt: buyAt, filters: [], hours: 1, state: 'complete', automatic: true };
const alert = { at: sellAt, value: -10.5 };
const signal = new AbortController().signal;

it('builds one frozen 5× simulated trade from the two saved times, prices and CDA evidence', async () => {
  const input = instantCampaignInput(record, round, alert)!;
  expect(instantCampaignInput(record, round, { ...alert, value: -10 })).toBeUndefined();
  expect(instantCampaignInput(record, { ...round, automatic: false }, alert)).toBeUndefined();
  expect(instantCampaignInput(record, round, { ...alert, at })).toBeUndefined();
  expect(instantCampaignInput({ ...record, updatedAt: sellAt + minute }, round, alert)?.id).toBe(input.id);

  const load: FishReconstructionLoader = vi.fn(async (row, from, cut, plan) => {
    expect(row.exchange).toBe('okx');
    expect(row.timeMs).toBe(sellAt);
    expect(cut).toBe(sellAt);
    const prices = [[100, 120, 99, 110], [110, 112, 105, 107], [107, 115, 106, 113], [113, 116, 110, 111]];
    return Array.from({ length: (cut - from) / plan.step }, (_, i) => {
      const [open, high, low, close] = plan.step === minute ? prices[i] : [101, 120, 99, 110];
      return { openTime: from + i * plan.step, open, high, low, close, volume: 1, takerBuyVolume: null };
    });
  });
  const frozen = await freezeInstantCampaign(input, load, signal);
  expect(load).toHaveBeenCalledTimes(2); // legacy trigger has no saved close price
  const data = buildInstantCampaignData('account-a', frozen);
  const { campaign, legs, tradeRecords } = data;
  expect(campaign).toMatchObject({
    user_id: 'account-a', opened_at: new Date(buyAt).toISOString(), closed_at: new Date(sellAt).toISOString(),
    initial_main_size_usdt: 500, initial_leverage: 5, final_realized_pnl: 50, status: 'closed_profit',
    comparison: { section: 'instant', holdingMetrics: { returnPct: 50 }, instant: { marginUsdt: 100, cdaValue: -10.5 } },
  });
  expect(tradeRecords[0]).toMatchObject({ entryPrice: 100, exitPrice: 110, quantity: 5, openTime: buyAt, closeTime: sellAt });
  expect(computeCampaignRealizedPnl(campaign, legs, tradeRecords, {}).total).toBe(50);
  const frozenPath = buildCampaignPricePathTask(buildCampaignCardData(data)).frozen!;
  expect(frozenPath.peak).toBeCloseTo(20);
  expect(frozenPath.drawdown).toBeCloseTo(12.5);
  expect(frozenPath.staticDrawdown).toBeCloseTo(1);
  expect(qualityCampaignSheets(campaign)[0].rows).toContainEqual(['保证金 USDT', 100, '']);
  const current = await freezeInstantCampaign({ ...input, sell: { ...alert, closePrice: 90 } }, load, signal);
  expect(load).toHaveBeenCalledTimes(3);
  expect(buildInstantCampaignData('account-a', current).campaign).toMatchObject({ status: 'closed_loss', final_realized_pnl: -50 });
});

it('does not turn a missing buy candle into a priced campaign', async () => {
  await expect(freezeInstantCampaign(instantCampaignInput(record, round, alert)!, async () => [], signal)).rejects.toThrow('没有K线');
});
