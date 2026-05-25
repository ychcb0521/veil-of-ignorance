import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { toast } from 'sonner';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { BackButton } from '@/components/journal/BackButton';
import { AddToExistingCampaignDialog } from '@/components/journal/AddToExistingCampaignDialog';
import { ClassifyAsNewCampaignDialog } from '@/components/journal/ClassifyAsNewCampaignDialog';
import { LegRoleChip } from '@/components/journal/LegRoleChip';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/contexts/AuthContext';
import { useTradingContext } from '@/contexts/TradingContext';
import { detachJournalFromCampaign, listAllCampaigns, listUnclassifiedJournals, suggestLegRoles } from '@/lib/journalApi';
import { LEG_ROLE_LABELS } from '@/lib/strategyTemplates';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
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
  const [loading, setLoading] = useState(true);
  const [symbol, setSymbol] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [onlyUnclassified, setOnlyUnclassified] = useState(true);
  const [onlyClosed, setOnlyClosed] = useState(false);
  const [journals, setJournals] = useState<TradeJournal[]>([]);
  const [campaignBundles, setCampaignBundles] = useState<CampaignBundle[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [attachDialogOpen, setAttachDialogOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadData = async () => {
    if (!user) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [journalRows, campaigns] = await Promise.all([
        listUnclassifiedJournals(user.id, { includeClassified: true }),
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
      setSelectedIds(prev => prev.filter(id => journalRows.some(journal => journal.id === id)));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [user]);

  const tradeRecordMap = useMemo(() => new Map(tradeHistory.map(record => [record.id, record])), [tradeHistory]);
  const campaignMap = useMemo(() => new Map(campaignBundles.map(bundle => [bundle.campaign.id, bundle.campaign])), [campaignBundles]);
  const availableSymbols = useMemo(
    () => [...new Set(journals.map(journal => journal.symbol))].sort(),
    [journals],
  );
  const suggestionMap = useMemo(
    () => new Map(suggestLegRoles(filteredForSuggestions(journals)).map(item => [item.journalId, item])),
    [journals],
  );

  const symbolScoped = useMemo(
    () => journals.filter(journal => !symbol || journal.symbol === symbol),
    [journals, symbol],
  );
  const filtered = useMemo(() => {
    return symbolScoped.filter(journal => {
      if (dateFrom && new Date(journal.pre_simulated_time).getTime() < new Date(`${dateFrom}T00:00:00`).getTime()) return false;
      if (dateTo && new Date(journal.pre_simulated_time).getTime() > new Date(`${dateTo}T23:59:59`).getTime()) return false;
      if (onlyUnclassified && journal.campaign_id) return false;
      if (onlyClosed && !journal.trade_record_id) return false;
      return true;
    });
  }, [symbolScoped, dateFrom, dateTo, onlyUnclassified, onlyClosed]);

  const stats = useMemo(() => ({
    total: journals.length,
    unclassified: journals.filter(journal => !journal.campaign_id).length,
    classified: journals.filter(journal => !!journal.campaign_id).length,
    current: filtered.length,
    currentClosed: filtered.filter(journal => !!journal.trade_record_id).length,
  }), [journals, filtered]);

  const selectedJournals = useMemo(
    () => filtered.filter(journal => selectedIds.includes(journal.id)),
    [filtered, selectedIds],
  );
  const allCurrentSelected = filtered.length > 0 && filtered.every(journal => selectedIds.includes(journal.id));
  const someCurrentSelected = filtered.some(journal => selectedIds.includes(journal.id));
  const allSelectedClassified = selectedJournals.length > 0 && selectedJournals.every(journal => !!journal.campaign_id);
  const activeCampaigns = useMemo(
    () => campaignBundles.filter(bundle => !symbol || bundle.campaign.symbol === symbol),
    [campaignBundles, symbol],
  );
  const emptyReason = useMemo(() => {
    if (loadError) return `加载失败：${loadError}`;
    if (loading) return '正在加载可归类 journals…';
    if (journals.length === 0) return '当前用户下没有 trade_journals 数据，因此暂时没有可归类记录。历史归类只基于已写入 Supabase 的 trade_journals，不会直接用 localStorage 的 tradeHistory 代替。';
    if (!symbol) return '请先在左侧选择标的。symbol 选项来自当前用户已有的 trade_journals。';
    if (symbolScoped.length === 0) return `当前 symbol ${symbol} 下没有任何 journal。`;
    if (onlyUnclassified && symbolScoped.every(journal => !!journal.campaign_id)) return `当前 symbol ${symbol} 下没有未归类 journals。`;
    if (onlyClosed && symbolScoped.every(journal => !journal.trade_record_id)) return `当前 symbol ${symbol} 下没有已平仓记录。`;
    return '当前筛选条件过窄，请放宽日期范围或关闭部分筛选。';
  }, [loadError, loading, journals, symbol, symbolScoped, onlyUnclassified, onlyClosed]);

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

      <main className="max-w-[1600px] mx-auto px-6 py-4 grid grid-cols-1 xl:grid-cols-[300px_1fr] gap-4">
        <aside className="bg-card border border-border rounded p-4 space-y-4 self-start xl:sticky xl:top-[80px]">
          <div className="space-y-2">
            <div className="text-[12px] font-medium">筛选 journals</div>
            <select
              value={symbol}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => setSymbol(e.target.value)}
              className="h-9 w-full rounded border border-border bg-background px-3 text-[12px]"
            >
              <option value="">请选择标的（批量操作必须同标的）</option>
              {availableSymbols.map(item => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <Input type="date" value={dateFrom} onChange={(e: ChangeEvent<HTMLInputElement>) => setDateFrom(e.target.value)} className="h-9 text-[12px]" />
              <Input type="date" value={dateTo} onChange={(e: ChangeEvent<HTMLInputElement>) => setDateTo(e.target.value)} className="h-9 text-[12px]" />
            </div>
            <div className="flex items-center justify-between rounded border border-border px-3 py-2 text-[12px]">
              <span>仅显示未归类</span>
              <Switch checked={onlyUnclassified} onCheckedChange={setOnlyUnclassified} />
            </div>
            <div className="flex items-center justify-between rounded border border-border px-3 py-2 text-[12px]">
              <span>仅显示已平仓</span>
              <Switch checked={onlyClosed} onCheckedChange={setOnlyClosed} />
            </div>
          </div>

          <div className="space-y-2 rounded border border-border p-3">
            <div className="text-[12px] font-medium">统计</div>
            <div className="text-[12px] text-muted-foreground">总数：{stats.total} 个 journals</div>
            <div className="text-[12px] text-muted-foreground">未归类：{stats.unclassified}</div>
            <div className="text-[12px] text-muted-foreground">已归类：{stats.classified}</div>
            <div className="text-[12px] text-muted-foreground">当前筛选结果：{stats.current}</div>
            <div className="text-[12px] text-muted-foreground">当前已平仓：{stats.currentClosed}</div>
            <div className="text-[11px] text-muted-foreground">仅同标的归类有效，如果跨标的需要分批处理。</div>
          </div>

          <div className="rounded bg-muted/30 p-3 text-[11px] text-muted-foreground whitespace-pre-line">
            操作流程：
            {'\n'}① 筛选目标标的 + 日期范围
            {'\n'}② 勾选属于同一战役的 journals
            {'\n'}③ 点击底部“归类为新战役”或“加入现有战役”
            {'\n'}④ 在弹窗中为每条 leg 指定角色
          </div>

          <div className="rounded border border-border bg-background/50 p-3 text-[11px] text-muted-foreground">
            历史归类不会补录缺失的实时事件。像 hedge_cancelled / hedge_placed 的精确时机无法从历史 journal 反推出，后续 SOP 评分会明确标注“仅供参考”。
          </div>
        </aside>

        <section className="bg-card border border-border rounded overflow-hidden">
          {!symbol ? (
            <div className="h-[480px] flex items-center justify-center text-[13px] text-muted-foreground">
              请先在左侧选择标的
            </div>
          ) : loading ? (
            <div className="h-[480px] flex items-center justify-center text-[13px] text-muted-foreground">
              加载中…
            </div>
          ) : (
            <>
              <div className="grid grid-cols-[40px_100px_72px_72px_90px_80px_100px_90px_90px_1fr] h-9 bg-muted/40 text-[10px] text-muted-foreground items-center px-3">
                <div className="flex items-center">
                  <Checkbox
                    checked={allCurrentSelected ? true : someCurrentSelected ? 'indeterminate' : false}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setSelectedIds(prev => [...new Set([...prev, ...filtered.map(journal => journal.id)])]);
                      } else {
                        setSelectedIds(prev => prev.filter(id => !filtered.some(journal => journal.id === id)));
                      }
                    }}
                  />
                </div>
                <div>时间</div>
                <div>方向</div>
                <div>类型</div>
                <div>价格</div>
                <div>仓位</div>
                <div>平仓时间</div>
                <div>平仓价</div>
                <div>平仓方式</div>
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
                  filtered.map(journal => {
                    const record = journal.trade_record_id ? tradeRecordMap.get(journal.trade_record_id) ?? null : null;
                    const campaign = journal.campaign_id ? campaignMap.get(journal.campaign_id) ?? null : null;
                    const suggestion = suggestionMap.get(journal.id);
                    return (
                      <div
                        key={journal.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => window.open(`/journal/${journal.id}`, '_blank', 'noopener,noreferrer')}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') window.open(`/journal/${journal.id}`, '_blank', 'noopener,noreferrer');
                        }}
                      className="grid grid-cols-[40px_100px_72px_72px_90px_80px_100px_90px_90px_1fr] min-h-9 hover:bg-accent text-[11px] font-mono items-center px-3 py-1 border-t border-border/30"
                      >
                        <div onClick={event => event.stopPropagation()}>
                          <Checkbox
                            checked={selectedIds.includes(journal.id)}
                            onCheckedChange={(checked) => {
                              setSelectedIds(prev => checked
                                ? [...new Set([...prev, journal.id])]
                                : prev.filter(id => id !== journal.id));
                            }}
                          />
                        </div>
                        <div>{fmtTime(journal.pre_simulated_time)}</div>
                        <div className={journal.direction === 'short' ? 'text-[#F6465D]' : 'text-[#0ECB81]'}>
                          {journal.direction === 'short' ? 'SHORT' : 'LONG'}
                        </div>
                        <div>{journal.order_kind === 'main' ? '主力' : '对冲'}</div>
                        <div>{fmtPrice(journal.pre_entry_price)}</div>
                        <div>{journal.pre_position_size?.toFixed(2) ?? '—'}</div>
                        <div>{fmtTime(record?.closeTime)}</div>
                        <div>{fmtPrice(record?.exitPrice)}</div>
                        <div>{exitMethodLabel(record)}</div>
                        <div className="min-w-0" onClick={event => event.stopPropagation()}>
                          <div className="flex items-center gap-2 min-w-0">
                            {!journal.campaign_id || !campaign ? (
                              <span className="text-muted-foreground">未归类</span>
                            ) : (
                              <>
                                <Link to={`/journal/campaigns/${campaign.id}`} className="truncate text-[#5BA3FF] hover:underline">
                                  {campaign.title}
                                </Link>
                                {journal.leg_role && <LegRoleChip role={journal.leg_role} short />}
                              </>
                            )}
                            {suggestion && !journal.campaign_id && (
                              <span className="truncate text-[10px] text-muted-foreground">
                                建议：{LEG_ROLE_LABELS[suggestion.suggestedRole]}
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

      {selectedJournals.length > 0 && (
        <div className="sticky bottom-0 z-20 bg-card border-t border-border px-6 py-3">
          <div className="max-w-[1600px] mx-auto flex flex-wrap items-center justify-between gap-3">
            <div className="text-[12px]">已选 {selectedJournals.length} 条 journals</div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="h-8 rounded px-3 text-[12px] text-muted-foreground hover:bg-accent"
                onClick={() => setSelectedIds(prev => [...new Set([...prev, ...filtered.map(journal => journal.id)])])}
              >
                全选当前页
              </button>
              <button
                type="button"
                className="h-8 rounded px-3 text-[12px] text-muted-foreground hover:bg-accent"
                onClick={() => setSelectedIds([])}
              >
                清除选择
              </button>
              <button
                type="button"
                disabled={!allSelectedClassified}
                className="h-8 rounded bg-muted px-3 text-[12px] disabled:opacity-50"
                onClick={async () => {
                  if (!allSelectedClassified) return;
                  if (!window.confirm(`确认解除这 ${selectedJournals.length} 条 journal 的战役归属吗？`)) return;
                  try {
                    for (const journal of selectedJournals) {
                      await detachJournalFromCampaign(journal.id);
                    }
                    toast.success('已解除所选 journals 的归属');
                    setSelectedIds([]);
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
        journals={selectedJournals}
        onCreated={async (campaignId) => {
          setSelectedIds([]);
          await loadData();
          nav(`/journal/campaigns/${campaignId}`);
        }}
      />
      <AddToExistingCampaignDialog
        open={attachDialogOpen}
        onOpenChange={setAttachDialogOpen}
        campaigns={activeCampaigns}
        journals={selectedJournals}
        symbol={symbol}
        onAttached={async (campaignId) => {
          setSelectedIds([]);
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
