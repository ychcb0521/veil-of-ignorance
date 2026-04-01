import { useState, useEffect } from 'react';
import { getMaxLeverageForNotional, getLeverageTierInfo } from '@/types/trading';
import { Slider } from '@/components/ui/slider';
import { Minus, Plus, X } from 'lucide-react';

interface Props {
  symbol: string;
  currentLeverage: number;
  onClose: () => void;
  onConfirm: (leverage: number) => void;
  /** Optional notional for tier display */
  notional?: number;
}

const MAX_LEVERAGE = 125;

export function LeverageModal({ symbol, currentLeverage, onClose, onConfirm, notional = 0 }: Props) {
  const maxLev = notional > 0 ? getMaxLeverageForNotional(notional) : MAX_LEVERAGE;
  const [leverage, setLeverage] = useState(currentLeverage);
  const [inputValue, setInputValue] = useState(String(currentLeverage));
  const tierInfo = notional > 0 ? getLeverageTierInfo(notional) : null;
  const baseCoin = symbol.replace('USDT', '');

  // Keep input in sync with slider/buttons
  useEffect(() => { setInputValue(String(leverage)); }, [leverage]);

  const clamp = (v: number) => Math.floor(Math.max(1, Math.min(maxLev, v)));

  const handleInputChange = (val: string) => {
    setInputValue(val);
    const v = parseInt(val);
    if (!isNaN(v) && v >= 1 && v <= maxLev) {
      setLeverage(Math.floor(v));
    }
  };

  const handleInputBlur = () => {
    const v = parseInt(inputValue);
    const clamped = clamp(isNaN(v) ? 1 : v);
    setLeverage(clamped);
    setInputValue(String(clamped));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
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
            {baseCoin}/USDT 永续 · 当前 {currentLeverage}x
          </div>

          {/* Leverage display with +/- and direct input */}
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={() => setLeverage(v => clamp(v - 1))}
              className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center hover:bg-accent active:scale-95 transition-all"
            >
              <Minus className="w-4 h-4 text-foreground" />
            </button>
            <div className="relative w-24">
              <input
                type="number"
                min={1}
                max={maxLev}
                value={inputValue}
                onChange={e => handleInputChange(e.target.value)}
                onBlur={handleInputBlur}
                onKeyDown={handleKeyDown}
                className="w-full text-center text-2xl font-bold font-mono text-foreground tabular-nums bg-transparent border border-border rounded-lg px-1 py-0.5 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground pointer-events-none">x</span>
            </div>
            <button
              onClick={() => setLeverage(v => clamp(v + 1))}
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
          {tierInfo && (
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
          )}

          {/* Warning for unified leverage */}
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-[10px] text-amber-400">
            ⚠️ 杠杆倍数将同时应用于 {baseCoin}/USDT 的多单和空单
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
