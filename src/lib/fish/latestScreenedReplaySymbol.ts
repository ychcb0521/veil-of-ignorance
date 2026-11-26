import type { Position, TradeRecord } from '@/types/trading';
import { isPositionOpen } from '@/lib/tradingSettlement';
import { usdtMirrorRevision, type UsdtMirrorPosition, type UsdtMirrorHistory } from './usdtPositionMirror';
import { signalChartSymbol } from '@/lib/signalLibrary';
import type { InstantPositionInput } from './instantCampaign';
import type { UsdtLiveCampaign } from './usdtLiveCampaign';

export type InstantReplayEntry = { symbol: string; at: number };

export function laterInstantReplayEntry(a?: InstantReplayEntry, b?: InstantReplayEntry): InstantReplayEntry | undefined {
  return b && (!a || b.at > a.at) ? b : a;
}

export function screenedReplayEntry(source?: InstantPositionInput['source'], at?: number): InstantReplayEntry | undefined {
  if (!source?.symbol || !Number.isSafeInteger(at) || at! <= 0 || at! > Date.now()) return;
  const symbol = signalChartSymbol(source);
  return symbol ? { symbol, at: at! } : undefined;
}

export function binanceReplayEntry(symbol?: string, at?: number): InstantReplayEntry | undefined {
  // Exchange timestamps can differ from the browser's clock.
  return symbol && /^[A-Z0-9_]+(?:USDT|USDC)$/.test(symbol) && Number.isSafeInteger(at) && at! > 0 ? { symbol, at: at! } : undefined;
}

export function latestOpenHolding(
  positionsMap: Record<string, Position[]>,
  instant?: readonly InstantPositionInput[],
  campaigns?: readonly UsdtLiveCampaign[],
  snapshotPositions?: readonly UsdtMirrorPosition[],
  histories?: ReadonlyMap<string, UsdtMirrorHistory>,
): InstantReplayEntry | undefined {
  let latest: InstantReplayEntry | undefined;
  for (const [symbol, positions] of Object.entries(positionsMap)) {
    for (const position of positions) {
      if (isPositionOpen(position)) {
        latest = laterInstantReplayEntry(latest, { symbol, at: position.openedRealAt ?? position.openTime ?? 0 });
      }
    }
  }
  for (const position of instant ?? []) {
    latest = laterInstantReplayEntry(latest, screenedReplayEntry(position.source, position.buyAt));
  }
  if (snapshotPositions) {
    for (const position of snapshotPositions) {
      if (!(Number(position.quantity) > 0)) continue;
      const campaign = campaigns?.find(row => row.symbol === position.symbol && row.positionSide === position.positionSide &&
        row.direction === position.direction && !row.closedAt);
      const openedAt = histories?.get(usdtMirrorRevision(position))?.openedAt ?? campaign?.openedAt;
      latest = laterInstantReplayEntry(latest, { symbol: position.symbol, at: openedAt ?? 0 });
    }
  } else {
    for (const campaign of campaigns ?? []) {
      if (!campaign.closedAt) latest = laterInstantReplayEntry(latest, binanceReplayEntry(campaign.symbol, campaign.openedAt));
    }
  }
  return latest;
}

export function latestSimulationClose(history: readonly TradeRecord[]): InstantReplayEntry | undefined {
  let latest: InstantReplayEntry | undefined;
  for (const record of history) {
    if (record.action !== 'CLOSE' && record.action !== 'LIQUIDATION') continue;
    const at = record.closedRealAt ?? record.closeTime;
    if (record.symbol && at > 0) latest = laterInstantReplayEntry(latest, { symbol: record.symbol, at });
  }
  return latest;
}
