import type { FishCdaTracking } from '@/hooks/useFishCdaTracking';
import { signalChartSymbol } from '@/lib/signalLibrary';
import type { InstantPositionInput } from './instantCampaign';

export function latestScreenedReplaySymbol(
  admitted?: FishCdaTracking['admitted'],
  sales?: FishCdaTracking['alerts'],
  positions?: readonly InstantPositionInput[],
): string | undefined {
  let latest: string | undefined;
  let latestAt = 0;
  const now = Date.now();
  const consider = (source: InstantPositionInput['source'], at: number, recordId: string) => {
    if (!Number.isFinite(at) || at <= latestAt || at > now || sales?.has(recordId)) return;
    const symbol = signalChartSymbol(source);
    if (!symbol) return;
    latestAt = at;
    latest = symbol;
  };
  // The saved open positions are available even before the screening library loads.
  for (const position of positions ?? []) consider(position.source, position.buyAt, position.recordId);
  for (const { record } of admitted ?? []) {
    if (record.matchedAt != null) consider(record.sample.source, record.matchedAt, record.id);
  }
  return latest;
}
