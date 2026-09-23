import { useState } from 'react';
import type { Position, SettlementMode } from '@/types/trading';
import { Slider } from '@/components/ui/slider';
import { AlertTriangle, X } from 'lucide-react';
import { formatPrice } from '@/lib/formatters';
import { getSettlementAsset } from '@/lib/coinMargined';
import { CARD_TPSL_PERCENT_STEP, type CardCloseLotSize } from '@/lib/marketLotSize';

interface Props {
  pos: Position;
  symbol: string;
  markPrice: number;
  liqPrice: number;
  onClose: () => void;
  onConfirm: (tp: number | null, sl: number | null, pct: number) => void;
  settlementMode?: SettlementMode;
  /**
   * 这一次覆盖几笔仓位（持仓卡上的「N 笔合并」）。大于 1 时在弹窗里写明：
   * 每一笔各挂一张、同价同成数，「100%」盖住的是整张卡——用户看的开仓价是加权价、
   * 强平价是最先被强平的那一笔，落到单子上却是逐笔，这件事必须说出来。
   */
  legCount?: number;
  /**
   * 按成数（0–1）与触发价判这张止盈 / 止损触发后那笔市价单会不会超过币安单笔市价上限
   * （lib/marketLotSize.cardCloseLotSize，'tpsl'）。100% 平掉整个仓位的不受限。不传就不判。
   */
  lotSizeCheck?: (fraction: number, triggerPrice: number) => CardCloseLotSize;
}

export function TpSlModal({
  pos,
  symbol,
  markPrice,
  liqPrice,
  onClose,
  onConfirm,
  settlementMode = 'usdt',
  legCount = 1,
  lotSizeCheck,
}: Props) {
  const [tpPrice, setTpPrice] = useState('');
  const [slPrice, setSlPrice] = useState('');
  const [pct, setPct] = useState(100);
  const baseCoin = getSettlementAsset(symbol);
  const quoteUnitLabel = settlementMode === 'coin' ? 'USD' : 'USDT';

  /**
   * 按成数（不足 100%）挂的止盈止损带明确数量，触发后是一笔市价单：超过币安单笔市价上限就挂不出去。
   * 按各自的触发价判（合成币本位的张数上限随价变化）；100% 平掉整个仓位的不受限（相当于 closePosition）。
   */
  const lotRefusal = (() => {
    if (!lotSizeCheck || pct >= 100) return null;
    for (const [label, raw] of [['止盈', tpPrice], ['止损', slPrice]] as const) {
      const px = parseFloat(raw);
      if (!(px > 0)) continue;
      const verdict = lotSizeCheck(pct / 100, px);
      if (verdict.refusal) {
        // 滑条最小一格（10%）在这个触发价上也放不下：没有「调小」这条路，只剩 100%
        const smallestFits = lotSizeCheck(CARD_TPSL_PERCENT_STEP / 100, px).refusal == null;
        return { label, check: verdict.refusal, smallestFits };
      }
    }
    return null;
  })();

  const handleConfirm = () => {
    const tp = tpPrice ? parseFloat(tpPrice) : null;
    const sl = slPrice ? parseFloat(slPrice) : null;
    if (tp === null && sl === null) return;
    if (lotRefusal) return;
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
            <InfoCell label="开仓价" value={formatPrice(pos.entryPrice, symbol)} />
            <InfoCell label="标记价" value={markPrice > 0 ? formatPrice(markPrice, symbol) : '-'} />
            <InfoCell label="强平价" value={isFinite(liqPrice) ? formatPrice(liqPrice, symbol) : '--'} valueClass="text-trading-red" />
          </div>

          <div className="text-[10px] text-muted-foreground text-center">
            {baseCoin}/{quoteUnitLabel} 永续 ·{' '}
            <span className={pos.side === 'LONG' ? 'text-trading-green' : 'text-trading-red'}>
              {pos.side === 'LONG' ? '多' : '空'} {pos.leverage}x
            </span>
          </div>

          {legCount > 1 && (
            <div className="text-[10px] text-muted-foreground text-center" data-testid="tpsl-leg-note">
              这张卡上的 {legCount} 笔仓位<strong className="text-foreground">各挂一张</strong>（同一个触发价，成数按各笔自己的数量算）：
              开仓价写的是加权价、强平价写的是最先被强平的那一笔。
            </div>
          )}

          {/* TP input */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-trading-green">止盈 (Take Profit)</label>
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
            <label className="text-xs font-medium text-trading-red">止损 (Stop Loss)</label>
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
              min={CARD_TPSL_PERCENT_STEP}
              max={100}
              step={CARD_TPSL_PERCENT_STEP}
              onValueChange={([v]) => setPct(v)}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
              <span>{CARD_TPSL_PERCENT_STEP}%</span>
              <span>100%</span>
            </div>
          </div>

          {lotRefusal && (
            <div
              data-testid="tpsl-lot-size-warning"
              className="flex items-start gap-1.5 px-2 py-1.5 rounded text-[10px] bg-trading-red/10 text-trading-red border border-trading-red/30"
            >
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
              <span className="space-y-0.5">
                <span className="block">{lotRefusal.label}（{pct}% 仓位）：{lotRefusal.check.title}</span>
                <span className="block text-[9px] opacity-80">
                  {lotRefusal.smallestFits
                    ? `${lotRefusal.check.source}。按成数挂的止盈止损触发后是一笔市价单：把成数调小到不超过上限，`
                      + '或选 100%（平掉整个仓位的不受此限）。'
                    : `${lotRefusal.check.source}。按成数挂的止盈止损触发后是一笔市价单，`
                      + `连最小的一格（${CARD_TPSL_PERCENT_STEP}%）都超过上限：只能选 100%（平掉整个仓位的不受此限）。`}
                </span>
              </span>
            </div>
          )}

          {/* Confirm */}
          <button
            onClick={handleConfirm}
            disabled={(!tpPrice && !slPrice) || lotRefusal != null}
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
