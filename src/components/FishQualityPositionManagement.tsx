import { DEFAULT_QUALITY_POSITION_MANAGEMENT, validateQualityPositionManagement, type QualityPositionManagement } from '@/lib/fish/qualityPositionManagement';

export interface PositionManagementDraft { leverage: string; notional: string }

export function positionManagementDraft(settings: Pick<QualityPositionManagement, 'leverage' | 'notional'> = DEFAULT_QUALITY_POSITION_MANAGEMENT): PositionManagementDraft {
  return { leverage: String(settings.leverage), notional: String(settings.notional) };
}

export function parsePositionManagement(draft: PositionManagementDraft): QualityPositionManagement {
  const settings = { ...DEFAULT_QUALITY_POSITION_MANAGEMENT, leverage: Number(draft.leverage), notional: Number(draft.notional) };
  validateQualityPositionManagement(settings);
  return settings;
}

export function FishQualityPositionManagement({ draft, onChange, note }: {
  draft: PositionManagementDraft;
  onChange?: (draft: PositionManagementDraft) => void;
  note?: string;
}) {
  const margin = Number(draft.notional) / Number(draft.leverage);
  const field = 'block w-full min-w-0 rounded border bg-background px-2 py-1.5 font-mono tabular-nums';
  return <section className="space-y-2 rounded-lg border border-border/60 p-3 text-[11px]" aria-label="仓位管理">
    <h4 className="text-xs font-medium">仓位管理</h4>
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="space-y-1"><span>杠杆（倍）</span>
        <input className={field} type="number" min={1} step="any" value={draft.leverage} readOnly={!onChange}
          onChange={event => onChange?.({ ...draft, leverage: event.target.value })}/>
      </label>
      <label className="space-y-1"><span>名义仓位（USDT）</span>
        <input className={field} type="number" min={0} step="any" value={draft.notional} readOnly={!onChange}
          onChange={event => onChange?.({ ...draft, notional: event.target.value })}/>
      </label>
    </div>
    <p className="text-muted-foreground">首仓保证金 {Number.isFinite(margin) && margin > 0 ? +margin.toPrecision(12) + ' USDT' : '—'}</p>
    {note && <p className="text-muted-foreground">{note}</p>}
  </section>;
}
