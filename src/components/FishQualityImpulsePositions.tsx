import {DBL5_GUARD_DISPLAY_NAME, DBL5_GUARD_PLUS_DISPLAY_NAME, DBL5_GUARD_PLUS_PARAMS, IMPULSE_1115_DISPLAY_NAME} from '@/lib/dbl5GuardPlus';

export interface Impulse1115Draft {
  bufferAtr?: string;
  minDistancePct: string;
  skipNative?: true;
}
export interface Impulse5mDraft extends Impulse1115Draft {
  bufferAtr: string;
}

export function FishQualityImpulsePositions({impulse1115, legacy1115, disabled, inputClass, change}: {
  impulse1115?: Impulse1115Draft;
  legacy1115: boolean;
  disabled: boolean;
  inputClass: string;
  change: (position?: Impulse1115Draft) => void;
}) {
  const p=DBL5_GUARD_PLUS_PARAMS;
  const lock=disabled||legacy1115;
  return <fieldset className="min-w-0 space-y-2 rounded border border-border/60 p-2" disabled={lock} data-testid="addition-impulse-positions">
      <label className="inline-flex items-center gap-2 font-medium">
        <input type="checkbox" checked={!!impulse1115} onChange={e=>change(e.target.checked?{bufferAtr:String(p.bufferAtr),minDistancePct:''}:undefined)}/>
        {IMPULSE_1115_DISPLAY_NAME}
      </label>
      {legacy1115&&<p className="text-muted-foreground">当前使用「{DBL5_GUARD_PLUS_DISPLAY_NAME}」。切回「{DBL5_GUARD_DISPLAY_NAME}」后可勾选此位置。</p>}
      {impulse1115&&<>
        <p className="text-muted-foreground">两根紧凑整理后，观察 {p.windowBars} 根以内的首次急拉和收盘突破。</p>
        <label className="flex flex-wrap items-center gap-1">K = 起涨低点 −
          <input aria-label={`${IMPULSE_1115_DISPLAY_NAME} K 冗余 ATR`} className={inputClass} type="number" min="0" step="any"
            value={impulse1115.bufferAtr??String(p.bufferAtr)} onChange={e=>change({...impulse1115,bufferAtr:e.target.value})}/>
          × 急拉前的 5m ATR(14)
        </label>
        <label className="flex flex-wrap items-center gap-1">K 离加仓价 ≥
          <input aria-label={`${IMPULSE_1115_DISPLAY_NAME} K 最小距离`} className={inputClass} type="number" min="0" max="50" step="any" placeholder="不限" value={impulse1115.minDistancePct}
            onChange={e=>change({...impulse1115,minDistancePct:e.target.value})}/>%
        </label>
      </>}
  </fieldset>;
}
