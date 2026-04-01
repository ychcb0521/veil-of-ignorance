import { useState } from 'react';
import type { Position } from '@/types/trading';
import { getMaxLeverageForNotional, getLeverageTierInfo } from '@/types/trading';
import { Slider } from '@/components/ui/slider';
import { Minus, Plus, X } from 'lucide-react';

interface Props {
  pos: Position;
  symbol: string;
  onClose: () => void;
  onConfirm: (leverage: number) => void;
}

export function LeverageModal({ pos, symbol, onClose, onConfirm }: Props) {
  const notional = pos.entryPrice * pos.quantity;
  const maxLev = getMaxLeverageForNotional(notional);
  const [leverage, setLeverage] = useState(pos.leverage);
  const tierInfo = getLeverageTierInfo(notional);
  const baseCoin = symbol.replace('USDT', '');

  const adjust = (delta: number) => {
    setLeverage(v => Math.max(1, Math.min(maxLev, v + delta)));
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[340px] rounded-xl bg-card border border-border shadow-2xl animate-in fade-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-bold text-foreground">调整杠杆</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-4 space-y-5">
          {/* Symbol info */}
          <div className="text-xs text-muted-foreground text-center">
            {baseCoin}/USDT 永续 · 当前 {pos.leverage}x
          </div>

          {/* Leverage display with +/- */}
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={() => adjust(-1)}
              className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center hover:bg-accent active:scale-95 transition-all"
            >
              <Minus className="w-4 h-4 text-foreground" />
            </button>
            <div className="text-2xl font-bold font-mono text-foreground tabular-nums w-20 text-center">
              {leverage}x
            </div>
            <button
              onClick={() => adjust(1)}
              className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center hover:bg-accent active:scale-95 transition-all"
            >
              <Plus className="w-4 h-4 text-foreground" />
            </button>
          </div>

          {/* Slider */}
          <Slider
            value={[leverage]}
            min={1}
            max={maxLev}
            step={1}
            onValueChange={([v]) => setLeverage(v)}
            className="w-full"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
            <span>1x</span>
            <span>{maxLev}x</span>
          </div>

          {/* Tier info */}
          <div className="rounded-lg bg-secondary/50 px-3 py-2 text-[11px] text-muted-foreground space-y-1">
            <div className="flex justify-between">
              <span>名义价值</span>
              <span className="font-mono">{notional.toFixed(2)} USDT</span>
            </div>
            <div className="flex justify-between">
              <span>最大杠杆</span>
              <span className="font-mono">{tierInfo.maxLeverage}x ({tierInfo.tierLabel})</span>
            </div>
          </div>

          {/* Confirm button */}
          <button
            onClick={() => onConfirm(leverage)}
            className="w-full py-2.5 rounded-lg bg-amber-500 text-black text-sm font-bold hover:bg-amber-400 active:scale-[0.98] transition-all"
          >
            确认 — {leverage}x
          </button>
        </div>
      </div>
    </div>
  );
}
