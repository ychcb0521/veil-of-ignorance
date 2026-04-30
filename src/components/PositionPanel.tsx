import { useState, useMemo } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
import type { Position, PendingOrder, TradeRecord } from '@/types/trading';
import { calcUnrealizedPnl, calcROE, calcLiquidationPrice, MAINTENANCE_MARGIN_RATE } from '@/types/trading';
import type { PositionsMap, OrdersMap, PriceMap } from '@/contexts/TradingContext';
import { X, Trash2, ArrowUpDown, ArrowUp, ArrowDown, Plus, MoreVertical, ChevronDown, ChevronRight, GripVertical } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { toast } from 'sonner';
import { LeverageModal } from '@/components/LeverageModal';
import { TpSlModal } from '@/components/TpSlModal';
import { ClosePositionModal } from '@/components/ClosePositionModal';
import { AdjustMarginModal } from '@/components/AdjustMarginModal';
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
  onAdjustMargin?: (symbol: string, posIndex: number, signedDelta: number) => void;
  availableBalance?: number;
  balance?: number;
  initialCapital?: number;
  onClearSymbolData?: (symbol: string) => void;
  onPlaceTpSl?: (symbol: string, pos: Position, tp: number | null, sl: number | null, pct: number) => void;
  activeTab: string;
  onTabChange: (tab: string) => void;
  onCloseAllPositions?: (symbols: { symbol: string; index: number }[]) => void;
  pricePrecision?: number;
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
  onClosePosition, onCancelOrder, onAddIsolatedMargin, onAdjustMargin, availableBalance = 0, balance = 0, initialCapital = 1_000_000,
  onClearSymbolData,
  activeTab, onTabChange, onCloseAllPositions, pricePrecision, onPlaceTpSl,
}: Props) {
  const [leverageModal, setLeverageModal] = useState<{ symbol: string; index: number; pos: Position } | null>(null);
  const [tpslModal, setTpslModal] = useState<{ symbol: string; index: number; pos: Position } | null>(null);
  const [closeModal, setCloseModal] = useState<{ symbol: string; index: number; pos: Position } | null>(null);
  const [adjustMarginModal, setAdjustMarginModal] = useState<{ symbol: string; index: number; pos: Position } | null>(null);
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
    { key: 'positions', label: '仓位', count: mergedPositions.length, showCount: true },
    { key: 'pending', label: '当前委托', count: allOrders.length, showCount: true },
    { key: 'history', label: '历史委托', count: 0, showCount: false },
    { key: 'trades', label: '历史成交', count: tradeRecords.length, showCount: false },
    { key: 'funding', label: '资金流水', count: fundingRecords.length, showCount: false },
    { key: 'positionHistory', label: '仓位历史记录', count: 0, showCount: false },
    { key: 'bots', label: '机器人', count: 0, showCount: false },
    { key: 'assets', label: '资产', count: 0, showCount: false },
  ];

  // Column definitions for the positions table header
  // `key` is used to bind to columnVisibility state.
  // `hiddenByDefault` means it lives in the "隐藏栏" section of the menu and is OFF by default.
  const POSITION_COLUMNS: { key: string; label: string; flex: string; align: string; locked?: boolean; hiddenByDefault?: boolean }[] = [
    { key: 'symbol', label: '合约', flex: 'flex-[1.4]', align: 'text-left', locked: true },
    { key: 'quantity', label: '数量', flex: 'flex-1', align: 'text-right' },
    { key: 'entryPrice', label: '开仓价格', flex: 'flex-1', align: 'text-right' },
    { key: 'breakEven', label: '损益两平价', flex: 'flex-1', align: 'text-right' },
    { key: 'markPrice', label: '标记价格', flex: 'flex-1', align: 'text-right' },
    { key: 'liqPrice', label: '强平价格', flex: 'flex-1', align: 'text-right' },
    { key: 'marginRatio', label: '保证金比率', flex: 'flex-1', align: 'text-right' },
    { key: 'margin', label: '保证金', flex: 'flex-1', align: 'text-right' },
    { key: 'pnl', label: '盈亏 (回报率)', flex: 'flex-[1.2]', align: 'text-right' },
    { key: 'funding', label: '预估资金费用', flex: 'flex-1', align: 'text-right' },
    { key: 'action', label: '市价 / 限价', flex: 'flex-[1.2]', align: 'text-right' },
    { key: 'notional', label: '仓位面值', flex: 'flex-1', align: 'text-right', hiddenByDefault: true },
    { key: 'adl', label: '自动减仓', flex: 'flex-1', align: 'text-right', hiddenByDefault: true },
  ];

  type ColumnKey = string;
  const [columnVisibility, setColumnVisibility] = usePersistedState<Record<string, boolean>>(
    'position_column_visibility',
    POSITION_COLUMNS.reduce((acc, c) => {
      acc[c.key] = !c.hiddenByDefault;
      return acc;
    }, {} as Record<string, boolean>)
  );
  const [actionGroupExpanded, setActionGroupExpanded] = useState(true);
  const [actionSubOptions, setActionSubOptions] = usePersistedState<Record<string, boolean>>(
    'position_action_suboptions',
    { marketCloseAll: true, pnlCloseAll: false }
  );

  const toggleColumn = (key: ColumnKey) => {
    setColumnVisibility(prev => ({ ...prev, [key]: !prev[key] }));
  };
  const toggleSubOption = (key: string) => {
    setActionSubOptions(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const visibleColumns = POSITION_COLUMNS.filter(c => columnVisibility[c.key] !== false);
  const regularColumns = POSITION_COLUMNS.filter(c => !c.hiddenByDefault);
  const hiddenSectionColumns = POSITION_COLUMNS.filter(c => c.hiddenByDefault);

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
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-white dark:bg-[#1e2329]">
      {/* ===== Tabs Bar ===== */}
      <div className="flex justify-between items-center px-4 h-10 border-b border-gray-200 dark:border-[#2b3139] shrink-0">
        <div className="flex space-x-6 flex-1 overflow-x-auto h-full items-center">
          {TABS.map(t => {
            const isActive = activeTab === t.key;
            const labelText = t.showCount ? `${t.label}(${t.count})` : t.label;
            return (
              <button
                key={t.key}
                onClick={() => onTabChange(t.key)}
                className={`relative h-full text-sm font-medium whitespace-nowrap transition-colors ${
                  isActive
                    ? 'text-[#fcd535]'
                    : 'text-gray-500 dark:text-[#848e9c] hover:text-gray-900 dark:text-white'
                }`}
              >
                {labelText}
                {isActive && (
                  <span className="absolute left-0 right-0 -bottom-px h-[2px] bg-[#fcd535]" />
                )}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-3 shrink-0 pl-4">
          {activeTab === 'positions' && (
            <>
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <Checkbox
                  checked={hideOtherContracts}
                  onCheckedChange={(v) => setHideOtherContracts(!!v)}
                  className="h-3.5 w-3.5 border-[#5e6673] data-[state=checked]:bg-[#fcd535] data-[state=checked]:border-[#fcd535] data-[state=checked]:text-[#0b0e11]"
                />
                <span className="text-xs text-gray-500 dark:text-[#848e9c] whitespace-nowrap">隐藏其他合约</span>
              </label>
              {allPositions.length > 0 && (
                <button
                  onClick={() => setCloseAllConfirmOpen(true)}
                  className="px-2 py-0.5 rounded text-[10px] font-medium border border-[#f6465d]/50 text-[#f6465d] hover:bg-[#f6465d]/10 transition-colors active:scale-95"
                >
                  一键平仓
                </button>
              )}
            </>
          )}
          {activeTab === 'trades' && allTradedSymbols.length > 0 && (
            <button
              onClick={() => { setRollbackSymbol(''); setRollbackOpen(true); }}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border border-[#f6465d]/50 text-[#f6465d] hover:bg-[#f6465d]/10 transition-colors active:scale-95 shrink-0"
            >
              <Trash2 className="w-3 h-3" />
              清除币种数据
            </button>
          )}
          {/* Window controls — uniform across all panels */}
          <div className="flex items-center space-x-3 text-[#848e9c] pl-1 border-l border-gray-200 dark:border-[#2b3139] ml-1">
            <button type="button" title="设置" className="hover:text-gray-900 dark:hover:text-white cursor-pointer transition-colors">
              <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
                <circle cx="8" cy="8" r="2" />
                <path strokeLinecap="round" d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.8 3.8l1 1M11.2 11.2l1 1M3.8 12.2l1-1M11.2 4.8l1-1" />
              </svg>
            </button>
            <button type="button" title="最小化" className="hover:text-gray-900 dark:hover:text-white cursor-pointer transition-colors">
              <svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M3 11h8" />
              </svg>
            </button>
            <button type="button" title="更多" className="hover:text-gray-900 dark:hover:text-white cursor-pointer transition-colors">
              <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
                <circle cx="8" cy="3" r="1.2" /><circle cx="8" cy="8" r="1.2" /><circle cx="8" cy="13" r="1.2" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        {/* ===== POSITIONS — always-visible header + body ===== */}
        {activeTab === 'positions' && (
          <>
            {/* Persistent table header */}
            <div className="h-8 flex items-center px-4 text-xs text-gray-500 dark:text-[#848e9c] border-b border-gray-200 dark:border-[#2b3139] shrink-0 overflow-x-auto">
              {visibleColumns.map((col) => (
                <div key={col.key} className={`${col.flex} ${col.align} whitespace-nowrap px-2`}>
                  {col.label}
                </div>
              ))}
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto scrollbar-pro min-h-0">
              {mergedPositions.length === 0 ? (
                <div className="py-20 flex flex-col items-center justify-center text-gray-500 dark:text-[#848e9c] text-sm gap-2">
                  <svg className="w-10 h-10 opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
                    <rect x="3" y="5" width="18" height="14" rx="2" />
                    <path d="M3 10h18" />
                    <path d="M9 15h6" />
                  </svg>
                  <span>{hideOtherContracts ? `${activeSymbol} 暂无持仓` : '暂无持仓'}</span>
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
                            ? 'bg-trading-green/15 text-trading-green'
                            : 'bg-trading-red/15 text-trading-red'
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
                        <div className={`text-lg font-bold font-mono tabular-nums ${isProfit ? 'text-trading-green' : 'text-trading-red'}`}>
                          {formatSignedUSDT(totalPnl)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-muted-foreground mb-0.5">ROE</div>
                        <div className={`text-lg font-bold font-mono tabular-nums ${isProfit ? 'text-trading-green' : 'text-trading-red'}`}>
                          {isProfit ? '+' : ''}{roe.toFixed(2)}%
                        </div>
                      </div>
                    </div>

                    {/* Details Grid */}
                    <div className="grid grid-cols-3 gap-x-4 gap-y-2 px-3 pb-2.5">
                      <DetailCell label="持仓数量" value={formatAmount(mg.totalQuantity)} />
                      <div className="min-w-0">
                        <div className="text-[10px] text-muted-foreground truncate">保证金</div>
                        <div className="flex items-center gap-1">
                          <span className="text-xs font-mono tabular-nums text-foreground">
                            {formatUSDT(effectiveMargin)}
                          </span>
                          {mg.marginMode === 'isolated' && mg.children.length === 1 && onAdjustMargin && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                const first = mg.children[0];
                                setAdjustMarginModal({ symbol: mg.symbol, index: first.index, pos: first.position });
                              }}
                              title="调整保证金"
                              className="inline-flex items-center justify-center w-4 h-4 rounded border border-border bg-muted/40 hover:bg-primary/20 hover:border-primary/60 text-muted-foreground hover:text-primary transition-colors active:scale-95"
                            >
                              <Plus className="w-2.5 h-2.5" strokeWidth={3} />
                            </button>
                          )}
                        </div>
                      </div>
                      <DetailCell label="保证金比率" value={`${marginRatio.toFixed(2)}%`} />
                      <DetailCell label="开仓均价" value={formatPrice(mg.weightedEntryPrice, mg.symbol)} />
                      <DetailCell label="标记价格" value={price > 0 ? formatPrice(price, mg.symbol) : '-'} />
                      <DetailCell
                        key={`liq-${mg.totalIsolatedMargin ?? mg.totalMargin}-${mg.totalQuantity}-${mg.weightedEntryPrice}`}
                        label="强平价格"
                        value={isFinite(liq) ? formatPrice(liq, mg.symbol) : '--'}
                        valueClassName="text-trading-red"
                      />
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
                              <span className="text-trading-green">{fmtList(tps)}</span>
                            </span>
                          )}
                          {sls.length > 0 && (
                            <span className="flex items-center gap-1">
                              <span className="text-muted-foreground">止损</span>
                              <span className="text-trading-red">{fmtList(sls)}</span>
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
              )}
            </div>
          </>
        )}

        {/* ===== PENDING ORDERS ===== */}
        {activeTab === 'pending' && (
          <div className="flex-1 overflow-y-auto scrollbar-pro min-h-0">
            {allOrders.length === 0 ? (
              <div className="px-4 py-20 text-center text-xs text-gray-500 dark:text-[#848e9c]">暂无委托</div>
            ) : (
              <table className="w-full text-[11px] font-mono tabular-nums">
                <thead className="sticky top-0 bg-white dark:bg-[#1e2329] z-10">
                  <tr className="text-gray-500 dark:text-[#848e9c] border-b border-gray-200 dark:border-[#2b3139]">
                    {['合约', '类型', '方向', '价格', '触发价', '数量', '杠杆', '模式', '操作'].map(h => (
                      <th key={h} className="px-3 py-1.5 text-left font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allOrders.map(({ symbol, order }) => {
                    return (
                      <tr key={order.id} className="border-b border-gray-100 dark:border-[#2b3139]/50 hover:bg-gray-50 dark:hover:bg-white/5">
                        <td className="px-3 py-2">
                          <span className="text-gray-900 dark:text-white font-medium">{symbol.replace('USDT', '')}</span>
                          <span className="text-gray-500 dark:text-[#848e9c] text-[10px]">/USDT</span>
                        </td>
                        <td className="px-3 py-2 text-gray-500 dark:text-[#848e9c]">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {order.reduceOnly && order.reduceKind === 'TP' ? (
                              <span className="font-bold text-[#0ecb81]">止盈</span>
                            ) : order.reduceOnly && order.reduceKind === 'SL' ? (
                              <span className="font-bold text-[#f6465d]">止损</span>
                            ) : (
                              <span>
                                {({ LIMIT: '限价', POST_ONLY: '只做Maker', MARKET: '市价', LIMIT_TP_SL: '限价TP/SL', MARKET_TP_SL: '市价TP/SL', CONDITIONAL: '条件', TRAILING_STOP: '跟踪', TWAP: 'TWAP', SCALED: '分段' } as Record<string, string>)[order.type] || order.type}
                              </span>
                            )}
                            {order.reduceOnly && (
                              <span className="text-[9px] px-1 py-0 rounded bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-[#848e9c] border border-gray-200 dark:border-[#2b3139] whitespace-nowrap">
                                只减仓
                              </span>
                            )}
                          </div>
                        </td>
                        <td className={`px-3 py-2 font-bold ${order.side === 'LONG' ? 'text-[#0ecb81]' : 'text-[#f6465d]'}`}>
                          {order.side === 'LONG' ? '多' : '空'}
                        </td>
                        <td className="px-3 py-2 text-gray-900 dark:text-white">
                          {order.reduceOnly ? (
                            <span className="text-gray-500 dark:text-[#848e9c]">市价平仓</span>
                          ) : order.price > 0 ? formatPrice(order.price, symbol) : '市价'}
                        </td>
                        <td className="px-3 py-2 text-gray-900 dark:text-white">
                          {order.stopPrice > 0 ? (
                            <span className={order.reduceKind === 'TP' ? 'text-[#0ecb81]' : order.reduceKind === 'SL' ? 'text-[#f6465d]' : 'text-amber-400'}>
                              {formatPrice(order.stopPrice, symbol)}
                            </span>
                          ) : '-'}
                        </td>
                        <td className="px-3 py-2 text-gray-900 dark:text-white">{formatUSDT((order.price > 0 ? order.price : (priceMap[symbol] || 0)) * order.quantity)} USDT</td>
                        <td className="px-3 py-2 text-gray-900 dark:text-white">{order.leverage}x</td>
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
                            className="p-0.5 rounded hover:bg-[#f6465d]/20 text-gray-500 dark:text-[#848e9c] hover:text-[#f6465d] transition-colors"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ===== HISTORY (历史委托) ===== */}
        {activeTab === 'history' && (
          <div className="flex-1 overflow-y-auto scrollbar-pro min-h-0">
            {tradeRecords.length === 0 ? (
              <div className="px-4 py-20 text-center text-xs text-gray-500 dark:text-[#848e9c]">暂无历史记录</div>
            ) : (
              <table className="w-full text-[11px] font-mono tabular-nums">
                <thead className="sticky top-0 bg-white dark:bg-[#1e2329] z-10">
                  <tr className="text-gray-500 dark:text-[#848e9c] border-b border-gray-200 dark:border-[#2b3139]">
                    <th className="px-3 py-1.5 text-left font-medium whitespace-nowrap">
                      <select
                        value={historySymbolFilter}
                        onChange={e => setHistorySymbolFilter(e.target.value)}
                        className="bg-transparent border border-gray-200 dark:border-[#2b3139] rounded px-1 py-0.5 text-[11px] text-gray-500 dark:text-[#848e9c] cursor-pointer outline-none"
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
                    return sorted.slice(0, 100);
                  })().map(t => (
                    <tr key={t.id} className="border-b border-gray-100 dark:border-[#2b3139]/50">
                      <td className="px-3 py-2 text-gray-900 dark:text-white">{t.symbol?.replace('USDT', '/USDT') || '-'}</td>
                      <td className="px-3 py-2">
                        <span className={`text-[10px] px-1 py-0.5 rounded ${
                          t.action === 'LIQUIDATION' ? 'bg-[#f6465d]/20 text-[#f6465d]' :
                          t.action === 'OPEN' ? 'bg-[#fcd535]/20 text-[#fcd535]' : 'bg-gray-100 dark:bg-white/5 text-gray-900 dark:text-white'
                        }`}>
                          {t.action === 'LIQUIDATION' ? '💀爆仓' : t.action === 'OPEN' ? '开仓' : '平仓'}
                        </span>
                      </td>
                      <td className={`px-3 py-2 font-bold ${t.side === 'LONG' ? 'text-[#0ecb81]' : 'text-[#f6465d]'}`}>
                        {t.side === 'LONG' ? '多' : '空'} {t.leverage}x
                      </td>
                      <td className="px-3 py-2 text-gray-900 dark:text-white">{formatPrice(t.entryPrice, t.symbol)}</td>
                      <td className="px-3 py-2 text-gray-900 dark:text-white">{t.exitPrice > 0 ? formatPrice(t.exitPrice, t.symbol) : '-'}</td>
                      <td className="px-3 py-2 text-gray-900 dark:text-white">{(t.quantity * t.entryPrice).toFixed(2)} USDT</td>
                      <td className="px-3 py-2 text-gray-500 dark:text-[#848e9c]">{t.openTime && t.openTime > 0 ? new Date(t.openTime).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-'}</td>
                      <td className="px-3 py-2 text-gray-500 dark:text-[#848e9c]">{t.closeTime ? new Date(t.closeTime).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-'}</td>
                      <td className={`px-3 py-2 font-bold ${t.pnl >= 0 ? 'text-[#0ecb81]' : 'text-[#f6465d]'}`}>
                        {t.pnl >= 0 ? '+' : ''}{t.pnl.toFixed(2)}
                      </td>
                      {(() => {
                        const margin = (t.quantity * t.entryPrice) / t.leverage;
                        const pct = margin > 0 ? (t.pnl / margin) * 100 : 0;
                        return (
                          <td className={`px-3 py-2 font-bold ${pct >= 0 ? 'text-[#0ecb81]' : 'text-[#f6465d]'}`}>
                            {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                          </td>
                        );
                      })()}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ===== TRADE HISTORY (历史成交) ===== */}
        {activeTab === 'trades' && (
          <div className="flex-1 overflow-y-auto scrollbar-pro min-h-0">
            {tradeRecords.length === 0 ? (
              <div className="px-4 py-20 text-center text-xs text-gray-500 dark:text-[#848e9c]">暂无历史成交</div>
            ) : (
              <table className="w-full text-[11px] font-mono tabular-nums">
                <thead className="sticky top-0 bg-white dark:bg-[#1e2329] z-10">
                  <tr className="text-gray-500 dark:text-[#848e9c] border-b border-gray-200 dark:border-[#2b3139]">
                    {['时间', '合约', '方向', '成交价', '成交数量', '已实现盈亏'].map(h => (
                      <th key={h} className="px-3 py-1.5 text-left font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tradeRecords.slice().reverse().slice(0, 100).map(t => {
                    const ts = t.closeTime || t.openTime;
                    const isLong = t.side === 'LONG';
                    // Closing a LONG = sell; closing a SHORT = buy
                    const dirLabel = isLong ? '卖出平多' : '买入平空';
                    const dirColor = isLong ? 'text-[#f6465d]' : 'text-[#0ecb81]';
                    return (
                      <tr key={t.id} className="border-b border-gray-100 dark:border-[#2b3139]/50">
                        <td className="px-3 py-2 text-gray-500 dark:text-[#848e9c]">
                          {ts ? new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-'}
                        </td>
                        <td className="px-3 py-2 text-gray-900 dark:text-white">{t.symbol?.replace('USDT', '/USDT') || '-'}</td>
                        <td className={`px-3 py-2 font-bold ${dirColor}`}>{dirLabel}</td>
                        <td className="px-3 py-2 text-gray-900 dark:text-white">{formatPrice(t.exitPrice > 0 ? t.exitPrice : t.entryPrice, t.symbol)}</td>
                        <td className="px-3 py-2 text-gray-900 dark:text-white">{formatAmount(t.quantity)}</td>
                        <td className={`px-3 py-2 font-bold ${t.pnl >= 0 ? 'text-[#0ecb81]' : 'text-[#f6465d]'}`}>
                          {formatSignedUSDT(t.pnl)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ===== POSITION HISTORY (仓位历史记录) ===== */}
        {activeTab === 'positionHistory' && (
          <div className="flex-1 overflow-y-auto scrollbar-pro min-h-0">
            {tradeRecords.length === 0 ? (
              <div className="px-4 py-20 text-center text-xs text-gray-500 dark:text-[#848e9c]">暂无仓位历史记录</div>
            ) : (
              <table className="w-full text-[11px] font-mono tabular-nums">
                <thead className="sticky top-0 bg-white dark:bg-[#1e2329] z-10">
                  <tr className="text-gray-500 dark:text-[#848e9c] border-b border-gray-200 dark:border-[#2b3139]">
                    {['合约', '方向', '开仓均价', '平仓均价', '数量', '开仓时间', '平仓时间', '平仓盈亏', '收益率(ROE)'].map(h => (
                      <th key={h} className="px-3 py-1.5 text-left font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tradeRecords.slice().reverse().slice(0, 100).map(t => {
                    const margin = (t.quantity * t.entryPrice) / t.leverage;
                    const roe = margin > 0 ? (t.pnl / margin) * 100 : 0;
                    return (
                      <tr key={t.id} className="border-b border-gray-100 dark:border-[#2b3139]/50">
                        <td className="px-3 py-2 text-gray-900 dark:text-white">{t.symbol?.replace('USDT', '/USDT') || '-'}</td>
                        <td className={`px-3 py-2 font-bold ${t.side === 'LONG' ? 'text-[#0ecb81]' : 'text-[#f6465d]'}`}>
                          {t.side === 'LONG' ? '多' : '空'} {t.leverage}x
                        </td>
                        <td className="px-3 py-2 text-gray-900 dark:text-white">{formatPrice(t.entryPrice, t.symbol)}</td>
                        <td className="px-3 py-2 text-gray-900 dark:text-white">{t.exitPrice > 0 ? formatPrice(t.exitPrice, t.symbol) : '-'}</td>
                        <td className="px-3 py-2 text-gray-900 dark:text-white">{formatAmount(t.quantity)}</td>
                        <td className="px-3 py-2 text-gray-500 dark:text-[#848e9c]">
                          {t.openTime && t.openTime > 0 ? new Date(t.openTime).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-'}
                        </td>
                        <td className="px-3 py-2 text-gray-500 dark:text-[#848e9c]">
                          {t.closeTime ? new Date(t.closeTime).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-'}
                        </td>
                        <td className={`px-3 py-2 font-bold ${t.pnl >= 0 ? 'text-[#0ecb81]' : 'text-[#f6465d]'}`}>
                          {formatSignedUSDT(t.pnl)}
                        </td>
                        <td className={`px-3 py-2 font-bold ${roe >= 0 ? 'text-[#0ecb81]' : 'text-[#f6465d]'}`}>
                          {roe >= 0 ? '+' : ''}{roe.toFixed(2)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ===== FUNDING (资金流水) ===== */}
        {activeTab === 'funding' && (
          <div className="flex-1 overflow-y-auto scrollbar-pro min-h-0">
            {fundingRecords.length === 0 ? (
              <div className="px-4 py-20 text-center text-xs text-gray-500 dark:text-[#848e9c]">
                暂无资金费记录 · 每 8 小时结算 (00:00, 08:00, 16:00 UTC)
              </div>
            ) : (
              <table className="w-full text-[11px] font-mono tabular-nums">
                <thead className="sticky top-0 bg-white dark:bg-[#1e2329] z-10">
                  <tr className="text-gray-500 dark:text-[#848e9c] border-b border-gray-200 dark:border-[#2b3139]">
                    {['时间', '合约', '方向', '名义价值', '费率', '金额'].map(h => (
                      <th key={h} className="px-3 py-1.5 text-left font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fundingRecords.slice().reverse().slice(0, 100).map(t => (
                    <tr key={t.id} className="border-b border-gray-100 dark:border-[#2b3139]/50">
                      <td className="px-3 py-2 text-gray-500 dark:text-[#848e9c]">
                        {new Date(t.openTime).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-gray-900 dark:text-white">{t.symbol?.replace('USDT', '/USDT')}</td>
                      <td className={`px-3 py-2 font-bold ${t.side === 'LONG' ? 'text-[#0ecb81]' : 'text-[#f6465d]'}`}>
                        {t.side === 'LONG' ? '多' : '空'}
                      </td>
                      <td className="px-3 py-2 text-gray-900 dark:text-white">{(t.entryPrice * t.quantity).toFixed(2)}</td>
                      <td className="px-3 py-2 text-gray-500 dark:text-[#848e9c]">0.01%</td>
                      <td className={`px-3 py-2 font-bold ${t.pnl >= 0 ? 'text-[#0ecb81]' : 'text-[#f6465d]'}`}>
                        {t.pnl >= 0 ? '+' : ''}{t.pnl.toFixed(4)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ===== BOTS (机器人) ===== */}
        {activeTab === 'bots' && (
          <div className="flex-1 overflow-y-auto scrollbar-pro min-h-0 px-4 py-20 text-center text-xs text-gray-500 dark:text-[#848e9c]">
            暂未启用机器人
          </div>
        )}

        {/* ===== ASSETS (资产) ===== */}
        {activeTab === 'assets' && (() => {
          // ===== Ledger-based derivation (absolute conservation) =====
          // 1. Total Realized PnL — sum of all closed-trade pnl (already net of fees)
          const totalRealized = (tradeHistory ?? []).reduce(
            (sum, trade) => sum + (Number.isFinite(trade.pnl) ? trade.pnl : 0),
            0,
          );

          // 2. Active positions iterated per-symbol so we can resolve the mark price
          let totalUnrealized = 0;
          let totalUsedMargin = 0;
          for (const [sym, positions] of Object.entries(positionsMap ?? {})) {
            const px = priceMap[sym] || 0;
            for (const pos of positions || []) {
              // 3. Unrealized PnL — live floating PnL across all open positions
              if (px > 0) {
                const u = calcUnrealizedPnl(pos, px);
                if (Number.isFinite(u)) totalUnrealized += u;
              }
              // 4. Used Margin — margin locked by each position
              const m = pos.marginMode === 'isolated' && pos.isolatedMargin != null
                ? pos.isolatedMargin
                : pos.margin;
              if (Number.isFinite(m)) totalUsedMargin += m;
            }
          }

          // 5. Derive top-level cards strictly from the formulas
          const equity = initialCapital + totalRealized + totalUnrealized;
          const available = equity - totalUsedMargin;

          const cards = [
            { label: '总权益 (Total Equity)', value: equity, signed: false },
            { label: '可用余额 (Available Balance)', value: available, signed: false },
            { label: '已用保证金 (Used Margin)', value: totalUsedMargin, signed: false },
            { label: '未实现盈亏 (Unrealized PnL)', value: totalUnrealized, signed: true },
          ];
          return (
            <div className="flex-1 overflow-y-auto scrollbar-pro min-h-0 p-4">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {cards.map(c => {
                  const isPnl = c.signed;
                  const positive = c.value >= 0;
                  const color = isPnl
                    ? (positive ? 'text-[#0ecb81]' : 'text-[#f6465d]')
                    : 'text-gray-900 dark:text-white';
                  const display = isPnl ? formatSignedUSDT(c.value) : formatUSDT(c.value);
                  return (
                    <div
                      key={c.label}
                      className="rounded-lg border border-gray-200 dark:border-[#2b3139] bg-white dark:bg-transparent p-5"
                    >
                      <div className="text-xs font-normal text-gray-500 dark:text-[#848e9c] mb-1.5 whitespace-nowrap overflow-hidden text-ellipsis">{c.label}</div>
                      <div className="flex items-baseline space-x-1.5">
                        <span className={`font-mono text-xl font-semibold tracking-tight tabular-nums ${color}`}>{display}</span>
                        <span className="text-[11px] font-medium text-gray-500 dark:text-[#848e9c]">USDT</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
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
      {adjustMarginModal && onAdjustMargin && (
        <AdjustMarginModal
          open={!!adjustMarginModal}
          onClose={() => setAdjustMarginModal(null)}
          symbol={adjustMarginModal.symbol}
          position={positionsMap[adjustMarginModal.symbol]?.[adjustMarginModal.index] ?? adjustMarginModal.pos}
          availableBalance={availableBalance}
          onConfirm={(signedDelta) => {
            onAdjustMargin(adjustMarginModal.symbol, adjustMarginModal.index, signedDelta);
          }}
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
                  <span className={rollbackPreview.totalPnl >= 0 ? 'text-trading-green' : 'text-trading-red'}>
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
                  <span className={rollbackPreview.balanceAdjustment >= 0 ? 'text-trading-green' : 'text-trading-red'}>
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
          ? 'text-trading-red hover:bg-trading-red/10'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
      } disabled:opacity-50`}
    >
      {label}
    </button>
  );
}
