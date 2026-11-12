import { useMemo } from 'react';
import { FishLibrary } from './FishLibrary';
import { preEntrySignal, type PreEntryLibrary } from '@/lib/fish/preEntryMonitor';
import { qualitySignalTime } from '@/lib/fish/qualityAdmissionTime';
import type { QualitySourceRatings } from '@/lib/fish/qualitySourceRatings';
import { signalDedupKey, type TradeSignal } from '@/lib/signalLibrary';
import { formatUTC8 } from '@/lib/timeFormat';

const noDays = new Set<string>();

export function FishScreened({ library, ratings, onJump, canJump, onRate, jumpingSignalId, tradedDayIndex = noDays, campaignDayIndex = noDays }: {
  library: PreEntryLibrary;
  ratings?: QualitySourceRatings;
  onJump?: (source: TradeSignal) => void;
  canJump?: (source: TradeSignal) => boolean;
  onRate?: (source: TradeSignal, value: number) => void;
  jumpingSignalId?: string | null;
  tradedDayIndex?: Set<string>;
  campaignDayIndex?: Set<string>;
}) {
  const rows = useMemo(() => {
    const automatic = new Set(library.rounds.filter(round => round.automatic).map(round => round.id));
    return library.records.flatMap(record => {
      if (!automatic.has(record.roundId)) return [];
      const admitted = preEntrySignal(record);
      if (!admitted) return [];
      const source = record.sample.source, timeMs = qualitySignalTime(source);
      const rating = ratings?.[signalDedupKey({...source, timeMs})];
      return [{
        ...source, id: admitted.id, timeMs, timeLabel: formatUTC8(timeMs), jumpIssue: undefined,
        preEntryMonitor: admitted.preEntryMonitor, quality: rating ? rating.quality ?? undefined : source.quality,
      }];
    });
  }, [library.rounds, library.records, ratings]);
  const byId = useMemo(() => new Map(rows.map(row => [row.id, row])), [rows]);
  return <div className="mt-2 border-l border-border/50 pl-3">
    <FishLibrary title="筛选鱼" level="sub" testId="fish-screened" signals={rows} showScreeningTime defaultOpen={false}
      emptyText="还没有自动筛选入选的鱼。" tradedDayIndex={tradedDayIndex} campaignDayIndex={campaignDayIndex} jumpingSignalId={jumpingSignalId ?? null}
      onJump={id => {
        const row = byId.get(id), at = row?.preEntryMonitor?.matchedAt;
        if (!row || !at) return;
        const source = {...row, timeMs: at, timeLabel: formatUTC8(at)};
        if (!canJump || canJump(source)) onJump?.(source);
      }}
      onRate={(id, value) => {
        const row = byId.get(id);
        if (row) onRate?.(row, value);
      }}/>
  </div>;
}
