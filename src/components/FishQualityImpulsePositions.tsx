import {DBL5_GUARD_PLUS_PARAMS, IMPULSE_1115_DISPLAY_NAME} from '@/lib/dbl5GuardPlus';
import {IMPULSE_5M_DISPLAY_NAME} from '@/lib/impulse5m';

export interface Impulse1115Draft {
  bufferAtr?: string;
  minDistancePct: string;
  skipNative?: true;
}
export interface Impulse5mDraft extends Impulse1115Draft {
  bufferAtr: string;
}

export function FishQualityImpulse5mSettings({position, disabled, inputClass, change}: {
  position: Impulse5mDraft;
  disabled: boolean;
  inputClass: string;
  change: (position: Impulse5mDraft) => void;
}) {
  return <fieldset className="min-w-0 space-y-2 rounded border border-border/60 p-2" disabled={disabled} aria-label={`${IMPULSE_5M_DISPLAY_NAME}参数`}>
    <h6 className="font-medium">{IMPULSE_5M_DISPLAY_NAME}参数</h6>
    <p className="text-muted-foreground">币安 U 本位 · 5 分钟收盘确认量价突破</p>
    <div className="grid gap-2">
      <label className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span>K 取起涨低点 −</span>
        <span className="flex items-center gap-1"><input aria-label="急拉线冗余 ATR" className={inputClass} type="number" min="0" max="20" step="any"
          value={position.bufferAtr} onChange={e=>change({...position,bufferAtr:e.target.value})}/>× ATR</span>
      </label>
      <label className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span>K 离加仓价 ≥</span>
        <span className="flex items-center gap-1"><input aria-label="急拉线 K 最小距离" className={inputClass} type="number" min="0" max="50" step="any"
          placeholder="不限" value={position.minDistancePct} onChange={e=>change({...position,minDistancePct:e.target.value})}/>%</span>
      </label>
    </div>
  </fieldset>;
}

export function FishQualityImpulsePositions({impulse1115, disabled, inputClass, change}: {
  impulse1115: Impulse1115Draft;
  disabled: boolean;
  inputClass: string;
  change: (position: Impulse1115Draft) => void;
}) {
  const p=DBL5_GUARD_PLUS_PARAMS;
  return <fieldset className="min-w-0 space-y-2 rounded border border-border/60 p-2" aria-label={`${IMPULSE_1115_DISPLAY_NAME}参数`} disabled={disabled} data-testid="addition-impulse-positions">
        <h6 className="font-medium">{IMPULSE_1115_DISPLAY_NAME}参数</h6>
        <p className="text-muted-foreground">两根紧凑整理后，观察 {p.windowBars} 根以内的首次急拉和收盘突破。</p>
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
          <label className="grid min-w-0 gap-1"><span className="text-muted-foreground">K 冗余</span>
            <span className="flex items-center gap-1"><input aria-label={`${IMPULSE_1115_DISPLAY_NAME} K 冗余 ATR`} className={inputClass} type="number" min="0" step="any"
              value={impulse1115.bufferAtr??String(p.bufferAtr)} onChange={e=>change({...impulse1115,bufferAtr:e.target.value})}/>× ATR</span>
          </label>
          <label className="grid min-w-0 gap-1"><span className="text-muted-foreground">K 离加仓价 ≥</span>
            <span className="flex items-center gap-1"><input aria-label={`${IMPULSE_1115_DISPLAY_NAME} K 最小距离`} className={inputClass} type="number" min="0" max="50" step="any" placeholder="不限" value={impulse1115.minDistancePct}
              onChange={e=>change({...impulse1115,minDistancePct:e.target.value})}/>%</span>
          </label>
        </div>
        <p className="text-muted-foreground">K = 起涨低点 − 所设倍数 × 急拉前的 5m ATR(14)</p>
  </fieldset>;
}
