import type { FishCdaTracking } from '@/hooks/useFishCdaTracking';
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

export function latestInstantReplaySymbol(
  archives: InstantReplayEntry | undefined,
  positions?: readonly InstantPositionInput[],
  admitted?: FishCdaTracking['admitted'],
  localSales?: FishCdaTracking['localSales'],
  live?: readonly UsdtLiveCampaign[],
): string | undefined {
  let latest = archives;
  for (const row of live ?? []) latest = laterInstantReplayEntry(latest, binanceReplayEntry(row.symbol, row.openedAt));
  for (const position of positions ?? []) latest = laterInstantReplayEntry(latest, screenedReplayEntry(position.source, position.buyAt));
  for (const { record } of admitted ?? []) {
    latest = laterInstantReplayEntry(latest, screenedReplayEntry(record.sample.source, record.matchedAt));
  }
  for (const { record } of localSales ?? []) {
    latest = laterInstantReplayEntry(latest, screenedReplayEntry(record.sample.source, record.matchedAt));
  }
  return latest?.symbol;
}
