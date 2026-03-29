import type { Position } from './OrderPanel';

interface Props {
  positions: Position[];
  currentPrice: number;
  onClose: (index: number) => void;
}

export function PositionPanel({ positions, currentPrice, onClose }: Props) {
  const calcPnl = (pos: Position) => {
    const diff = pos.side === 'LONG'
      ? currentPrice - pos.entryPrice
      : pos.entryPrice - currentPrice;
    return diff * pos.quantity;
  };

  const calcPnlPercent = (pos: Position) => {
    const pnl = calcPnl(pos);
    return (pnl / pos.margin) * 100;
  };

  const calcLiqPrice = (pos: Position) => {
    if (pos.side === 'LONG') {
      return pos.entryPrice * (1 - 1 / pos.leverage + 0.004);
    }
    return pos.entryPrice * (1 + 1 / pos.leverage - 0.004);
  };

  return (
    <div className="panel">
      <div className="px-4 py-2 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">
          持仓 <span className="text-muted-foreground font-normal">({positions.length})</span>
        </h3>
      </div>

      {positions.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          暂无持仓
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="text-muted-foreground border-b border-border">
                <th className="px-4 py-2 text-left font-medium">方向</th>
                <th className="px-4 py-2 text-right font-medium">数量</th>
                <th className="px-4 py-2 text-right font-medium">开仓价</th>
                <th className="px-4 py-2 text-right font-medium">标记价</th>
                <th className="px-4 py-2 text-right font-medium">强平价</th>
                <th className="px-4 py-2 text-right font-medium">保证金</th>
                <th className="px-4 py-2 text-right font-medium">盈亏(USDT)</th>
                <th className="px-4 py-2 text-right font-medium">盈亏%</th>
                <th className="px-4 py-2 text-center font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((pos, i) => {
                const pnl = calcPnl(pos);
                const pnlPct = calcPnlPercent(pos);
                const liqPrice = calcLiqPrice(pos);
                return (
                  <tr key={i} className="border-b border-border/50 hover:bg-accent/30">
                    <td className="px-4 py-2.5">
                      <span className={`font-semibold ${pos.side === 'LONG' ? 'trading-green' : 'trading-red'}`}>
                        {pos.side === 'LONG' ? '多' : '空'} {pos.leverage}x
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">{pos.quantity.toFixed(4)}</td>
                    <td className="px-4 py-2.5 text-right">{pos.entryPrice.toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-right">{currentPrice.toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-right text-destructive">{liqPrice.toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-right">{pos.margin.toFixed(2)}</td>
                    <td className={`px-4 py-2.5 text-right font-semibold ${pnl >= 0 ? 'trading-green' : 'trading-red'}`}>
                      {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
                    </td>
                    <td className={`px-4 py-2.5 text-right font-semibold ${pnlPct >= 0 ? 'trading-green' : 'trading-red'}`}>
                      {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <button
                        onClick={() => onClose(i)}
                        className="text-xs px-2 py-1 rounded bg-destructive/20 text-destructive hover:bg-destructive/30 transition-colors"
                      >
                        平仓
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
