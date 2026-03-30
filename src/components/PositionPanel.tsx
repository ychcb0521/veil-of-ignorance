import type { Position, PendingOrder, TradeRecord } from '@/types/trading';
import { calcUnrealizedPnl, calcROE, calcLiquidationPrice } from '@/types/trading';
import type { PositionsMap, OrdersMap, PriceMap } from '@/contexts/TradingContext';
import { X } from 'lucide-react';

interface Props {
  positionsMap: PositionsMap;
  ordersMap: OrdersMap;
  tradeHistory: TradeRecord[];
  priceMap: PriceMap;
  activeSymbol: string;
  onClosePosition: (symbol: string, index: number) => void;
  onCancelOrder: (symbol: string, orderId: string) => void;
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export function PositionPanel({
  positionsMap, ordersMap, tradeHistory, priceMap, activeSymbol,
  onClosePosition, onCancelOrder, activeTab, onTabChange,
}: Props) {
  // Flatten all positions across symbols
  const allPositions: { symbol: string; position: Position; index: number }[] = [];
  for (const [sym, positions] of Object.entries(positionsMap)) {
    positions.forEach((pos, i) => allPositions.push({ symbol: sym, position: pos, index: i }));
  }

  // Flatten all orders
  const allOrders: { symbol: string; order: PendingOrder }[] = [];
  for (const [sym, orders] of Object.entries(ordersMap)) {
    for (const o of orders) allOrders.push({ symbol: sym, order: o });
  }

  const TABS = [
    { key: 'positions', label: '持仓', count: allPositions.length },
    { key: 'pending', label: '当前委托', count: allOrders.length },
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
          allPositions.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">暂无持仓</div>
          ) : (
            <table className="w-full text-[11px] font-mono">
              <thead>
                <tr className="text-muted-foreground border-b border-border">
                  {['合约', '方向', '数量', '开仓均价', '标记价', '强平价', '保证金', '未实现盈亏', 'ROE%', '操作'].map(h => (
                    <th key={h} className="px-3 py-1.5 text-left font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allPositions.map(({ symbol, position: pos, index: i }) => {
                  const price = priceMap[symbol] || 0;
                  const pnl = calcUnrealizedPnl(pos, price);
                  const roe = calcROE(pos, price);
                  const liq = calcLiquidationPrice(pos);
                  const isProfit = pnl >= 0;
                  const isActive = symbol === activeSymbol;
                  return (
                    <tr key={`${symbol}-${i}`} className={`border-b border-border/30 hover:bg-accent/20 ${isActive ? '' : 'opacity-80'}`}>
                      <td className="px-3 py-2">
                        <span className="text-foreground font-medium">{symbol.replace('USDT', '')}</span>
                        <span className="text-muted-foreground text-[10px] ml-0.5">/USDT</span>
                      </td>
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
                      <td className="px-3 py-2">{price > 0 ? price.toFixed(2) : '-'}</td>
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
                          onClick={() => onClosePosition(symbol, i)}
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
          allOrders.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">暂无委托</div>
          ) : (
            <table className="w-full text-[11px] font-mono">
              <thead>
                <tr className="text-muted-foreground border-b border-border">
                  {['合约', '类型', '方向', '价格', '触发价', '数量', '杠杆', '操作'].map(h => (
                    <th key={h} className="px-3 py-1.5 text-left font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allOrders.map(({ symbol, order }) => (
                  <tr key={order.id} className="border-b border-border/30 hover:bg-accent/20">
                    <td className="px-3 py-2">
                      <span className="text-foreground font-medium">{symbol.replace('USDT', '')}</span>
                      <span className="text-muted-foreground text-[10px]">/USDT</span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {{ LIMIT: '限价', POST_ONLY: '只做Maker', MARKET: '市价', LIMIT_TP_SL: '限价TP/SL', MARKET_TP_SL: '市价TP/SL', CONDITIONAL: '条件', TRAILING_STOP: '跟踪', TWAP: 'TWAP', SCALED: '分段' }[order.type] || order.type}
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
                        onClick={() => onCancelOrder(symbol, order.id)}
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
