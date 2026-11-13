import { expect, it, vi } from 'vitest';
import { computeCampaignRealizedPnl } from '@/lib/campaignRealizedPnl';
import { buildCampaignPricePathTask } from '@/hooks/useCampaignPricePaths';
import { buildCampaignCardData } from '@/lib/campaignListCache';
import { sortCampaignRows } from '@/lib/campaignListSort';
import { buildInstantCampaignData, buildOpenInstantCampaignData, freezeInstantCampaign, instantCampaignInput, instantPositionInput, instantPositionValuation } from '../instantCampaign';
import { readInstantPositionQuote } from '../instantPositionQuote';
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
  expect(frozen).toMatchObject({ version: 2, marginUsdt: 40, leverage: 5 });
  const data = buildInstantCampaignData('account-a', frozen);
  const { campaign, legs, tradeRecords } = data;
  expect(campaign).toMatchObject({
    user_id: 'account-a', opened_at: new Date(buyAt).toISOString(), closed_at: new Date(sellAt).toISOString(),
    initial_main_size_usdt: 200, initial_leverage: 5, final_realized_pnl: 20, status: 'closed_profit',
    comparison: { section: 'instant', holdingMetrics: { returnPct: 50 }, instant: { marginUsdt: 40, cdaValue: -10.5 } },
  });
  expect(tradeRecords[0]).toMatchObject({ entryPrice: 100, exitPrice: 110, quantity: 2, openTime: buyAt, closeTime: sellAt });
  expect(computeCampaignRealizedPnl(campaign, legs, tradeRecords, {}).total).toBe(20);
  expect(legs[0]).toMatchObject({ pre_account_equity_usdt: 40, pre_position_size: 200 });
  expect(campaign.notes).toContain('保证金 40 USDT · 5 倍杠杆 · 名义仓位 200 USDT');
  const frozenPath = buildCampaignPricePathTask(buildCampaignCardData(data)).frozen!;
  expect(frozenPath.peak).toBeCloseTo(20);
  expect(frozenPath.drawdown).toBeCloseTo(12.5);
  expect(frozenPath.staticDrawdown).toBeCloseTo(1);
  expect(qualityCampaignSheets(campaign)[0].rows).toContainEqual(['保证金 USDT', 40, '']);
  // A 643 snapshot had no sizing fields; reading it still produces its original dollars and return.
  const { marginUsdt: _margin, leverage: _leverage, ...execution } = frozen;
  const legacy = buildInstantCampaignData('account-a', { ...execution, version: 1 });
  expect(legacy.campaign).toMatchObject({ initial_main_size_usdt: 500, initial_leverage: 5, final_realized_pnl: 50,
    comparison: { holdingMetrics: { returnPct: 50 }, instant: { marginUsdt: 100 } } });
  expect(legacy.tradeRecords[0].quantity).toBe(5);
  const legacyCard={...buildCampaignCardData(legacy),arithmeticExpectancy:null,geometricExpectancy:null};
  expect(legacyCard.profitCaptureRatio).toBeNull();
  for (const direction of ['asc','desc'] as const) {
    expect(sortCampaignRows([legacyCard], [{mode:'captureRate',direction}])).toEqual([legacyCard]);
    const priced=Array.from({length:8},(_,i)=>({...legacyCard,profitCaptureRatio:i*100}));
    expect(sortCampaignRows([legacyCard,...priced],[{mode:'captureRate',direction},{mode:'time',direction:'desc'}]).at(-1)).toBe(legacyCard);
  }
  expect(qualityCampaignSheets(legacy.campaign)[0].rows).toContainEqual(['保证金 USDT', 100, '']);

  const current = await freezeInstantCampaign({ ...input, sell: { ...alert, closePrice: 90 } }, load, signal);
  expect(load).toHaveBeenCalledTimes(3);
  expect(buildInstantCampaignData('account-a', current).campaign).toMatchObject({ status: 'closed_loss', final_realized_pnl: -20 });
});

it('uses the remaining quantity and cost, and keeps the same campaign through the final sale', () => {
  const position = { ...instantPositionInput(record, round)!, entryPrice: 100, marginUsdt: 40, leverage: 5 };
  const mirror = { at: buyAt + minute, price: 102, fraction: .715, gainPct: 2, atOpen: false };
  const held = instantPositionValuation(position, undefined, mirror, 105);
  expect(held.remainingQuantity).toBeCloseTo(.57);
  expect(held.pnl).toBeCloseTo(2.85);
  expect(held.roe).toBeCloseTo(25);
  expect(held.realizedPnl).toBeCloseTo(2.86);
  const open = buildOpenInstantCampaignData('account-a', position, undefined, mirror, buyAt + 2 * minute);
  expect(open.campaign).toMatchObject({ id: position.id, status: 'active', closed_at: null, final_realized_pnl: null });
  expect(open.legs.find(leg => leg.leg_role === 'main_open')).toMatchObject({ post_simulated_close_time: null, pre_position_size: 57 });
  expect(open.tradeRecords).toHaveLength(1);
  expect(open.tradeRecords[0]).toMatchObject({ exitPrice: 102, closeTime: mirror.at });
  expect(open.campaign.actual_evolution.map(event => event.event_type)).not.toContain('main_fully_closed');
  expect(open.campaign.comparison?.instant?.openPosition?.quantity).toBeCloseTo(.57);
  const closed = buildInstantCampaignData('account-a', { ...position, version: 2, sell: { ...alert, mirror }, exitPrice: 105, recordedAt: sellAt,
    peakPct: 5, drawdown: 0, staticDrawdown: 0 });
  expect(closed.campaign.id).toBe(open.campaign.id);
  expect(closed.campaign.final_realized_pnl).toBeCloseTo(5.71);
  expect(closed.campaign.comparison?.instant?.openPosition).toBeUndefined();
});

it.each([
  ['binance', 'fapi.binance.com', { symbol: 'TESTUSDT', markPrice: '102', time: at }],
  ['okx', 'www.okx.com', { data: [{ instId: 'OTHER-USDT-SWAP', markPx: '1', ts: at }, { instId: 'TEST-USDT-SWAP', markPx: '102', ts: at }] }],
  ['bitget', 'api.bitget.com', { data: [{ symbol: 'TESTUSDT', markPrice: '102', ts: at }] }],
  ['gate', 'api.gateio.ws', [{ contract: 'TEST_USDT', mark_price: '102' }]],
] as const)('uses the %s contract mark and its timestamp', async (exchange, host, body) => {
  const request = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body)));
  const now = vi.spyOn(Date, 'now').mockReturnValue(at + 1000);
  try {
    expect(await readInstantPositionQuote({ ...source, exchange }, signal, request)).toEqual({
      price: 102, at: exchange === 'gate' ? at + 1000 : at, kind: 'mark',
    });
    expect(new URL(String(request.mock.calls[0][0])).hostname).toBe(host);
  } finally { now.mockRestore(); }
});

it('does not turn a missing buy candle into a priced campaign', async () => {
  await expect(freezeInstantCampaign(instantCampaignInput(record, round, alert)!, async () => [], signal)).rejects.toThrow('没有K线');
});
