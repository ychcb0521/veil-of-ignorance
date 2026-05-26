import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { toast } from 'sonner';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, ChevronDown, Filter } from 'lucide-react';
import { BackButton } from '@/components/journal/BackButton';
import { AddToExistingCampaignDialog } from '@/components/journal/AddToExistingCampaignDialog';
import { ClassifyAsNewCampaignDialog } from '@/components/journal/ClassifyAsNewCampaignDialog';
import { LegRoleChip } from '@/components/journal/LegRoleChip';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/contexts/AuthContext';
import { useTradingContext } from '@/contexts/TradingContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { detachJournalFromCampaign, listAllCampaigns, listUnclassifiedItems, suggestLegRoles } from '@/lib/journalApi';
import { LEG_ROLE_LABELS } from '@/lib/strategyTemplates';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { ClassifiableItem } from '@/types/journalClassification';
import type { TradeRecord } from '@/types/trading';

type CampaignBundle = { campaign: TradeCampaign; legs: TradeJournal[] };

function fmtTime(value: string | number | null | undefined) {
  if (!value) return '—';
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fmtPrice(value: number | null | undefined) {
  return typeof value === 'number' ? value.toFixed(4) : '—';
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
  const { user } = useAuth();
  const { tradeHistory } = useTradingContext();
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(true);
  const [symbol, setSymbol] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [onlyUnclassified, setOnlyUnclassified] = useState(true);
  const [onlyClosed, setOnlyClosed] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [journals, setJournals] = useState<TradeJournal[]>([]);
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
      const [{ journals: journalRows }, campaigns] = await Promise.all([
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
    () => tradeHistory.filter(record => record.action === 'CLOSE' || record.action === 'LIQUIDATION'),
    [tradeHistory],
  );
  const allItems = useMemo<ClassifiableItem[]>(
    () => {
      const journalRecordIds = new Set(journals.map(journal => journal.trade_record_id).filter((value): value is string => Boolean(value)));
      return [
        ...journals.map(journal => ({ id: `j_${journal.id}`, kind: 'journal' as const, journal })),
        ...classifiableTradeHistory
          .filter(record => !journalRecordIds.has(record.id))
          .map(record => ({ id: `r_${record.id}`, kind: 'orphanRecord' as const, record })),
      ].sort((a, b) => itemTimeMs(b) - itemTimeMs(a));
    },
    [classifiableTradeHistory, journals],
  );
  const allCandidateJournals = useMemo(
    () => [...journals].sort((a, b) => new Date(b.pre_simulated_time).getTime() - new Date(a.pre_simulated_time).getTime()),
    [journals],
  );
  const availableSymbols = useMemo(
    () =>
      [...new Set(allItems.map(itemSymbol).map(value => value?.trim()).filter((value): value is string => Boolean(value)))]
        .sort((a, b) => a.localeCompare(b)),
    [allItems],
  );
  const suggestionMap = useMemo(
    () => new Map(suggestLegRoles(filteredForSuggestions(allCandidateJournals)).map(item => [item.journalId, item])),
    [allCandidateJournals],
  );

  const symbolScoped = useMemo(
    () => {
      const normalized = symbol.trim().toUpperCase();
      return allItems.filter(item => !normalized || itemSymbol(item).toUpperCase().includes(normalized));
    },
    [allItems, symbol],
  );
  const filtered = useMemo(() => {
    return symbolScoped.filter(item => {
      const timeMs = itemTimeMs(item);
      if (dateFrom && timeMs < new Date(`${dateFrom}T00:00:00`).getTime()) return false;
      if (dateTo && timeMs > new Date(`${dateTo}T23:59:59`).getTime()) return false;
      if (onlyUnclassified && item.kind === 'journal' && item.journal.campaign_id) return false;
      if (onlyUnclassified && item.kind === 'orphanRecord' && recordCampaignMap.has(item.record.id)) return false;
      if (onlyClosed && item.kind === 'journal' && !item.journal.trade_record_id) return false;
      return true;
    });
  }, [symbolScoped, dateFrom, dateTo, onlyUnclassified, recordCampaignMap, onlyClosed]);

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
    if (onlyUnclassified && symbolScoped.every(item => (
      item.kind === 'journal' ? !!item.journal.campaign_id : recordCampaignMap.has(item.record.id)
    ))) {
      return `当前输入 ${symbol} 下没有未归类的仓位历史记录。`;
    }
    if (onlyClosed && symbolScoped.every(item => item.kind === 'orphanRecord' || !item.journal.trade_record_id)) {
      return `当前 symbol ${symbol} 下没有可平仓复核的项。`;
    }
    return '当前筛选条件过窄，请放宽日期范围或关闭部分筛选。';
  }, [loadError, loading, allItems, symbol, symbolScoped, onlyUnclassified, onlyClosed, recordCampaignMap]);

  useEffect(() => {
    const validIds = new Set(allItems.map(item => item.id));
    setSelectedIds(prev => new Set([...prev].filter(id => validIds.has(id))));
  }, [allItems]);

  useEffect(() => {
    setFiltersOpen(isMobile);
  }, [isMobile]);

  const filterSummary = useMemo(() => {
    const parts: string[] = [];
    parts.push(symbol.trim() || '全部标的');
    if (dateFrom || dateTo) {
      parts.push(`${dateFrom || '起始'} ~ ${dateTo || '今天'}`);
    } else {
      parts.push('全部时间');
    }
    parts.push(onlyUnclassified ? '未归类' : '全部');
    if (onlyClosed) {
      parts.push('仅已平仓');
    }
    return parts.join(' · ');
  }, [dateFrom, dateTo, onlyClosed, onlyUnclassified, symbol]);

  const collapseAfterFilterChange = () => {
    if (!isMobile) {
      setFiltersOpen(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="max-w-[1600px] mx-auto px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <BackButton />
            <div>
              <h1 className="text-[14px] font-medium">归类历史交易</h1>
              <div className="text-[11px] text-muted-foreground">把已有的历史 journal 整理为战役。每次归类操作都是可逆的。</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => nav('/journal/campaigns')}
            className="h-9 rounded border border-border bg-card px-3 text-[12px] hover:bg-accent"
          >
            查看所有战役
          </button>
        </div>
      </header>

      <div className="sticky top-[57px] z-10 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="max-w-[1600px] mx-auto px-6 py-3 space-y-2">
          <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="h-9 w-full bg-card border border-border rounded px-3 flex items-center justify-between gap-3 text-left"
              >
                <span className="flex items-center gap-2 text-[12px] font-medium">
                  <Filter className="h-4 w-4" />
                  筛选归类项
                </span>
                <span className="flex items-center gap-2 min-w-0">
                  <span className="truncate text-[11px] text-muted-foreground">{filterSummary}</span>
                  <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${filtersOpen ? 'rotate-180' : ''}`} />
                </span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3">
              <div className="bg-card border border-border rounded p-4 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-[1fr_240px] gap-2">
                  <div className="relative">
                    <Input
                      value={symbol}
                      list="campaign-symbol-options"
                      onChange={(e: ChangeEvent<HTMLInputElement>) => setSymbol(e.target.value.trim().toUpperCase())}
                      placeholder="输入标的名称，例如 RAVEUSDT"
                      className="h-9 pr-16 text-[12px]"
                    />
                    {symbol ? (
                      <button
                        type="button"
                        onClick={() => setSymbol('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent"
                      >
                        清空
                      </button>
                    ) : null}
                    <datalist id="campaign-symbol-options">
                      {availableSymbols.map(item => (
                        <option key={item} value={item} />
                      ))}
                    </datalist>
                  </div>
                  <select
                    value={availableSymbols.includes(symbol) ? symbol : ''}
                    onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                      setSymbol(e.target.value);
                      collapseAfterFilterChange();
                    }}
                    className="h-9 rounded border border-border bg-background px-3 text-[12px]"
                  >
                    <option value="">{availableSymbols.length === 0 ? '暂无仓位历史标的' : '从历史标的下拉选择'}</option>
                    {availableSymbols.map(item => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </div>
                {availableSymbols.length === 0 ? (
                  <div className="rounded border border-[#F0B90B]/30 bg-[#F0B90B]/8 px-3 py-2 text-[11px] text-muted-foreground">
                    当前仓位历史记录里没有已平仓/爆仓记录。
                  </div>
                ) : null}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => {
                      setDateFrom(e.target.value);
                      collapseAfterFilterChange();
                    }}
                    className="h-9 text-[12px]"
                  />
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => {
                      setDateTo(e.target.value);
                      collapseAfterFilterChange();
                    }}
                    className="h-9 text-[12px]"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="flex items-center justify-between rounded border border-border px-3 py-2 text-[12px]">
                    <span>仅显示未归类</span>
                    <Switch
                      checked={onlyUnclassified}
                      onCheckedChange={(checked) => {
                        setOnlyUnclassified(checked);
                        collapseAfterFilterChange();
                      }}
                    />
                  </div>
                  <div className="flex items-center justify-between rounded border border-border px-3 py-2 text-[12px]">
                    <span>仅显示已平仓</span>
                    <Switch
                      checked={onlyClosed}
                      onCheckedChange={(checked) => {
                        setOnlyClosed(checked);
                        collapseAfterFilterChange();
                      }}
                    />
                  </div>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          <div className="text-[10px] text-muted-foreground">
            输入或下拉选择标的后，勾选该币种属于同一战役的一系列仓位历史记录。
          </div>
        </div>
      </div>

      <main className="max-w-[1600px] mx-auto px-6 py-4">
        <div className="text-[11px] text-muted-foreground py-2">
          {filteredJournalCount === 0 && filteredOrphanCount === 0
            ? '该筛选条件下无可归类项'
            : `共 ${filteredJournalCount} 个 journal · ${filteredOrphanCount} 条仓位历史记录`}
        </div>
        <section className="bg-card border border-border rounded overflow-hidden">
          {!symbol ? (
            <div className="h-[480px] flex items-center justify-center text-[13px] text-muted-foreground">
              {availableSymbols.length === 0 ? emptyReason : '请先在上方选择标的'}
            </div>
          ) : loading ? (
            <div className="h-[480px] flex items-center justify-center text-[13px] text-muted-foreground">
              加载中…
            </div>
          ) : (
            <>
              <div className="grid grid-cols-[40px_90px_110px_96px_72px_90px_100px_92px_1fr] h-9 bg-muted/40 text-[10px] text-muted-foreground items-center px-3">
                <div className="flex items-center">
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
                </div>
                <div>类型</div>
                <div>时间</div>
                <div>标的</div>
                <div>方向</div>
                <div>订单类型</div>
                <div>价格</div>
                <div>仓位</div>
                <div>当前归属</div>
              </div>

              <div className="max-h-[calc(100vh-240px)] overflow-auto">
                {filtered.length === 0 ? (
                  <div className="px-4 py-10 text-center text-[12px] text-muted-foreground space-y-2">
                    <div className="mx-auto h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                      <AlertCircle className="w-4 h-4" />
                    </div>
                    <div>{emptyReason}</div>
                  </div>
                ) : (
                  filtered.map(item => {
                    const journal = item.kind === 'journal' ? item.journal : null;
                    const campaign = journal?.campaign_id ? campaignMap.get(journal.campaign_id) ?? null : null;
                    const suggestion = journal ? suggestionMap.get(journal.id) : null;
                    const rowClickable = Boolean(journal?.id);
                    return (
                      <div
                        key={item.id}
                        role={rowClickable ? 'button' : undefined}
                        tabIndex={rowClickable ? 0 : -1}
                        onClick={() => {
                          if (journal?.id) window.open(`/journal/${journal.id}`, '_blank', 'noopener,noreferrer');
                        }}
                        onKeyDown={(event) => {
                          if (journal?.id && event.key === 'Enter') window.open(`/journal/${journal.id}`, '_blank', 'noopener,noreferrer');
                        }}
                        className={`grid grid-cols-[40px_90px_110px_96px_72px_90px_100px_92px_1fr] min-h-9 text-[11px] font-mono items-center px-3 py-1 border-t border-border/30 ${rowClickable ? 'hover:bg-accent' : ''}`}
                      >
                        <div onClick={event => event.stopPropagation()}>
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
                        </div>
                        <div>
                          <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] ${item.kind === 'journal' ? 'bg-[#0ECB81]/15 text-[#0ECB81]' : 'bg-[#F0B90B]/15 text-[#F0B90B]'}`}>
                            {item.kind === 'journal' ? 'journal' : '仓位历史'}
                          </span>
                        </div>
                        <div>{fmtTime(item.kind === 'journal' ? item.journal.pre_simulated_time : item.record.openTime)}</div>
                        <div>{item.kind === 'journal' ? item.journal.symbol : item.record.symbol}</div>
                        <div className={(item.kind === 'journal' ? item.journal.direction : tradeRecordDirection(item.record)) === 'short' ? 'text-[#F6465D]' : 'text-[#0ECB81]'}>
                          {(item.kind === 'journal' ? item.journal.direction : tradeRecordDirection(item.record)) === 'short' ? 'SHORT' : 'LONG'}
                        </div>
                        <div>{item.kind === 'journal' ? (item.journal.order_kind === 'main' ? '主力' : '对冲') : '历史成交'}</div>
                        <div>{fmtPrice(item.kind === 'journal' ? item.journal.pre_entry_price : item.record.entryPrice)}</div>
                        <div>{item.kind === 'journal' ? item.journal.pre_position_size?.toFixed(2) ?? '—' : (item.record.entryPrice * item.record.quantity).toFixed(2)}</div>
                        <div className="min-w-0" onClick={event => event.stopPropagation()}>
                          <div className="flex items-center gap-2 min-w-0">
                            {item.kind === 'orphanRecord' ? (
                              recordCampaignMap.has(item.record.id) ? (
                                <Link to={`/journal/campaigns/${recordCampaignMap.get(item.record.id)?.id}`} className="truncate text-[#5BA3FF] hover:underline">
                                  {recordCampaignMap.get(item.record.id)?.title}
                                </Link>
                              ) : (
                                <span className="text-muted-foreground">仓位历史记录 / 未归类</span>
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
                            {item.kind === 'orphanRecord' && (
                              <span className="truncate text-[10px] text-muted-foreground">
                                {exitMethodLabel(item.record)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </section>
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

function tradeRecordDirection(record: TradeRecord): 'long' | 'short' {
  return record.side === 'SHORT' ? 'short' : 'long';
}
