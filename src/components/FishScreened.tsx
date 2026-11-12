import { useMemo, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { FishPreEntrySettings } from './FishPreEntrySettings';
import type { FishQualityState } from '@/hooks/useFishQuality';
import { FishLibrary } from './FishLibrary';
import { preEntrySignal, type PreEntryLibrary } from '@/lib/fish/preEntryMonitor';
import { qualitySignalTime } from '@/lib/fish/qualityAdmissionTime';
import type { QualitySourceRatings } from '@/lib/fish/qualitySourceRatings';
import { signalDedupKey, type TradeSignal } from '@/lib/signalLibrary';
import { formatUTC8 } from '@/lib/timeFormat';

const noDays = new Set<string>();

export function FishScreened({ state, library, ratings, onJump, canJump, onRate, jumpingSignalId, tradedDayIndex = noDays, campaignDayIndex = noDays }: {
  state?: FishQualityState;
  library: PreEntryLibrary;
  ratings?: QualitySourceRatings;
  onJump?: (source: TradeSignal) => void;
  canJump?: (source: TradeSignal) => boolean;
  onRate?: (source: TradeSignal, value: number) => void;
  jumpingSignalId?: string | null;
  tradedDayIndex?: Set<string>;
  campaignDayIndex?: Set<string>;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const automatic = state?.automaticScreening;
  const cda = state?.cdaTracking;
  const save = automatic?.saveSettings;
  const planLabel = automatic?.settings?.plans[0]?.label;
  const settings = state && save ? <div className="ml-2 flex min-w-0 items-center gap-1">
    <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
      <PopoverTrigger asChild><button type="button" aria-label="筛选鱼条件设置" disabled={!state.ready || !state.preEntry?.ready}
        className="inline-flex h-6 shrink-0 items-center gap-1 rounded px-1.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40">
        <Settings2 aria-hidden className="h-3 w-3"/>条件设置
      </button></PopoverTrigger>
      <PopoverContent align="start" collisionPadding={12} className="fish-condition-settings screening-settings-popover">
        <FishPreEntrySettings state={state} selectedCount={0} done={() => setSettingsOpen(false)} automatic={{settings: automatic?.settings, save}}/>
      </PopoverContent>
    </Popover>
    <span className="max-w-48 truncate text-[10px] text-muted-foreground" title={planLabel}>{planLabel ?? '沿用动态筛选'}</span>
  </div> : undefined;
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
  return <div className="ml-1 mt-1 border-l border-border/50 pl-2">
    <FishLibrary title="筛选鱼" level="nested" testId="fish-screened" signals={rows} showScreeningTime defaultOpen={false} headerAction={<>
        {settings}
        {cda && <Popover><PopoverTrigger asChild>
          <button type="button" className="inline-flex h-6 shrink-0 items-center gap-1 rounded px-1.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground">
            CDA 追踪{cda.enabled ? ' · ' + cda.active : ''}
          </button>
        </PopoverTrigger><PopoverContent align="start" className="w-64 space-y-2 text-[11px]">
          <label className="flex items-center gap-2"><input type="checkbox" checked={cda.enabled} onChange={event => cda.setEnabled(event.target.checked)}/>启用 CDA 追踪</label>
          <p className="text-muted-foreground">启用后新入选的鱼，每根 5 分钟 K 线收盘确认。CDA 原始值首次低于 -10 时发邮件。</p>
          {cda.enabled && <p role="status">追踪中 {cda.active} 条{cda.awaitingMail > 0 && ' · 待发邮件 ' + cda.awaitingMail + ' 条'}</p>}
          {cda.error && <p role="alert" className="text-destructive">{cda.error}</p>}
        </PopoverContent></Popover>}
      </>}
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
