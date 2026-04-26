import { useState, useMemo } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
import type { Position, PendingOrder, TradeRecord } from '@/types/trading';
import { calcUnrealizedPnl, calcROE, calcLiquidationPrice, MAINTENANCE_MARGIN_RATE } from '@/types/trading';
import type { PositionsMap, OrdersMap, PriceMap } from '@/contexts/TradingContext';
import { X, Trash2, ArrowUpDown, ArrowUp, ArrowDown, Plus } from 'lucide-react';
import { AdjustMarginModal } from '@/components/AdjustMarginModal';
import { toast } from 'sonner';
import { LeverageModal } from '@/components/LeverageModal';
import { TpSlModal } from '@/components/TpSlModal';
import { ClosePositionModal } from '@/components/ClosePositionModal';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { formatPrice, formatAmount, formatUSDT, formatSignedUSDT } from '@/lib/formatters';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';

interface Props {
  positionsMap: PositionsMap;
  ordersMap: OrdersMap;
  tradeHistory: TradeRecord[];
  priceMap: PriceMap;
  activeSymbol: string;
  onClosePosition: (symbol: string, index: number, percentage?: number) => void;
  onCancelOrder: (symbol: string, orderId: string) => void;
  onAddIsolatedMargin?: (symbol: string, posIndex: number, amount: number) => void;
  onClearSymbolData?: (symbol: string) => void;
  onPlaceTpSl?: (symbol: string, pos: Position, tp: number | null, sl: number | null, pct: number) => void;
  activeTab: string;
  onTabChange: (tab: string) => void;
  onCloseAllPositions?: (symbols: { symbol: string; index: number }[]) => void;
  pricePrecision?: number;
  availableBalance?: number;
}

/** Get display precision for a symbol based on its price magnitude */
function getSymbolPrecision(price: number): number {
  if (price > 10000) return 1;
  if (price > 1000) return 2;
  if (price > 100) return 3;
  if (price > 10) return 4;
  if (price > 1) return 5;
  return 6;
}

export function PositionPanel({
  positionsMap, ordersMap, tradeHistory, priceMap, activeSymbol,
  onClosePosition, onCancelOrder, onAddIsolatedMargin, onClearSymbolData,
  activeTab, onTabChange, onCloseAllPositions, pricePrecision, onPlaceTpSl,
}: Props) {
  const [leverageModal, setLeverageModal] = useState<{ symbol: string; index: number; pos: Position } | null>(null);
  const [tpslModal, setTpslModal] = useState<{ symbol: string; index: number; pos: Position } | null>(null);
  const [closeModal, setCloseModal] = useState<{ symbol: string; index: number; pos: Position } | null>(null);
  const [closingKey, setClosingKey] = useState<string | null>(null);
  const [hideOtherContracts, setHideOtherContracts] = useState(false);
  const [closeAllConfirmOpen, setCloseAllConfirmOpen] = useState(false);
  const [symbolLeverage, setSymbolLeverage] = usePersistedState<Record<string, number>>('symbol_leverage', {});

  // Rollback modal state
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [rollbackSymbol, setRollbackSymbol] = useState<string>('');

  // History sort: 'time' (default, newest first), 'pnl-desc', 'pnl-asc', 'pct-desc', 'pct-asc'
  type HistorySort = 'time' | 'pnl-desc' | 'pnl-asc' | 'pct-desc' | 'pct-asc';
  const [historySort, setHistorySort] = useState<HistorySort>('time');
  const [historySymbolFilter, setHistorySymbolFilter] = useState<string>('ALL');


  const toggleSort = (field: 'pnl' | 'pct') => {
    setHistorySort(prev => {
      if (prev === `${field}-desc`) return `${field}-asc` as HistorySort;
      if (prev === `${field}-asc`) return 'time';
      return `${field}-desc` as HistorySort;
    });
  };

  const getSortIcon = (field: 'pnl' | 'pct') => {
    if (historySort === `${field}-desc`) return <ArrowDown className="inline w-3 h-3 ml-0.5" />;
    if (historySort === `${field}-asc`) return <ArrowUp className="inline w-3 h-3 ml-0.5" />;
    return <ArrowUpDown className="inline w-3 h-3 ml-0.5 opacity-40" />;
  };
  // VIEW-LEVEL SANITIZATION GUARD: drop any dust positions (defends against state leak / float precision)
  const POSITION_DUST_EPSILON = 1e-6;
  const allPositions: { symbol: string; position: Position; index: number }[] = [];
  for (const [sym, positions] of Object.entries(positionsMap)) {
    positions.forEach((pos, i) => {
      if (Number(pos.quantity) > POSITION_DUST_EPSILON) {
        allPositions.push({ symbol: sym, position: pos, index: i });
      }
    });
  }

  const displayedPositions = hideOtherContracts
    ? allPositions.filter(p => p.symbol === activeSymbol)
    : allPositions;

  // Merge positions by symbol + side
  interface MergedPosition {
    symbol: string;
    side: Position['side'];
    totalQuantity: number;
    weightedEntryPrice: number;
    totalMargin: number;
    totalIsolatedMargin: number | null;
    leverage: number;
    marginMode: Position['marginMode'];
    children: { position: Position; index: number }[];
  }

  const mergedPositions = useMemo(() => {
    const groups = new Map<string, MergedPosition>();
    for (const { symbol, position: pos, index } of displayedPositions) {
      const key = `${symbol}_${pos.side}`;
      if (!groups.has(key)) {
        groups.set(key, {
          symbol,
          side: pos.side,
          totalQuantity: 0,
          weightedEntryPrice: 0,
          totalMargin: 0,
          totalIsolatedMargin: null,
          leverage: pos.leverage,
          marginMode: pos.marginMode,
          children: [],
        });
      }
      const g = groups.get(key)!;
      g.weightedEntryPrice = (g.weightedEntryPrice * g.totalQuantity + pos.entryPrice * pos.quantity) / (g.totalQuantity + pos.quantity);
      g.totalQuantity += pos.quantity;
      g.totalMargin += pos.margin;
      if (pos.marginMode === 'isolated' && pos.isolatedMargin != null) {
        g.totalIsolatedMargin = (g.totalIsolatedMargin ?? 0) + pos.isolatedMargin;
      }
      // Use highest leverage in the group
      if (pos.leverage > g.leverage) g.leverage = pos.leverage;
      g.children.push({ position: pos, index });
    }
    return Array.from(groups.values());
  }, [displayedPositions]);

  const allOrders: { symbol: string; order: PendingOrder }[] = [];
  for (const [sym, orders] of Object.entries(ordersMap)) {
    for (const o of orders) allOrders.push({ symbol: sym, order: o });
  }

  const fundingRecords = tradeHistory.filter(t => t.action === 'FUNDING');
  const tradeRecords = tradeHistory.filter(t => t.action === 'CLOSE' || t.action === 'LIQUIDATION');

  const historySymbols = useMemo(() => {
    const syms = new Set<string>();
    for (const t of tradeRecords) { if (t.symbol) syms.add(t.symbol); }
    return Array.from(syms).sort();
  }, [tradeRecords]);

  const allTradedSymbols = useMemo(() => {
    const syms = new Set<string>();
    for (const sym of Object.keys(positionsMap)) {
      if ((positionsMap[sym] || []).length > 0) syms.add(sym);
    }
    for (const sym of Object.keys(ordersMap)) {
      if ((ordersMap[sym] || []).length > 0) syms.add(sym);
    }
    for (const t of tradeHistory) {
      if (t.symbol) syms.add(t.symbol);
    }
    return Array.from(syms).sort();
  }, [positionsMap, ordersMap, tradeHistory]);

  // Compute rollback preview
  const rollbackPreview = useMemo(() => {
    if (!rollbackSymbol) return null;
    const symbolHistory = tradeHistory.filter(t => t.symbol === rollbackSymbol);
    const symbolPositions = positionsMap[rollbackSymbol] || [];
    const symbolOrders = ordersMap[rollbackSymbol] || [];
    let totalPnl = 0;
    let totalFees = 0;
    for (const t of symbolHistory) {
      totalPnl = Math.round((totalPnl + t.pnl) * 1e8) / 1e8;
      totalFees = Math.round((totalFees + t.fee) * 1e8) / 1e8;
    }
    let lockedMargin = 0;
    for (const pos of symbolPositions) {
      lockedMargin += pos.marginMode === 'isolated' && pos.isolatedMargin != null
        ? pos.isolatedMargin : pos.margin;
    }
    return {
      positionCount: symbolPositions.length,
      orderCount: symbolOrders.length,
      historyCount: symbolHistory.length,
      totalPnl,
      totalFees,
      lockedMargin,
      balanceAdjustment: Math.round((lockedMargin - totalPnl + totalFees) * 1e8) / 1e8,
    };
  }, [rollbackSymbol, tradeHistory, positionsMap, ordersMap]);

  const TABS = [
    { key: 'positions', label: '持仓', count: mergedPositions.length },
    { key: 'pending', label: '当前委托', count: allOrders.length },
    { key: 'history', label: '历史记录', count: tradeRecords.length },
    { key: 'funding', label: '资金费', count: fundingRecords.length },
  ];

  const handleOpenCloseModal = (symbol: string, index: number, pos: Position) => {
    setCloseModal({ symbol, index, pos });
  };

  const handleCloseConfirm = (symbol: string, index: number, percentage: number) => {
    onClosePosition(symbol, index, percentage);
  };

  const handleCloseAll = () => {
    if (onCloseAllPositions && displayedPositions.length > 0) {
      onCloseAllPositions(displayedPositions.map(p => ({ symbol: p.symbol, index: p.index })));
      setCloseAllConfirmOpen(false);
      toast.success(`已市价平仓 ${displayedPositions.length} 个仓位`);
    }
  };

  const handleRollbackConfirm = () => {
    if (rollbackSymbol && onClearSymbolData) {
      onClearSymbolData(rollbackSymbol);
      setRollbackOpen(false);
      setRollbackSymbol('');
    }
  };

  /** Get precision for a symbol */
  const getPrecision = (symbol: string): number => {
    if (symbol === activeSymbol && pricePrecision != null) return pricePrecision;
    const price = priceMap[symbol] || 0;
    return price > 0 ? getSymbolPrecision(price) : 2;
  };

  return (
    <div className="panel flex flex-col bg-card">
      {/* Tabs + toolbar */}
      <div className="flex items-center gap-2 px-4 border-b border-border">
        <div className="flex gap-4 flex-1">
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
        {activeTab === 'positions' && (
          <div className="flex items-center gap-3 shrink-0">
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <Checkbox
                checked={hideOtherContracts}
                onCheckedChange={(v) => setHideOtherContracts(!!v)}
                className="h-3.5 w-3.5 border-muted-foreground data-[state=checked]:bg-primary data-[state=checked]:border-primary"
              />
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">隐藏其他合约</span>
            </label>
            {allPositions.length > 0 && (
              <button
                onClick={() => setCloseAllConfirmOpen(true)}
                className="px-2 py-0.5 rounded text-[10px] font-medium border border-destructive/40 text-destructive hover:bg-destructive/10 transition-colors active:scale-95"
              >
                一键平仓
              </button>
            )}
          </div>
        )}
        {activeTab === 'history' && allTradedSymbols.length > 0 && (
          <button
            onClick={() => { setRollbackSymbol(''); setRollbackOpen(true); }}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border border-destructive/40 text-destructive hover:bg-destructive/10 transition-colors active:scale-95 shrink-0"
          >
            <Trash2 className="w-3 h-3" />
            清除币种数据
          </button>
        )}
      </div>

      <div className="overflow-y-auto min-h-[120px]">
        {/* ===== POSITIONS (Card-based, merged by symbol+side) ===== */}
        {activeTab === 'positions' && (
          mergedPositions.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">
              {hideOtherContracts ? `${activeSymbol} 暂无持仓` : '暂无持仓'}
            </div>
          ) : (
            <div className="p-3 space-y-3">
              {mergedPositions.map((mg) => {
                const price = priceMap[mg.symbol] || 0;
                // Aggregate PnL across all children
                let totalPnl = 0;
                for (const c of mg.children) totalPnl += calcUnrealizedPnl(c.position, price);
                const effectiveMargin = mg.totalIsolatedMargin != null ? mg.totalIsolatedMargin : mg.totalMargin;
                const roe = effectiveMargin > 0 ? (totalPnl / effectiveMargin) * 100 : 0;
                const isProfit = totalPnl >= 0;
                const notional = mg.totalQuantity * price;
                const marginRatio = notional > 0 ? ((effectiveMargin + totalPnl) / notional * 100) : 0;
                const baseCoin = mg.symbol.replace('USDT', '');
                const prec = getPrecision(mg.symbol);

                // Compute aggregate liquidation price from the first child (approximation for merged)
                // For merged positions use weighted entry to compute approximate liq
                const syntheticPos: Position = {
                  id: `merged_${mg.symbol}_${mg.side}`,
                  side: mg.side,
                  entryPrice: mg.weightedEntryPrice,
                  quantity: mg.totalQuantity,
                  leverage: mg.leverage,
                  marginMode: mg.marginMode,
                  margin: mg.totalMargin,
                  isolatedMargin: mg.totalIsolatedMargin ?? undefined,
                };
                const liq = calcLiquidationPrice(syntheticPos);

                const handleCloseGroup = (e: React.MouseEvent) => {
                  e.stopPropagation();
                  if (mg.children.length === 1) {
                    handleOpenCloseModal(mg.symbol, mg.children[0].index, mg.children[0].position);
                  } else if (onCloseAllPositions) {
                    onCloseAllPositions(mg.children.map(c => ({ symbol: mg.symbol, index: c.index })));
                    toast.success(`已市价平仓 ${mg.children.length} 个 ${baseCoin} ${mg.side === 'LONG' ? '多' : '空'}仓`);
                  }
                };

                return (
                  <div
                    key={`${mg.symbol}_${mg.side}`}
                    className="rounded-lg border border-border bg-card shadow-sm overflow-hidden"
                  >
                    {/* Header */}
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50">
                      <span className="text-sm font-bold text-foreground font-mono">{baseCoin}</span>
                      <span className="text-xs text-muted-foreground">/&nbsp;USDT 永续</span>
                      <span
                        className={`ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          mg.side === 'LONG'
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : 'bg-red-500/15 text-red-400'
                        }`}
                      >
                        {mg.side === 'LONG' ? '多' : '空'} {mg.leverage}x {mg.marginMode === 'cross' ? '全仓' : '逐仓'}
                      </span>
                      {mg.children.length > 1 && (
                        <span className="text-[9px] text-muted-foreground ml-auto">
                          {mg.children.length} 笔合并
                        </span>
                      )}
                    </div>

                    {/* Hero Stats */}
                    <div className="flex items-start justify-between px-3 py-2.5">
                      <div>
                        <div className="text-[10px] text-muted-foreground mb-0.5">未实现盈亏 (USDT)</div>
                        <div className={`text-lg font-bold font-mono tabular-nums ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                          {formatSignedUSDT(totalPnl)}
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
                      <DetailCell label="持仓数量" value={formatAmount(mg.totalQuantity)} />
                      <DetailCell label="保证金" value={formatUSDT(effectiveMargin)} />
                      <DetailCell label="保证金比率" value={`${marginRatio.toFixed(2)}%`} />
                      <DetailCell label="开仓均价" value={formatPrice(mg.weightedEntryPrice, mg.symbol)} />
                      <DetailCell label="标记价格" value={price > 0 ? formatPrice(price, mg.symbol) : '-'} />
                      <DetailCell label="强平价格" value={formatPrice(liq, mg.symbol)} valueClassName="text-red-400" />
                    </div>

                    {/* TP / SL display strip — aggregated for this group's children */}
                    {(() => {
                      const childIds = new Set(mg.children.map(c => c.position.id));
                      const groupOrders = (ordersMap[mg.symbol] || []).filter(
                        o => o.reduceOnly && o.linkedPositionId && childIds.has(o.linkedPositionId)
                      );
                      const tps = groupOrders.filter(o => o.reduceKind === 'TP');
                      const sls = groupOrders.filter(o => o.reduceKind === 'SL');
                      if (tps.length === 0 && sls.length === 0) return null;
                      const fmtList = (arr: typeof groupOrders) =>
                        arr.map(o => formatPrice(o.stopPrice, mg.symbol)).join(' / ');
                      return (
                        <div className="flex items-center gap-3 px-3 pb-2 text-[10px] font-mono tabular-nums">
                          {tps.length > 0 && (
                            <span className="flex items-center gap-1">
                              <span className="text-muted-foreground">止盈</span>
                              <span className="text-emerald-400">{fmtList(tps)}</span>
                            </span>
                          )}
                          {sls.length > 0 && (
                            <span className="flex items-center gap-1">
                              <span className="text-muted-foreground">止损</span>
                              <span className="text-red-400">{fmtList(sls)}</span>
                            </span>
                          )}
                        </div>
                      );
                    })()}

                    {/* Action Buttons */}
                    <div className="flex border-t border-border/50">
                      <ActionBtn label="止盈/止损" onClick={(e) => {
                        e.stopPropagation();
                        // Apply TP/SL to the first child position
                        const first = mg.children[0];
                        setTpslModal({ symbol: mg.symbol, index: first.index, pos: first.position });
                      }} />
                      <ActionBtn
                        label={mg.children.length > 1 ? '全部平仓' : '平仓'}
                        danger
                        onClick={handleCloseGroup}
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
                  {['合约', '类型', '方向', '价格', '触发价', '数量', '杠杆', '模式', '操作'].map(h => (
                    <th key={h} className="px-3 py-1.5 text-left font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allOrders.map(({ symbol, order }) => {
                  return (
                    <tr key={order.id} className="border-b border-border/30 hover:bg-accent/20">
                      <td className="px-3 py-2">
                        <span className="text-foreground font-medium">{symbol.replace('USDT', '')}</span>
                        <span className="text-muted-foreground text-[10px]">/USDT</span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {order.reduceOnly && order.reduceKind === 'TP' ? (
                            <span className="font-bold text-emerald-400">止盈</span>
                          ) : order.reduceOnly && order.reduceKind === 'SL' ? (
                            <span className="font-bold text-red-400">止损</span>
                          ) : (
                            <span>
                              {({ LIMIT: '限价', POST_ONLY: '只做Maker', MARKET: '市价', LIMIT_TP_SL: '限价TP/SL', MARKET_TP_SL: '市价TP/SL', CONDITIONAL: '条件', TRAILING_STOP: '跟踪', TWAP: 'TWAP', SCALED: '分段' } as Record<string, string>)[order.type] || order.type}
                            </span>
                          )}
                          {order.reduceOnly && (
                            <span className="text-[9px] px-1 py-0 rounded bg-muted text-muted-foreground border border-border whitespace-nowrap">
                              只减仓
                            </span>
                          )}
                        </div>
                      </td>
                      <td className={`px-3 py-2 font-bold ${order.side === 'LONG' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {order.side === 'LONG' ? '多' : '空'}
                      </td>
                      <td className="px-3 py-2">
                        {order.reduceOnly ? (
                          <span className="text-muted-foreground">市价平仓</span>
                        ) : order.price > 0 ? formatPrice(order.price, symbol) : '市价'}
                      </td>
                      <td className="px-3 py-2">
                        {order.stopPrice > 0 ? (
                          <span className={order.reduceKind === 'TP' ? 'text-emerald-400' : order.reduceKind === 'SL' ? 'text-red-400' : 'text-amber-400'}>
                            {formatPrice(order.stopPrice, symbol)}
                          </span>
                        ) : '-'}
                      </td>
                      <td className="px-3 py-2">{formatUSDT((order.price > 0 ? order.price : (priceMap[symbol] || 0)) * order.quantity)} USDT</td>
                      <td className="px-3 py-2">{order.leverage}x</td>
                      <td className="px-3 py-2">
                        <Badge
                          variant={order.marginMode === 'cross' ? 'default' : 'secondary'}
                          className="text-[9px] px-1.5 py-0"
                        >
                          {order.marginMode === 'cross' ? '全仓' : '逐仓'}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => onCancelOrder(symbol, order.id)}
                          className="p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
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
                  <th className="px-3 py-1.5 text-left font-medium whitespace-nowrap">
                    <select
                      value={historySymbolFilter}
                      onChange={e => setHistorySymbolFilter(e.target.value)}
                      className="bg-transparent border border-border rounded px-1 py-0.5 text-[11px] text-muted-foreground cursor-pointer outline-none"
                    >
                      <option value="ALL">全部合约</option>
                      {historySymbols.map(s => (
                        <option key={s} value={s}>{s.replace('USDT', '/USDT')}</option>
                      ))}
                    </select>
                  </th>
                  {['操作', '方向', '开仓价', '平仓价', '数量', '开仓时间', '平仓时间'].map(h => (
                    <th key={h} className="px-3 py-1.5 text-left font-medium whitespace-nowrap">{h}</th>
                  ))}
                  <th className="px-3 py-1.5 text-left font-medium whitespace-nowrap cursor-pointer select-none" onClick={() => toggleSort('pnl')}>
                    盈亏{getSortIcon('pnl')}
                  </th>
                  <th className="px-3 py-1.5 text-left font-medium whitespace-nowrap cursor-pointer select-none" onClick={() => toggleSort('pct')}>
                    盈亏%{getSortIcon('pct')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  let sorted = tradeRecords.slice().reverse();
                  if (historySymbolFilter !== 'ALL') sorted = sorted.filter(t => t.symbol === historySymbolFilter);
                  if (historySort === 'pnl-desc') sorted.sort((a, b) => b.pnl - a.pnl);
                  else if (historySort === 'pnl-asc') sorted.sort((a, b) => a.pnl - b.pnl);
                  else if (historySort === 'pct-desc' || historySort === 'pct-asc') {
                    const pct = (t: typeof sorted[0]) => { const m = (t.quantity * t.entryPrice) / t.leverage; return m > 0 ? t.pnl / m : 0; };
                    sorted.sort((a, b) => historySort === 'pct-desc' ? pct(b) - pct(a) : pct(a) - pct(b));
                  }
                  return sorted.slice(0, 50);
                })().map(t => (
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
                    <td className="px-3 py-2">{t.entryPrice.toPrecision(6)}</td>
                    <td className="px-3 py-2">{t.exitPrice > 0 ? t.exitPrice.toPrecision(6) : '-'}</td>
                    <td className="px-3 py-2">{(t.quantity * t.entryPrice).toFixed(2)} USDT</td>
                    <td className="px-3 py-2 text-muted-foreground">{t.openTime && t.openTime > 0 ? new Date(t.openTime).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-'}</td>
                    <td className="px-3 py-2 text-muted-foreground">{t.closeTime ? new Date(t.closeTime).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-'}</td>
                    <td className={`px-3 py-2 font-bold ${t.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {t.pnl >= 0 ? '+' : ''}{t.pnl.toFixed(2)}
                    </td>
                    {(() => {
                      const margin = (t.quantity * t.entryPrice) / t.leverage;
                      const pct = margin > 0 ? (t.pnl / margin) * 100 : 0;
                      return (
                        <td className={`px-3 py-2 font-bold ${pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                        </td>
                      );
                    })()}
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
          symbol={leverageModal.symbol}
          currentLeverage={leverageModal.pos.leverage}
          notional={leverageModal.pos.entryPrice * leverageModal.pos.quantity}
          onClose={() => setLeverageModal(null)}
          onConfirm={(newLev) => {
            setSymbolLeverage(prev => ({ ...prev, [leverageModal.symbol]: newLev }));
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
            if (onPlaceTpSl) {
              onPlaceTpSl(tpslModal.symbol, tpslModal.pos, tp, sl, pct);
            }
            setTpslModal(null);
          }}
        />
      )}
      {closeModal && (
        <ClosePositionModal
          open={!!closeModal}
          onClose={() => setCloseModal(null)}
          symbol={closeModal.symbol}
          position={closeModal.pos}
          posIndex={closeModal.index}
          currentPrice={priceMap[closeModal.symbol] || 0}
          pricePrecision={getPrecision(closeModal.symbol)}
          onConfirm={handleCloseConfirm}
        />
      )}

      <Dialog open={closeAllConfirmOpen} onOpenChange={setCloseAllConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>确认全平</DialogTitle>
            <DialogDescription>
              将以市价强制平仓当前列表中的所有 <span className="font-bold text-foreground">{displayedPositions.length}</span> 个仓位，请确认。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setCloseAllConfirmOpen(false)}>
              取消
            </Button>
            <Button variant="destructive" size="sm" onClick={handleCloseAll}>
              确认全平
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== ROLLBACK DANGER MODAL ===== */}
      <AlertDialog open={rollbackOpen} onOpenChange={setRollbackOpen}>
        <AlertDialogContent className="sm:max-w-md border-destructive/30">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="w-5 h-5" />
              清除特定币种数据
            </AlertDialogTitle>
            <AlertDialogDescription>
              此操作将<span className="text-destructive font-bold">不可逆地</span>清除选定币种的所有持仓、委托和历史记录，并将账户余额精确回滚至该币种从未交易过的状态。
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">选择币种</label>
              <Select value={rollbackSymbol} onValueChange={setRollbackSymbol}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="请选择要清除的币种..." />
                </SelectTrigger>
                <SelectContent>
                  {allTradedSymbols.map(sym => (
                    <SelectItem key={sym} value={sym}>
                      {sym.replace('USDT', '/USDT')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {rollbackPreview && (
              <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3 space-y-1.5 text-xs font-mono">
                <div className="text-[10px] font-sans font-medium text-destructive mb-2">回滚预览</div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">待平仓位</span>
                  <span className="text-foreground">{rollbackPreview.positionCount} 个</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">待撤委托</span>
                  <span className="text-foreground">{rollbackPreview.orderCount} 个</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">待删历史</span>
                  <span className="text-foreground">{rollbackPreview.historyCount} 条</span>
                </div>
                <div className="border-t border-border/50 my-1" />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">该币种总盈亏</span>
                  <span className={rollbackPreview.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                    {rollbackPreview.totalPnl >= 0 ? '+' : ''}{rollbackPreview.totalPnl.toFixed(4)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">该币种总手续费</span>
                  <span className="text-amber-400">{rollbackPreview.totalFees.toFixed(4)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">锁定保证金</span>
                  <span className="text-foreground">{rollbackPreview.lockedMargin.toFixed(2)}</span>
                </div>
                <div className="border-t border-border/50 my-1" />
                <div className="flex justify-between font-bold">
                  <span className="text-foreground">余额调整</span>
                  <span className={rollbackPreview.balanceAdjustment >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                    {rollbackPreview.balanceAdjustment >= 0 ? '+' : ''}{rollbackPreview.balanceAdjustment.toFixed(4)} USDT
                  </span>
                </div>
              </div>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={!rollbackSymbol}
              onClick={handleRollbackConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              确认清除并回滚
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
