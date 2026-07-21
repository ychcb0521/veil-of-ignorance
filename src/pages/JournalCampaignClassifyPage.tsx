import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { toast } from 'sonner';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, Check, ChevronDown, Loader2, Search } from 'lucide-react';
import { BackButton } from '@/components/journal/BackButton';
import { AddToExistingCampaignDialog } from '@/components/journal/AddToExistingCampaignDialog';
import { ClassifyAsNewCampaignDialog } from '@/components/journal/ClassifyAsNewCampaignDialog';
import { LegRoleChip } from '@/components/journal/LegRoleChip';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { useTradingContext } from '@/contexts/TradingContext';
import { classifiableOperationTime } from '@/lib/classifiableOperationTime';
import { getSettlementAsset } from '@/lib/coinMargined';
import { detachJournalFromCampaign, listAllCampaigns, listUnclassifiedItems, suggestLegRoles } from '@/lib/journalApi';
import { LEG_ROLE_LABELS } from '@/lib/strategyTemplates';
import { getPositionNotionalUsd } from '@/lib/tradingSettlement';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { ClassifiableItem } from '@/types/journalClassification';
import type { TradeRecord } from '@/types/trading';

type CampaignBundle = { campaign: TradeCampaign; legs: TradeJournal[] };

function fmtPrice(value: number | null | undefined) {
  return typeof value === 'number' ? value.toFixed(4) : '—';
}

function fmtAmount(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', {
    maximumFractionDigits: 4,
  });
}

function fmtSignedUsdt(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}

function fmtRoe(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function fmtContractForItem(item: ClassifiableItem, record: TradeRecord | null) {
  const symbol = itemSymbol(item);
  if (!symbol) return '—';
  const quote = record?.settlementMode === 'coin' ? 'USD' : 'USDT';
  return `${getSettlementAsset(symbol)}/${quote}`;
}

function fmtStackedTime(value: string | number | null | undefined) {
  if (!value) return '—';
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}\n${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function roeFromRecord(record: TradeRecord | null) {
  if (!record || record.leverage <= 0) return null;
  const margin = getPositionNotionalUsd(record.symbol, record, record.entryPrice) / record.leverage;
  return margin > 0 ? (record.pnl / margin) * 100 : null;
}

function exitMethodLabel(record: TradeRecord | null) {
  if (!record?.exit_method) return '—';
  if (record.exit_method === 'manual') return '手动';
  if (record.exit_method === 'sl') return '止损';
  if (record.exit_method.startsWith('tp')) return record.exit_method.toUpperCase();
  if (record.exit_method === 'liquidation') return '爆仓';
  return record.exit_method;
}

export default function JournalCampaignClassifyPage() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { tradeHistory, recordCampaignCreated } = useTradingContext();
  const [loading, setLoading] = useState(true);
  const [symbol, setSymbol] = useState(() => searchParams.get('symbol')?.trim().toUpperCase() ?? '');
  const dateFrom = searchParams.get('dateFrom') ?? '';
  const dateTo = searchParams.get('dateTo') ?? '';
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [activeOptionIndex, setActiveOptionIndex] = useState(-1);
  const optionsContainerRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [journals, setJournals] = useState<TradeJournal[]>([]);
  const [orphanRecords, setOrphanRecords] = useState<TradeRecord[]>([]);
  const [campaignBundles, setCampaignBundles] = useState<CampaignBundle[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [attachDialogOpen, setAttachDialogOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [{ journals: journalRows, orphanRecords: orphanRows }, campaigns] = await Promise.all([
        listUnclassifiedItems(user.id, { includeClassified: true }),
        listAllCampaigns(user.id, { status: 'all' }),
      ]);
      const bundles = campaigns.map(campaign => ({
        campaign,
        legs: journalRows
          .filter(journal => journal.campaign_id === campaign.id)
          .sort((a, b) => (a.leg_sequence ?? 9999) - (b.leg_sequence ?? 9999)),
      }));

      setJournals(journalRows);
      setOrphanRecords(orphanRows);
      setCampaignBundles(bundles);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const campaignMap = useMemo(() => new Map(campaignBundles.map(bundle => [bundle.campaign.id, bundle.campaign])), [campaignBundles]);
  const tradeRecordMap = useMemo(() => new Map(tradeHistory.map(record => [record.id, record])), [tradeHistory]);
  const recordCampaignMap = useMemo(() => {
    const next = new Map<string, TradeCampaign>();
    campaignBundles.forEach(({ campaign }) => {
      (campaign.actual_evolution ?? []).forEach(event => {
        if (event.trade_record_id) next.set(event.trade_record_id, campaign);
      });
    });
    return next;
  }, [campaignBundles]);
  const classifiableTradeHistory = useMemo(
    () => {
      const records = new Map<string, TradeRecord>();
      [...tradeHistory, ...orphanRecords]
        .filter(record => record.action === 'CLOSE' || record.action === 'LIQUIDATION')
        .forEach(record => records.set(record.id, record));
      return [...records.values()];
    },
    [orphanRecords, tradeHistory],
  );
  const allItems = useMemo<ClassifiableItem[]>(
    () => {
      const journalRecordIds = new Set(journals.map(journal => journal.trade_record_id).filter((value): value is string => Boolean(value)));
      return [
        ...journals.map(journal => ({
          id: `j_${journal.id}`,
          kind: 'journal' as const,
          journal,
          record: journal.trade_record_id ? tradeRecordMap.get(journal.trade_record_id) ?? null : null,
        })),
        ...classifiableTradeHistory
          .filter(record => !journalRecordIds.has(record.id))
          .map(record => ({ id: `r_${record.id}`, kind: 'orphanRecord' as const, record })),
      ].sort((a, b) => itemTimeMs(b) - itemTimeMs(a));
    },
    [classifiableTradeHistory, journals, tradeRecordMap],
  );
  const allCandidateJournals = useMemo(
    () => [...journals].sort((a, b) => new Date(b.pre_simulated_time).getTime() - new Date(a.pre_simulated_time).getTime()),
    [journals],
  );
  const availableSymbols = useMemo(
    () =>
      [...new Set(allItems.map(itemSymbol).map(value => value?.trim().toUpperCase()).filter((value): value is string => Boolean(value)))]
        .sort((a, b) => a.localeCompare(b)),
    [allItems],
  );
  const visibleSymbols = useMemo(() => {
    const normalized = symbol.trim().toUpperCase();
    return normalized
      ? availableSymbols.filter(item => item.startsWith(normalized))
      : availableSymbols;
  }, [availableSymbols, symbol]);
  const suggestionMap = useMemo(
    () => new Map(suggestLegRoles(filteredForSuggestions(allCandidateJournals)).map(item => [item.journalId, item])),
    [allCandidateJournals],
  );

  const symbolScoped = useMemo(
    () => {
      const normalized = symbol.trim().toUpperCase();
      return allItems.filter(item => !normalized || itemSymbol(item).toUpperCase().startsWith(normalized));
    },
    [allItems, symbol],
  );
  const filtered = useMemo(() => {
    return symbolScoped.filter(item => {
      const timeMs = itemTimeMs(item);
      if (dateFrom && timeMs < new Date(`${dateFrom}T00:00:00`).getTime()) return false;
      if (dateTo && timeMs > new Date(`${dateTo}T23:59:59`).getTime()) return false;
      if (item.kind === 'journal' && item.journal.campaign_id) return false;
      if (item.kind === 'orphanRecord' && recordCampaignMap.has(item.record.id)) return false;
      return true;
    });
  }, [symbolScoped, dateFrom, dateTo, recordCampaignMap]);

  const selectedItems = useMemo(
    () => filtered.filter(item => selectedIds.has(item.id)),
    [filtered, selectedIds],
  );
  const selectedJournals = useMemo(
    () => selectedItems.flatMap(item => item.kind === 'journal' ? [item.journal] : []),
    [selectedItems],
  );
  const selectedOrphanRecords = useMemo(
    () => selectedItems.flatMap(item => item.kind === 'orphanRecord' ? [item.record] : []),
    [selectedItems],
  );
  const allCurrentSelected = filtered.length > 0 && filtered.every(item => selectedIds.has(item.id));
  const someCurrentSelected = filtered.some(item => selectedIds.has(item.id));
  const allSelectedClassified = selectedItems.length > 0 && selectedItems.every(item => (
    item.kind === 'journal' ? !!item.journal.campaign_id : recordCampaignMap.has(item.record.id)
  ));
  const activeCampaigns = useMemo(
    () => {
      const normalized = symbol.trim().toUpperCase();
      return campaignBundles.filter(bundle => !normalized || bundle.campaign.symbol.includes(normalized));
    },
    [campaignBundles, symbol],
  );
  const filteredJournalCount = useMemo(
    () => filtered.filter(item => item.kind === 'journal').length,
    [filtered],
  );
  const filteredOrphanCount = useMemo(
    () => filtered.filter(item => item.kind === 'orphanRecord').length,
    [filtered],
  );
  const emptyReason = useMemo(() => {
    if (loadError) return `加载失败：${loadError}`;
    if (loading) return '正在加载可归类项…';
    if (allItems.length === 0) return '仓位历史记录里还没有已平仓/爆仓记录。';
    if (!symbol) return '输入或下拉选择标的后，会显示该币种所有时间段的仓位历史记录。';
    if (symbolScoped.length === 0) return `当前输入 ${symbol} 没有匹配的仓位历史记录。`;
    if (symbolScoped.every(item => (
      item.kind === 'journal' ? !!item.journal.campaign_id : recordCampaignMap.has(item.record.id)
    ))) {
      return `当前输入 ${symbol} 下没有未归类的仓位历史记录。`;
    }
    return '当前日期范围内没有可归类的仓位历史记录。';
  }, [loadError, loading, allItems, symbol, symbolScoped, recordCampaignMap]);

  useEffect(() => {
    const validIds = new Set(allItems.map(item => item.id));
    setSelectedIds(prev => new Set([...prev].filter(id => validIds.has(id))));
  }, [allItems]);

  useEffect(() => {
    setActiveOptionIndex(optionsOpen && visibleSymbols.length > 0 ? 0 : -1);
  }, [optionsOpen, visibleSymbols]);

  useEffect(() => {
    if (!optionsOpen || activeOptionIndex < 0) return;
    const activeOption = optionRefs.current[activeOptionIndex];
    if (typeof activeOption?.scrollIntoView === 'function') {
      activeOption.scrollIntoView({ block: 'nearest' });
    }
  }, [activeOptionIndex, optionsOpen]);

  useEffect(() => {
    if (!optionsOpen) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!optionsContainerRef.current?.contains(event.target as Node)) {
        setOptionsOpen(false);
      }
    };

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [optionsOpen]);

  const openOptions = () => setOptionsOpen(true);

  const chooseSymbol = (nextSymbol: string) => {
    setSymbol(nextSymbol);
    setOptionsOpen(false);
    setActiveOptionIndex(-1);
    setSelectedIds(new Set());
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-6 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <BackButton />
            <div className="min-w-0">
              <h1 className="text-[14px] font-medium">归类历史交易</h1>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                把已有的历史 journal 整理为战役。每次归类操作都是可逆的。
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => nav('/journal/campaigns')}
            className="h-8 shrink-0 rounded border border-border bg-background px-3 text-[11px] font-medium text-foreground transition-colors hover:bg-muted/50"
          >
            查看所有战役
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-6 py-4">
        <div
          ref={optionsContainerRef}
          className="relative"
          onMouseEnter={openOptions}
          onBlur={event => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setOptionsOpen(false);
            }
          }}
        >
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground"
          />
          <Input
            autoFocus
            value={symbol}
            onFocus={openOptions}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              const nextValue = event.target.value.toUpperCase();
              setSymbol(nextValue);
              setOptionsOpen(true);
              setSelectedIds(new Set());
            }}
            onKeyDown={event => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setOptionsOpen(false);
                return;
              }
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                setOptionsOpen(true);
                setActiveOptionIndex(current => {
                  if (visibleSymbols.length === 0) return -1;
                  if (current < 0) return event.key === 'ArrowDown' ? 0 : visibleSymbols.length - 1;
                  const delta = event.key === 'ArrowDown' ? 1 : -1;
                  return (current + delta + visibleSymbols.length) % visibleSymbols.length;
                });
                return;
              }
              if (event.key === 'Home' && optionsOpen && visibleSymbols.length > 0) {
                event.preventDefault();
                setActiveOptionIndex(0);
                return;
              }
              if (event.key === 'End' && optionsOpen && visibleSymbols.length > 0) {
                event.preventDefault();
                setActiveOptionIndex(visibleSymbols.length - 1);
                return;
              }
              if (event.key === 'Enter' && optionsOpen && activeOptionIndex >= 0) {
                const activeSymbol = visibleSymbols[activeOptionIndex];
                if (activeSymbol) {
                  event.preventDefault();
                  chooseSymbol(activeSymbol);
                }
              }
            }}
            placeholder="输入标的名称，例如 RAVEUSDT"
            aria-label="标的名称"
            aria-controls="campaign-symbol-options"
            aria-expanded={optionsOpen}
            aria-autocomplete="list"
            aria-activedescendant={optionsOpen && activeOptionIndex >= 0 ? `campaign-symbol-option-${activeOptionIndex}` : undefined}
            role="combobox"
            className="h-10 pl-9 pr-10 text-[13px]"
          />
          <button
            type="button"
            aria-label={optionsOpen ? '收起标的选项' : '展开标的选项'}
            onMouseDown={event => event.preventDefault()}
            onClick={() => setOptionsOpen(current => !current)}
            className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <ChevronDown
              aria-hidden="true"
              className={`h-4 w-4 transition-transform duration-150 ease-out ${optionsOpen ? 'rotate-180' : ''}`}
            />
          </button>

          <div
            id="campaign-symbol-options"
            role="listbox"
            aria-label="可选标的"
            aria-hidden={!optionsOpen}
            className={`absolute inset-x-0 top-[calc(100%+6px)] z-40 origin-top overflow-hidden rounded border border-border bg-popover shadow-lg transition-[opacity,transform] duration-150 ease-out ${
              optionsOpen
                ? 'pointer-events-auto translate-y-0 opacity-100'
                : 'pointer-events-none -translate-y-1 opacity-0'
            }`}
          >
            <div className="flex h-8 items-center justify-between border-b border-border/70 px-3 text-[10px] text-muted-foreground">
              <span>{symbol.trim() ? '匹配标的' : '全部可选标的'}</span>
              <span>{symbol.trim() ? `${visibleSymbols.length} / ${availableSymbols.length}` : availableSymbols.length}</span>
            </div>
            <div className="max-h-72 overflow-y-auto overscroll-contain p-1.5">
              {loading && availableSymbols.length === 0 ? (
                <div className="flex h-16 items-center justify-center gap-2 text-[11px] text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  正在读取历史标的
                </div>
              ) : visibleSymbols.length > 0 ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-1">
                  {visibleSymbols.map((item, index) => (
                    <button
                      ref={element => {
                        optionRefs.current[index] = element;
                      }}
                      id={`campaign-symbol-option-${index}`}
                      key={item}
                      type="button"
                      role="option"
                      tabIndex={optionsOpen ? 0 : -1}
                      aria-selected={item === symbol.trim().toUpperCase()}
                      onMouseEnter={() => setActiveOptionIndex(index)}
                      onMouseDown={event => event.preventDefault()}
                      onClick={() => chooseSymbol(item)}
                      className={`flex h-8 min-w-0 items-center justify-between gap-2 rounded px-2.5 text-left text-[11px] font-medium text-foreground transition-colors duration-100 focus-visible:outline-none ${
                        activeOptionIndex === index ? 'bg-accent' : 'hover:bg-accent/70'
                      }`}
                    >
                      <span className="truncate">{item}</span>
                      {item === symbol.trim().toUpperCase() ? <Check className="h-3.5 w-3.5 shrink-0 text-[#D99B00]" /> : null}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex h-16 items-center justify-center text-[11px] text-muted-foreground">
                  {availableSymbols.length === 0 ? '暂无可归类的历史标的' : `没有以“${symbol.trim()}”开头的标的`}
                </div>
              )}
            </div>
          </div>
        </div>

        {symbol.trim() ? (
          <div className="pt-4">
            <div className="pb-2 text-[11px] text-muted-foreground">
              {filteredJournalCount === 0 && filteredOrphanCount === 0
                ? '该标的暂无可归类项'
                : `共 ${filteredJournalCount} 个 journal · ${filteredOrphanCount} 条仓位历史记录`}
            </div>
            <section className="overflow-hidden rounded border border-border bg-card">
              {loading ? (
                <div className="h-[480px] flex items-center justify-center text-[13px] text-muted-foreground">
                  加载中…
                </div>
              ) : (
                <div className="max-h-[calc(100vh-240px)] overflow-auto">
              {filtered.length === 0 ? (
                <div className="px-4 py-10 text-center text-[12px] text-muted-foreground space-y-2">
                  <div className="mx-auto h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                    <AlertCircle className="w-4 h-4" />
                  </div>
                  <div>{emptyReason}</div>
                </div>
              ) : (
                <table className="w-full min-w-[1420px] text-[12px] font-mono tabular-nums">
                  <thead className="sticky top-0 z-10 bg-card">
                    <tr className="border-b border-border bg-muted/35 text-[11px] text-muted-foreground">
                      <th className="w-[48px] px-3 py-2 text-left font-medium">
                        <Checkbox
                          checked={allCurrentSelected ? true : someCurrentSelected ? 'indeterminate' : false}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedIds(prev => new Set([...prev, ...filtered.map(item => item.id)]));
                            } else {
                              setSelectedIds(prev => new Set([...prev].filter(id => !filtered.some(item => item.id === id))));
                            }
                          }}
                        />
                      </th>
                      {['合约', '方向', '开仓均价', '平仓均价', '数量', '开仓时间', '平仓时间', '操作时间', '平仓方式', '平仓盈亏', '收益率(ROE)', '当前归属'].map(header => (
                        <th key={header} className="px-3 py-2 text-left font-medium whitespace-nowrap">{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(item => {
                      const journal = item.kind === 'journal' ? item.journal : null;
                      const record = item.kind === 'orphanRecord'
                        ? item.record
                        : journal?.trade_record_id
                          ? tradeRecordMap.get(journal.trade_record_id) ?? null
                          : null;
                      const campaign = journal?.campaign_id ? campaignMap.get(journal.campaign_id) ?? null : null;
                      const suggestion = journal ? suggestionMap.get(journal.id) : null;
                      const rowClickable = Boolean(journal?.id);
                      const direction = item.kind === 'journal' ? item.journal.direction : tradeRecordDirection(item.record);
                      const leverage = record?.leverage ?? journal?.leverage ?? null;
                      const entryPrice = record?.entryPrice ?? journal?.pre_entry_price ?? null;
                      const exitPrice = record?.exitPrice && record.exitPrice > 0 ? record.exitPrice : null;
                      const quantity = record?.quantity ?? null;
                      const pnl = record?.pnl ?? journal?.post_realized_pnl ?? null;
                      const roe = roeFromRecord(record);
                      const operationTime = operationTimeForItem(item, record);
                      return (
                        <tr
                          key={item.id}
                          role={rowClickable ? 'button' : undefined}
                          tabIndex={rowClickable ? 0 : -1}
                          onClick={() => {
                            if (journal?.id) window.open(`/journal/${journal.id}`, '_blank', 'noopener,noreferrer');
                          }}
                          onKeyDown={(event) => {
                            if (journal?.id && event.key === 'Enter') window.open(`/journal/${journal.id}`, '_blank', 'noopener,noreferrer');
                          }}
                          className={`border-b border-border/40 ${rowClickable ? 'hover:bg-accent' : ''}`}
                        >
                          <td className="px-3 py-2" onClick={event => event.stopPropagation()}>
                            <Checkbox
                              checked={selectedIds.has(item.id)}
                              onCheckedChange={(checked) => {
                                setSelectedIds(prev => {
                                  const next = new Set(prev);
                                  if (checked) next.add(item.id);
                                  else next.delete(item.id);
                                  return next;
                                });
                              }}
                            />
                          </td>
                          <td className="px-3 py-2 text-foreground font-medium whitespace-nowrap">{fmtContractForItem(item, record)}</td>
                          <td className={`px-3 py-2 font-bold whitespace-pre-line ${direction === 'short' ? 'text-[#F6465D]' : 'text-[#0ECB81]'}`}>
                            {direction === 'short' ? '空' : '多'}{leverage ? `\n${leverage}x` : ''}
                          </td>
                          <td className="px-3 py-2 text-foreground whitespace-nowrap">{fmtPrice(entryPrice)}</td>
                          <td className="px-3 py-2 text-foreground whitespace-nowrap">{fmtPrice(exitPrice)}</td>
                          <td className="px-3 py-2 text-foreground whitespace-nowrap">{fmtAmount(quantity)}</td>
                          <td className="px-3 py-2 text-muted-foreground whitespace-pre-line">{fmtStackedTime(record?.openTime ?? journal?.pre_simulated_time)}</td>
                          <td className="px-3 py-2 text-muted-foreground whitespace-pre-line">{fmtStackedTime(record?.closeTime)}</td>
                          <td className="px-3 py-2 text-muted-foreground whitespace-pre-line">{fmtStackedTime(operationTime)}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{record ? exitMethodLabel(record) : '—'}</td>
                          <td className={`px-3 py-2 font-bold whitespace-nowrap ${typeof pnl !== 'number' ? 'text-muted-foreground' : pnl >= 0 ? 'text-[#0ECB81]' : 'text-[#F6465D]'}`}>
                            {fmtSignedUsdt(pnl)}
                          </td>
                          <td className={`px-3 py-2 font-bold whitespace-nowrap ${typeof roe !== 'number' ? 'text-muted-foreground' : roe >= 0 ? 'text-[#0ECB81]' : 'text-[#F6465D]'}`}>
                            {fmtRoe(roe)}
                          </td>
                          <td className="px-3 py-2 min-w-[220px]" onClick={event => event.stopPropagation()}>
                            <div className="flex items-center gap-2 min-w-0 text-[11px]">
                              {item.kind === 'orphanRecord' ? (
                                recordCampaignMap.has(item.record.id) ? (
                                  <Link to={`/journal/campaigns/${recordCampaignMap.get(item.record.id)?.id}`} className="truncate text-[#5BA3FF] hover:underline">
                                    {recordCampaignMap.get(item.record.id)?.title}
                                  </Link>
                                ) : (
                                  <span className="text-muted-foreground">未归类</span>
                                )
                              ) : !journal.campaign_id || !campaign ? (
                                <span className="text-muted-foreground">未归类</span>
                              ) : (
                                <>
                                  <Link to={`/journal/campaigns/${campaign.id}`} className="truncate text-[#5BA3FF] hover:underline">
                                    {campaign.title}
                                  </Link>
                                  {journal.leg_role && <LegRoleChip role={journal.leg_role} short />}
                                </>
                              )}
                              {suggestion && item.kind === 'journal' && !journal.campaign_id && (
                                <span className="truncate text-[10px] text-muted-foreground">
                                  建议：{LEG_ROLE_LABELS[suggestion.suggestedRole]}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
                </div>
              )}
            </section>
          </div>
        ) : null}
      </main>

      {selectedItems.length > 0 && (
        <div className="sticky bottom-0 z-20 bg-card border-t border-border px-6 py-3">
          <div className="max-w-[1600px] mx-auto flex flex-wrap items-center justify-between gap-3">
            <div className="text-[12px]">
              已选 {selectedItems.length} 项
              {selectedOrphanRecords.length > 0 ? ` · 含 ${selectedOrphanRecords.length} 条仓位历史记录` : ''}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="h-8 rounded px-3 text-[12px] text-muted-foreground hover:bg-accent"
                onClick={() => setSelectedIds(prev => new Set([...prev, ...filtered.map(item => item.id)]))}
              >
                全选当前页
              </button>
              <button
                type="button"
                className="h-8 rounded px-3 text-[12px] text-muted-foreground hover:bg-accent"
                onClick={() => setSelectedIds(new Set())}
              >
                清除选择
              </button>
              <button
                type="button"
                disabled={!allSelectedClassified || selectedJournals.length !== selectedItems.length}
                className="h-8 rounded bg-muted px-3 text-[12px] disabled:opacity-50"
                onClick={async () => {
                  if (!allSelectedClassified || selectedJournals.length !== selectedItems.length) return;
                  if (!window.confirm(`确认解除这 ${selectedJournals.length} 条 journal 的战役归属吗？`)) return;
                  try {
                    for (const journal of selectedJournals) {
                      await detachJournalFromCampaign(journal.id);
                    }
                    toast.success('已解除所选 journals 的归属');
                    setSelectedIds(new Set());
                    await loadData();
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : String(error));
                  }
                }}
              >
                解除归属
              </button>
              <button
                type="button"
                className="h-8 rounded bg-[#5BA3FF] px-3 text-[12px] text-white"
                onClick={() => setAttachDialogOpen(true)}
              >
                加入现有战役
              </button>
              <button
                type="button"
                className="h-8 rounded bg-[#F0B90B] px-3 text-[12px] text-black"
                onClick={() => setNewDialogOpen(true)}
              >
                归类为新战役
              </button>
            </div>
          </div>
        </div>
      )}

      <ClassifyAsNewCampaignDialog
        open={newDialogOpen}
        onOpenChange={setNewDialogOpen}
        items={selectedItems}
        onCreated={async (campaignId) => {
          recordCampaignCreated({
            id: campaignId,
            symbol: itemSymbol(selectedItems[0]),
            createdAt: new Date(),
          });
          setSelectedIds(new Set());
          await loadData();
          nav(`/journal/campaigns/${campaignId}`);
        }}
      />
      <AddToExistingCampaignDialog
        open={attachDialogOpen}
        onOpenChange={setAttachDialogOpen}
        campaigns={activeCampaigns}
        items={selectedItems}
        symbol={symbol}
        onAttached={async (campaignId) => {
          setSelectedIds(new Set());
          await loadData();
          nav(`/journal/campaigns/${campaignId}`);
        }}
      />
    </div>
  );
}

function filteredForSuggestions(journals: TradeJournal[]) {
  return [...journals].sort((a, b) => new Date(a.pre_simulated_time).getTime() - new Date(b.pre_simulated_time).getTime());
}

function itemSymbol(item: ClassifiableItem) {
  return item.kind === 'journal' ? item.journal.symbol : item.record.symbol;
}

function itemTimeMs(item: ClassifiableItem) {
  return item.kind === 'journal'
    ? new Date(item.journal.pre_simulated_time).getTime()
    : (item.record.openTime || item.record.closeTime || 0);
}

function operationTimeForItem(
  item: ClassifiableItem,
  record: TradeRecord | null,
) {
  return classifiableOperationTime(item, record);
}

function tradeRecordDirection(record: TradeRecord): 'long' | 'short' {
  return record.side === 'SHORT' ? 'short' : 'long';
}
