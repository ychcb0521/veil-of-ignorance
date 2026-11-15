import {DBL5_GUARD_PLUS_PARAMS, IMPULSE_1115_POSITION_LABEL} from '@/lib/dbl5GuardPlus';

export interface Impulse1115Draft {
  minDistancePct: string;
  skipNative?: true;
}
export interface Impulse5mDraft extends Impulse1115Draft {
  bufferAtr: string;
}

export function FishQualityImpulsePositions({impulse, impulse1115, legacy1115, disabled, inputClass, change}: {
  impulse?: Impulse5mDraft;
  impulse1115?: Impulse1115Draft;
  legacy1115: boolean;
  disabled: boolean;
  inputClass: string;
  change: (impulse?: Impulse5mDraft, impulse1115?: Impulse1115Draft) => void;
}) {
  const p=DBL5_GUARD_PLUS_PARAMS;
  const lock=disabled||legacy1115;
  return <div className="grid gap-2 sm:grid-cols-2" data-testid="addition-impulse-positions">
    {legacy1115&&<p className="text-muted-foreground sm:col-span-2">当前使用 1115 组合位置。切回「仅使用所选箱体防守线」后即可勾选独立急拉线。</p>}
    <fieldset className="min-w-0 space-y-2 rounded border border-border/60 p-2" disabled={lock}>
      <label className="inline-flex items-center gap-2 font-medium">
        <input type="checkbox" checked={!!impulse} onChange={e=>change(e.target.checked?{bufferAtr:'0',minDistancePct:''}:undefined,impulse1115)}/>
        5 分钟急拉线
      </label>
      {impulse&&<>
        <p className="text-muted-foreground">币安 U 本位 · 5 分钟收盘确认量价突破</p>
        <label className="flex flex-wrap items-center gap-1">K 取起涨低点 −
          <input aria-label="急拉线冗余 ATR" className={inputClass} type="number" min="0" max="20" step="any" value={impulse.bufferAtr}
            onChange={e=>change({...impulse,bufferAtr:e.target.value},impulse1115)}/>× ATR
        </label>
        <label className="flex flex-wrap items-center gap-1">K 离加仓价 ≥
          <input aria-label="急拉线 K 最小距离" className={inputClass} type="number" min="0" max="50" step="any" placeholder="不限" value={impulse.minDistancePct}
            onChange={e=>change({...impulse,minDistancePct:e.target.value},impulse1115)}/>%
        </label>
      </>}
    </fieldset>
    <fieldset className="min-w-0 space-y-2 rounded border border-border/60 p-2" disabled={lock}>
      <label className="inline-flex items-center gap-2 font-medium">
        <input type="checkbox" checked={!!impulse1115} onChange={e=>change(impulse,e.target.checked?{minDistancePct:''}:undefined)}/>
        {IMPULSE_1115_POSITION_LABEL}
      </label>
      {impulse1115&&<>
        <p className="text-muted-foreground">两根紧凑整理后，观察 {p.windowBars} 根以内的首次急拉和收盘突破。K 取急拉参考，已含 {p.bufferAtr} 倍前置 ATR 冗余。</p>
        <label className="flex flex-wrap items-center gap-1">K 离加仓价 ≥
          <input aria-label="急拉线-1115 K 最小距离" className={inputClass} type="number" min="0" max="50" step="any" placeholder="不限" value={impulse1115.minDistancePct}
            onChange={e=>change(impulse,{...impulse1115,minDistancePct:e.target.value})}/>%
        </label>
      </>}
    </fieldset>
  </div>;
}
