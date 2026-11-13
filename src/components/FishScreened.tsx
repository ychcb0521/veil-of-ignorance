import { useCallback, useMemo, useState } from 'react';
import { MoreHorizontal, Settings2 } from 'lucide-react';
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
  const [panel, setPanel] = useState<'menu' | 'settings' | null>(null);
  const focusSettings = useCallback((node: HTMLDivElement | null) => node?.focus({ preventScroll: true }), []);
  const automatic = state?.automaticScreening;
  const cda = state?.cdaTracking;
  const save = automatic?.saveSettings;
  const planLabel = automatic?.settings?.plans[0]?.label;
  const editing = panel === 'settings' && !!state && !!save;
  const screening = !!state?.preEntry?.automaticRunning && !automatic?.paused;
  const pending = automatic?.pending ?? 0;
  const screeningStatus = screening ? '筛选中' : automatic?.paused ? '已暂停' : pending ? `待筛选 ${pending} 条` : '空闲';
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
    <FishLibrary title="筛选鱼" level="nested" testId="fish-screened" signals={rows} showScreeningTime cdaAlerts={cda?.alerts} defaultOpen={false} headerAction={<>
        {(save || cda) && <Popover open={panel !== null} onOpenChange={open => setPanel(open ? 'menu' : null)}>
          <PopoverTrigger asChild><button type="button" aria-label="筛选鱼选项" title="筛选鱼选项"
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground">
            <MoreHorizontal aria-hidden className="h-4 w-4"/>
          </button></PopoverTrigger>
          <PopoverContent align="start" collisionPadding={12} aria-label={editing ? '筛选鱼条件设置' : '筛选鱼选项'}
            className={editing ? 'fish-condition-settings screening-settings-popover' : 'w-64 max-w-[calc(100vw-24px)] space-y-2 p-2 text-[11px]'}>
            {editing ? <div tabIndex={-1} ref={focusSettings} className="outline-none">
              <FishPreEntrySettings state={state} selectedCount={0} done={() => setPanel(null)} automatic={{settings: automatic?.settings, save}}/>
            </div> : <>
              {state && save && <button type="button" aria-label="筛选鱼条件设置" disabled={!state.ready || !state.preEntry?.ready}
                onClick={() => setPanel('settings')} className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-muted disabled:opacity-40">
                <Settings2 aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0"/>
                <span className="min-w-0">
                  <span className="block font-medium">条件设置</span>
                  <span className="block break-words text-muted-foreground">{planLabel ?? '沿用动态筛选'}</span>
                </span>
              </button>}
              {cda && <div className={save ? 'space-y-1.5 border-t px-2 pb-1 pt-2' : 'space-y-1.5 px-2 py-1'}>
                <p className="font-medium">即时交易 · 自动持仓</p>
                <p className="text-muted-foreground">筛选鱼入选后自动建立模拟持仓。CDA 原始值低于 −10 或 DBL-5 防守线（防守线-20261112）断裂，任一在 5 分钟收盘确认即卖出；也可在「仓位」手动卖出。</p>
                {cda.enabled && <p role="status">追踪中 {cda.active} 条{cda.awaitingMail > 0 && ' · 待发邮件 ' + cda.awaitingMail + ' 条'}</p>}
                {cda.error && <p role="alert" className="text-destructive">{cda.error}</p>}
              </div>}
            </>}
          </PopoverContent>
        </Popover>}
        {cda?.campaignIssue && <span role="status" className="text-[10px] text-destructive">{cda.campaignIssue}</span>}
        {(automatic || screening) && <span className="ml-1 inline-flex items-center gap-1.5 whitespace-nowrap text-[10px] text-muted-foreground">
          <span role="status">{screeningStatus}</span>
          {screening && <progress aria-label="筛选鱼进度" className="h-1 w-16 accent-primary"/>}
        </span>}
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
