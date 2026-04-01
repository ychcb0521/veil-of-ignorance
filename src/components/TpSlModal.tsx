import { useState } from 'react';
import type { Position } from '@/types/trading';
import { Slider } from '@/components/ui/slider';
import { X } from 'lucide-react';

interface Props {
  pos: Position;
  symbol: string;
  markPrice: number;
  liqPrice: number;
  onClose: () => void;
  onConfirm: (tp: number | null, sl: number | null, pct: number) => void;
}

export function TpSlModal({ pos, symbol, markPrice, liqPrice, onClose, onConfirm }: Props) {
  const [tpPrice, setTpPrice] = useState('');
  const [slPrice, setSlPrice] = useState('');
  const [pct, setPct] = useState(100);
  const baseCoin = symbol.replace('USDT', '');

  const handleConfirm = () => {
    const tp = tpPrice ? parseFloat(tpPrice) : null;
    const sl = slPrice ? parseFloat(slPrice) : null;
    if (tp === null && sl === null) return;
    onConfirm(tp, sl, pct);
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[360px] rounded-xl bg-card border border-border shadow-2xl animate-in fade-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-bold text-foreground">止盈 / 止损</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-4 space-y-4">
          {/* Position info row */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <InfoCell label="开仓价" value={pos.entryPrice.toFixed(2)} />
            <InfoCell label="标记价" value={markPrice > 0 ? markPrice.toFixed(2) : '-'} />
            <InfoCell label="强平价" value={liqPrice.toFixed(2)} valueClass="text-red-400" />
          </div>

          <div className="text-[10px] text-muted-foreground text-center">
            {baseCoin}/USDT 永续 ·{' '}
            <span className={pos.side === 'LONG' ? 'text-emerald-400' : 'text-red-400'}>
              {pos.side === 'LONG' ? '多' : '空'} {pos.leverage}x
            </span>
          </div>

          {/* TP input */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-emerald-400">止盈 (Take Profit)</label>
            <input
              type="number"
              value={tpPrice}
              onChange={e => setTpPrice(e.target.value)}
              placeholder="触发价格"
              className="w-full h-9 rounded-lg bg-secondary border border-border px-3 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
            />
          </div>

          {/* SL input */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-red-400">止损 (Stop Loss)</label>
            <input
              type="number"
              value={slPrice}
              onChange={e => setSlPrice(e.target.value)}
              placeholder="触发价格"
              className="w-full h-9 rounded-lg bg-secondary border border-border px-3 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-red-500/50"
            />
          </div>

          {/* Quantity slider */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">平仓数量</span>
              <span className="font-mono font-bold text-foreground">{pct}%</span>
            </div>
            <Slider
              value={[pct]}
              min={10}
              max={100}
              step={10}
              onValueChange={([v]) => setPct(v)}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
              <span>10%</span>
              <span>100%</span>
            </div>
          </div>

          {/* Confirm */}
          <button
            onClick={handleConfirm}
            disabled={!tpPrice && !slPrice}
            className="w-full py-2.5 rounded-lg bg-amber-500 text-black text-sm font-bold hover:bg-amber-400 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            确认
          </button>
        </div>
      </div>
    </div>
  );
}

function InfoCell({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`text-xs font-mono font-bold tabular-nums ${valueClass || 'text-foreground'}`}>{value}</div>
    </div>
  );
}
