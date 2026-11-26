import { expect, it } from 'vitest';
import type { Position, TradeRecord } from '@/types/trading';
import type { UsdtLiveCampaign } from '../usdtLiveCampaign';
import type { UsdtMirrorPosition } from '../usdtPositionMirror';
import { latestOpenHolding, latestSimulationClose } from '../latestScreenedReplaySymbol';

const older = { quantity: 2, openTime: 100 } as Position;
const newer = { quantity: 1, openedRealAt: 200 } as Position;

it('selects the most recently opened surviving simulation position, including legacy positions', () => {
  expect(latestOpenHolding({ OLD: [older], CURRENT: [newer], FLAT: [{ ...newer, quantity: 0, openedRealAt: 300 }] })?.symbol)
    .toBe('CURRENT');
  expect(latestOpenHolding({ LEGACY: [older] })?.symbol).toBe('LEGACY');
});

it('uses the exchange position snapshot even before its campaign arrives and honors an empty snapshot', () => {
  const stale = { symbol: 'STALEUSDT', openedAt: 300 } as UsdtLiveCampaign;
  const active = { symbol: 'LIVEUSDT', quantity: '1' } as UsdtMirrorPosition;
  expect(latestOpenHolding({}, [], [stale], [active])?.symbol).toBe('LIVEUSDT');
  expect(latestOpenHolding({}, [], [stale], [])).toBeUndefined();
});

it('uses the last close including liquidation, ignoring opens and funding records', () => {
  const closed = { symbol: 'OLDUSDT', action: 'CLOSE', closeTime: 200 } as TradeRecord;
  const liquidation = { ...closed, symbol: 'LASTUSDT', action: 'LIQUIDATION' as const, closeTime: 100, closedRealAt: 300 };
  expect(latestSimulationClose([liquidation, closed, { ...closed, action: 'OPEN', closeTime: 500 },
    { ...closed, action: 'FUNDING', closeTime: 600 }])?.symbol).toBe('LASTUSDT');
});
