import { useState } from 'react';
import type { Position, PendingOrder, TradeRecord } from '@/types/trading';
import { calcUnrealizedPnl, calcROE, calcLiquidationPrice, MAINTENANCE_MARGIN_RATE } from '@/types/trading';
import type { PositionsMap, OrdersMap, PriceMap } from '@/contexts/TradingContext';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { LeverageModal } from '@/components/LeverageModal';
import { TpSlModal } from '@/components/TpSlModal';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface Props {
  positionsMap: PositionsMap;
  ordersMap: OrdersMap;
  tradeHistory: TradeRecord[];
  priceMap: PriceMap;
  activeSymbol: string;
  onClosePosition: (symbol: string, index: number) => void;
  onCancelOrder: (symbol: string, orderId: string) => void;
  onAddIsolatedMargin?: (symbol: string, posIndex: number, amount: number) => void;
  activeTab: string;
  onTabChange: (tab: string) => void;
  onCloseAllPositions?: (symbols: { symbol: string; index: number }[]) => void;
}

export function PositionPanel({
  positionsMap, ordersMap, tradeHistory, priceMap, activeSymbol,
  onClosePosition, onCancelOrder, onAddIsolatedMargin, activeTab, onTabChange,
  onCloseAllPositions,
}: Props) {
  const [leverageModal, setLeverageModal] = useState<{ symbol: string; index: number; pos: Position } | null>(null);
  const [tpslModal, setTpslModal] = useState<{ symbol: string; index: number; pos: Position } | null>(null);
  const [closingKey, setClosingKey] = useState<string | null>(null);
  const [hideOtherContracts, setHideOtherContracts] = useState(false);
  const [closeAllConfirmOpen, setCloseAllConfirmOpen] = useState(false);

  const allPositions: { symbol: string; position: Position; index: number }[] = [];
  for (const [sym, positions] of Object.entries(positionsMap)) {
    positions.forEach((pos, i) => allPositions.push({ symbol: sym, position: pos, index: i }));
  }

  const displayedPositions = hideOtherContracts
    ? allPositions.filter(p => p.symbol === activeSymbol)
    : allPositions;
    positions.forEach((pos, i) => allPositions.push({ symbol: sym, position: pos, index: i }));
  }

  const allOrders: { symbol: string; order: PendingOrder }[] = [];
  for (const [sym, orders] of Object.entries(ordersMap)) {
    for (const o of orders) allOrders.push({ symbol: sym, order: o });
  }

  const fundingRecords = tradeHistory.filter(t => t.action === 'FUNDING');
  const tradeRecords = tradeHistory.filter(t => t.action !== 'FUNDING');

  const TABS = [
    { key: 'positions', label: '持仓', count: allPositions.length },
    { key: 'pending', label: '当前委托', count: allOrders.length },
    { key: 'history', label: '历史记录', count: tradeRecords.length },
    { key: 'funding', label: '资金费', count: fundingRecords.length },
  ];

  const handleClose = (symbol: string, index: number) => {
    const key = `${symbol}-${index}`;
    if (closingKey === key) return;
    setClosingKey(key);
    toast('正在平仓...', { duration: 800 });
    setTimeout(() => {
      onClosePosition(symbol, index);
      setClosingKey(null);
    }, 300);
  };

  return (
    <div className="panel flex flex-col bg-card">
      {/* Tabs */}
      <div className="flex gap-4 px-4 border-b border-border">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => onTabChange(t.key)}
            className={`py-2 text-xs font-medium border-b-2 transition-all duration-100 ease-out active:scale-[0.97] ${
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

      <div className="overflow-y-auto min-h-[120px]">
        {/* ===== POSITIONS (Card-based) ===== */}
        {activeTab === 'positions' && (
          allPositions.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">暂无持仓</div>
          ) : (
            <div className="p-3 space-y-3">
              {allPositions.map(({ symbol, position: pos, index: i }) => {
                const price = priceMap[symbol] || 0;
                const pnl = calcUnrealizedPnl(pos, price);
                const roe = calcROE(pos, price);
                const liq = calcLiquidationPrice(pos);
                const isProfit = pnl >= 0;
                const effectiveMargin = pos.marginMode === 'isolated' && pos.isolatedMargin != null
                  ? pos.isolatedMargin : pos.margin;
                const notional = pos.quantity * price;
                const marginRatio = notional > 0 ? ((effectiveMargin + pnl) / notional * 100) : 0;
                const baseCoin = symbol.replace('USDT', '');

                return (
                  <div
                    key={`${symbol}-${i}`}
                    className="rounded-lg border border-border bg-card shadow-sm overflow-hidden"
                  >
                    {/* Header */}
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50">
                      <span className="text-sm font-bold text-foreground font-mono">{baseCoin}</span>
                      <span className="text-xs text-muted-foreground">/&nbsp;USDT 永续</span>
                      <span
                        className={`ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          pos.side === 'LONG'
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : 'bg-red-500/15 text-red-400'
                        }`}
                      >
                        {pos.side === 'LONG' ? '多' : '空'} {pos.leverage}x {pos.marginMode === 'cross' ? '全仓' : '逐仓'}
                      </span>
                    </div>

                    {/* Hero Stats */}
                    <div className="flex items-start justify-between px-3 py-2.5">
                      <div>
                        <div className="text-[10px] text-muted-foreground mb-0.5">未实现盈亏 (USDT)</div>
                        <div className={`text-lg font-bold font-mono tabular-nums ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                          {isProfit ? '+' : ''}{pnl.toFixed(2)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-muted-foreground mb-0.5">ROE</div>
                        <div className={`text-lg font-bold font-mono tabular-nums ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                          {isProfit ? '+' : ''}{roe.toFixed(2)}%
                        </div>
                      </div>
                    </div>

                    {/* Details Grid */}
                    <div className="grid grid-cols-3 gap-x-4 gap-y-2 px-3 pb-2.5">
                      <DetailCell label="持仓数量" value={pos.quantity.toFixed(4)} />
                      <DetailCell label="保证金" value={effectiveMargin.toFixed(2)} />
                      <DetailCell label="保证金比率" value={`${marginRatio.toFixed(2)}%`} />
                      <DetailCell label="开仓价格" value={pos.entryPrice.toFixed(2)} />
                      <DetailCell label="标记价格" value={price > 0 ? price.toFixed(2) : '-'} />
                      <DetailCell label="强平价格" value={liq.toFixed(2)} valueClassName="text-red-400" />
                    </div>

                    {/* Action Buttons */}
                    <div className="flex border-t border-border/50">
                      <ActionBtn label="杠杆" onClick={(e) => { e.stopPropagation(); setLeverageModal({ symbol, index: i, pos }); }} />
                      <ActionBtn label="止盈/止损" onClick={(e) => { e.stopPropagation(); setTpslModal({ symbol, index: i, pos }); }} />
                      <ActionBtn
                        label="平仓"
                        danger
                        onClick={(e) => { e.stopPropagation(); handleClose(symbol, i); }}
                        disabled={closingKey === `${symbol}-${i}`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}

        {/* ===== PENDING ORDERS ===== */}
        {activeTab === 'pending' && (
          allOrders.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">暂无委托</div>
          ) : (
            <table className="w-full text-[11px] font-mono tabular-nums">
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
                    <td className={`px-3 py-2 font-bold ${order.side === 'LONG' ? 'text-emerald-400' : 'text-red-400'}`}>
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

        {/* ===== HISTORY ===== */}
        {activeTab === 'history' && (
          tradeRecords.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">暂无历史记录</div>
          ) : (
            <table className="w-full text-[11px] font-mono tabular-nums">
              <thead>
                <tr className="text-muted-foreground border-b border-border">
                  {['合约', '操作', '方向', '开仓价', '平仓价', '数量', '手续费', '滑点', '盈亏'].map(h => (
                    <th key={h} className="px-3 py-1.5 text-left font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tradeRecords.slice().reverse().slice(0, 50).map(t => (
                  <tr key={t.id} className="border-b border-border/30">
                    <td className="px-3 py-2 text-foreground">{t.symbol?.replace('USDT', '/USDT') || '-'}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] px-1 py-0.5 rounded ${
                        t.action === 'LIQUIDATION' ? 'bg-destructive/20 text-destructive' :
                        t.action === 'OPEN' ? 'bg-primary/20 text-primary' : 'bg-accent text-foreground'
                      }`}>
                        {t.action === 'LIQUIDATION' ? '💀爆仓' : t.action === 'OPEN' ? '开仓' : '平仓'}
                      </span>
                    </td>
                    <td className={`px-3 py-2 font-bold ${t.side === 'LONG' ? 'text-emerald-400' : 'text-red-400'}`}>
                      {t.side === 'LONG' ? '多' : '空'} {t.leverage}x
                    </td>
                    <td className="px-3 py-2">{t.entryPrice.toFixed(2)}</td>
                    <td className="px-3 py-2">{t.exitPrice > 0 ? t.exitPrice.toFixed(2) : '-'}</td>
                    <td className="px-3 py-2">{t.quantity.toFixed(4)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{t.fee.toFixed(4)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{t.slippage > 0 ? t.slippage.toFixed(4) : '-'}</td>
                    <td className={`px-3 py-2 font-bold ${t.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {t.pnl >= 0 ? '+' : ''}{t.pnl.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}

        {/* ===== FUNDING ===== */}
        {activeTab === 'funding' && (
          fundingRecords.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">
              暂无资金费记录 · 每 8 小时结算 (00:00, 08:00, 16:00 UTC)
            </div>
          ) : (
            <table className="w-full text-[11px] font-mono tabular-nums">
              <thead>
                <tr className="text-muted-foreground border-b border-border">
                  {['时间', '合约', '方向', '名义价值', '费率', '金额'].map(h => (
                    <th key={h} className="px-3 py-1.5 text-left font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {fundingRecords.slice().reverse().slice(0, 50).map(t => (
                  <tr key={t.id} className="border-b border-border/30">
                    <td className="px-3 py-2 text-muted-foreground">
                      {new Date(t.openTime).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-foreground">{t.symbol?.replace('USDT', '/USDT')}</td>
                    <td className={`px-3 py-2 font-bold ${t.side === 'LONG' ? 'text-emerald-400' : 'text-red-400'}`}>
                      {t.side === 'LONG' ? '多' : '空'}
                    </td>
                    <td className="px-3 py-2">{(t.entryPrice * t.quantity).toFixed(2)}</td>
                    <td className="px-3 py-2 text-muted-foreground">0.01%</td>
                    <td className={`px-3 py-2 font-bold ${t.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {t.pnl >= 0 ? '+' : ''}{t.pnl.toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>

      {/* Modals */}
      {leverageModal && (
        <LeverageModal
          pos={leverageModal.pos}
          symbol={leverageModal.symbol}
          onClose={() => setLeverageModal(null)}
          onConfirm={(newLev) => {
            toast.success(`杠杆已调整为 ${newLev}x`);
            setLeverageModal(null);
          }}
        />
      )}
      {tpslModal && (
        <TpSlModal
          pos={tpslModal.pos}
          symbol={tpslModal.symbol}
          markPrice={priceMap[tpslModal.symbol] || 0}
          liqPrice={calcLiquidationPrice(tpslModal.pos)}
          onClose={() => setTpslModal(null)}
          onConfirm={(tp, sl, pct) => {
            toast.success(`止盈止损已设置 · TP: ${tp || '-'} / SL: ${sl || '-'} (${pct}%)`);
            setTpslModal(null);
          }}
        />
      )}
    </div>
  );
}

/* ===== Sub-components ===== */

function DetailCell({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] text-muted-foreground truncate">{label}</div>
      <div className={`text-xs font-mono tabular-nums text-foreground ${valueClassName || ''}`}>{value}</div>
    </div>
  );
}

function ActionBtn({ label, onClick, danger, disabled }: {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 py-2 text-xs font-medium transition-all active:scale-95 border-r border-border/50 last:border-r-0 ${
        danger
          ? 'text-red-400 hover:bg-red-500/10'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
      } disabled:opacity-50`}
    >
      {label}
    </button>
  );
}
