import type { Position, PendingOrder, TradeRecord } from '@/types/trading';
import { calcUnrealizedPnl, calcROE, calcLiquidationPrice } from '@/types/trading';
import { X } from 'lucide-react';

interface Props {
  positions: Position[];
  pendingOrders: PendingOrder[];
  tradeHistory: TradeRecord[];
  currentPrice: number;
  onClosePosition: (index: number) => void;
  onCancelOrder: (id: string) => void;
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export function PositionPanel({
  positions, pendingOrders, tradeHistory, currentPrice,
  onClosePosition, onCancelOrder, activeTab, onTabChange,
}: Props) {
  const TABS = [
    { key: 'positions', label: '持仓', count: positions.length },
    { key: 'pending', label: '当前委托', count: pendingOrders.length },
    { key: 'history', label: '历史记录', count: tradeHistory.length },
  ];

  return (
    <div className="panel flex flex-col" style={{ background: '#0B0E11' }}>
      {/* Tabs */}
      <div className="flex gap-4 px-4 border-b border-border">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => onTabChange(t.key)}
            className={`py-2 text-xs font-medium border-b-2 transition-colors ${
              activeTab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
            {t.count > 0 && (
              <span className="ml-1 px-1 rounded text-[10px] bg-accent">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="overflow-x-auto min-h-[120px]">
        {activeTab === 'positions' && (
          positions.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">暂无持仓</div>
          ) : (
            <table className="w-full text-[11px] font-mono">
              <thead>
                <tr className="text-muted-foreground border-b border-border">
                  {['方向', '数量', '开仓均价', '标记价', '强平价', '保证金', '未实现盈亏', 'ROE%', '操作'].map(h => (
                    <th key={h} className="px-3 py-1.5 text-left font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {positions.map((pos, i) => {
                  const pnl = calcUnrealizedPnl(pos, currentPrice);
                  const roe = calcROE(pos, currentPrice);
                  const liq = calcLiquidationPrice(pos);
                  const isProfit = pnl >= 0;
                  return (
                    <tr key={i} className="border-b border-border/30 hover:bg-accent/20">
                      <td className="px-3 py-2">
                        <span className={`font-bold ${pos.side === 'LONG' ? 'trading-green' : 'trading-red'}`}>
                          {pos.side === 'LONG' ? '多' : '空'} {pos.leverage}x
                        </span>
                        <span className="text-muted-foreground ml-1 text-[10px]">
                          {pos.marginMode === 'cross' ? '全仓' : '逐仓'}
                        </span>
                      </td>
                      <td className="px-3 py-2">{pos.quantity.toFixed(4)}</td>
                      <td className="px-3 py-2">{pos.entryPrice.toFixed(2)}</td>
                      <td className="px-3 py-2">{currentPrice.toFixed(2)}</td>
                      <td className="px-3 py-2 text-destructive">{liq.toFixed(2)}</td>
                      <td className="px-3 py-2">{pos.margin.toFixed(2)}</td>
                      <td className={`px-3 py-2 font-bold ${isProfit ? 'trading-green' : 'trading-red'}`}>
                        {isProfit ? '+' : ''}{pnl.toFixed(2)}
                      </td>
                      <td className={`px-3 py-2 font-bold ${isProfit ? 'trading-green' : 'trading-red'}`}>
                        {isProfit ? '+' : ''}{roe.toFixed(2)}%
                      </td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => onClosePosition(i)}
                          className="px-2 py-0.5 rounded text-[10px] font-medium bg-destructive/20 text-destructive hover:bg-destructive/30 transition-colors"
                        >
                          平仓
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        )}

        {activeTab === 'pending' && (
          pendingOrders.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">暂无委托</div>
          ) : (
            <table className="w-full text-[11px] font-mono">
              <thead>
                <tr className="text-muted-foreground border-b border-border">
                  {['类型', '方向', '价格', '触发价', '数量', '杠杆', '操作'].map(h => (
                    <th key={h} className="px-3 py-1.5 text-left font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pendingOrders.map(order => (
                  <tr key={order.id} className="border-b border-border/30 hover:bg-accent/20">
                    <td className="px-3 py-2 text-muted-foreground">
                      {order.type === 'LIMIT' ? '限价' : order.type === 'STOP_LIMIT' ? '止损限价' : '止损市价'}
                    </td>
                    <td className={`px-3 py-2 font-bold ${order.side === 'LONG' ? 'trading-green' : 'trading-red'}`}>
                      {order.side === 'LONG' ? '多' : '空'}
                    </td>
                    <td className="px-3 py-2">{order.price > 0 ? order.price.toFixed(2) : '市价'}</td>
                    <td className="px-3 py-2">{order.stopPrice > 0 ? order.stopPrice.toFixed(2) : '-'}</td>
                    <td className="px-3 py-2">{order.quantity.toFixed(4)}</td>
                    <td className="px-3 py-2">{order.leverage}x</td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => onCancelOrder(order.id)}
                        className="p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}

        {activeTab === 'history' && (
          tradeHistory.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">暂无历史记录</div>
          ) : (
            <table className="w-full text-[11px] font-mono">
              <thead>
                <tr className="text-muted-foreground border-b border-border">
                  {['方向', '类型', '开仓价', '平仓价', '数量', '手续费', '盈亏'].map(h => (
                    <th key={h} className="px-3 py-1.5 text-left font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tradeHistory.slice().reverse().map(t => (
                  <tr key={t.id} className="border-b border-border/30">
                    <td className={`px-3 py-2 font-bold ${t.side === 'LONG' ? 'trading-green' : 'trading-red'}`}>
                      {t.side === 'LONG' ? '多' : '空'} {t.leverage}x
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{t.type}</td>
                    <td className="px-3 py-2">{t.entryPrice.toFixed(2)}</td>
                    <td className="px-3 py-2">{t.exitPrice.toFixed(2)}</td>
                    <td className="px-3 py-2">{t.quantity.toFixed(4)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{t.fee.toFixed(4)}</td>
                    <td className={`px-3 py-2 font-bold ${t.pnl >= 0 ? 'trading-green' : 'trading-red'}`}>
                      {t.pnl >= 0 ? '+' : ''}{t.pnl.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>
    </div>
  );
}
