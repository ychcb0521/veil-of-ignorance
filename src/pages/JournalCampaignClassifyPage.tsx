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
import { buildTradeRecordLookup } from '@/lib/objectiveOperationTime';
import { getPositionNotionalUsd } from '@/lib/tradingSettlement';
import type { TradeCampaign, TradeJournal, SuggestedLegRole } from '@/types/journal';
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

const pad2 = (n: number) => String(n).padStart(2, '0');

function toDate(value: string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * 列内单行：MM-DD HH:mm:ss。年份进 title。
 * 曾经用 \n 堆成两行（日期一行、时分秒一行），每一行都两行高，14 条记录撑满整屏。
 * 秒必须留在列内：加仓腿常常同一分钟内连开两刀，先后顺序只能靠秒判定，
 * 藏进悬停等于删掉。
 */
function fmtClock(value: string | number | null | undefined): string {
  const d = toDate(value);
  if (!d) return '—';
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function fmtClockFull(value: string | number | null | undefined): string | undefined {
  const d = toDate(value);
  if (!d) return undefined;
  return `${d.getFullYear()}-${fmtClock(value)}`;
}

/** 建议置信度圆点。用主题 token，亮色下不会像硬编码绿那样对比度崩掉。 */
const CONFIDENCE_DOT: Record<SuggestedLegRole['confidence'], string> = {
  high: 'bg-trading-green',
  medium: 'bg-primary',
  low: 'bg-muted-foreground',
};

/**
 * 订单类型。决定这一行在战役里是什么角色的字段恰恰是 order_kind
 * （整套 legRoleSuggestion 建立在它之上），而此前表里唯一看不到的就是它。
 */
const ORDER_KIND_LABEL: Record<string, string> = { main: '主力', hedge: '对冲' };

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

/** 可点排序的表头。当前列显示方向箭头，其余列悬停才提示可点。 */
function SortableTh({ sortKey, label, align, hint, active, asc, onSort }: {
  sortKey: SortKey; label: string; align: 'left' | 'right'; hint: string;
  active: SortKey; asc: boolean; onSort: (key: SortKey) => void;
}) {
  const isActive = active === sortKey;
  return (
    <th className={`px-3 py-2 font-medium whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        type="button"
        data-testid={`sort-${sortKey}`}
        aria-sort={isActive ? (asc ? 'ascending' : 'descending') : 'none'}
        title={`${hint}点击按${SORT_LABELS[sortKey]}排序`}
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 transition-colors hover:text-foreground ${isActive ? 'text-foreground' : ''}`}
      >
        {label}
        <span aria-hidden className={isActive ? '' : 'opacity-0'}>{asc ? '↑' : '↓'}</span>
      </button>
    </th>
  );
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
  // 排序：默认按「操作时间」倒序——这一页是事后归类，真实动手的先后比模拟开仓时间更贴近回忆。
  const [sortKey, setSortKey] = useState<SortKey>('operationTime');
  const [sortAsc, setSortAsc] = useState(false);
  // 没有成交记录的 journal（挂单被撤、从未触发）不是一笔交易，默认不列；
  // 但绝不静默吞掉——汇总行会写明隐藏了几条，一键可以放出来。
  const [showUnfilled, setShowUnfilled] = useState(false);
  const applySort = useCallback((key: SortKey) => {
    setSortKey(current => {
      if (current === key) { setSortAsc(prev => !prev); return current; }
      setSortAsc(false);
      return key;
    });
  }, []);
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
  // 用 buildTradeRecordLookup 而不是裸 Map(record.id → record)：
  // 实盘「记录决策」的腿把 onPlaceOrder 返回的**仓位 id** 写进了 trade_record_id，
  // 回填的腿写的才是成交 id。只按成交 id 查，前一类真实成交的腿会整行显示「—」，
  // 看起来像「没成交」，既误导人，也会被下面的有效性过滤误伤。
  const tradeRecordMap = useMemo(() => buildTradeRecordLookup(tradeHistory), [tradeHistory]);
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
        /**
         * 去重放在这一层，因为这里两份名单同时在手：日志行与裸记录行。
         *
         * 一笔成交经合并仓位平仓会拆成多条分片记录，而它若记过决策，日志的
         * trade_record_id 就等于该成交的 fillId（handlePlaceOrder 返回的正是成交自己的 id）。
         * 所以同一笔成交可能既有日志行、又有分片行——按 fillId 一并排除，
         * 让它只以日志行出现一次。
         *
         * 关键是这个排除**只对本页真正列出的日志生效**：日志若被日期/标的/已归类
         * 筛掉，journalRecordIds 里就没有它，分片行照常显示。
         * 这条不变量保证「每笔成交至少有一个入口」，而在数据层做同样的过滤会破坏它。
         */
        ...classifiableTradeHistory
          .filter(record => !journalRecordIds.has(record.id)
            && !(record.fillId && journalRecordIds.has(record.fillId)))
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
  // 建议必须按标的分组、且只算尚未归类的 journal。
  // 此前整张账号的 journal 一股脑喂给 suggestLegRoles，而它内部的 mainAddCount 是
  // 全局累加的——于是 RAVE 这张表上的「加仓6」可能在数别的币的加仓次数，
  // 已归类的腿还会把计数器推高。建议于是失去信息：所有行都是同一个「加仓6」。
  const suggestionMap = useMemo(() => {
    const bySymbol = new Map<string, TradeJournal[]>();
    for (const journal of allCandidateJournals) {
      if (journal.campaign_id) continue;
      const key = (journal.symbol ?? '').toUpperCase();
      const bucket = bySymbol.get(key) ?? [];
      bucket.push(journal);
      bySymbol.set(key, bucket);
    }
    const map = new Map<string, SuggestedLegRole>();
    // 初始对冲 A / B 认的是「委托价与触发价都压在主力开仓价上」。主力的计划价
    // 和实际成交价常差一个滑点，而对冲是照实际成本线挂的——两个价都交给判据。
    const filledEntryPrice = (journal: TradeJournal) => (
      journal.trade_record_id ? tradeRecordMap.get(journal.trade_record_id)?.entryPrice ?? null : null
    );
    for (const bucket of bySymbol.values()) {
      for (const item of suggestLegRoles(filteredForSuggestions(bucket), { filledEntryPrice })) {
        map.set(item.journalId, item);
      }
    }
    return map;
  }, [allCandidateJournals, tradeRecordMap]);

  const symbolScoped = useMemo(
    () => {
      const normalized = symbol.trim().toUpperCase();
      return allItems.filter(item => !normalized || itemSymbol(item).toUpperCase().startsWith(normalized));
    },
    [allItems, symbol],
  );
  /**
   * 该项是否成交过——判据与本页三态措辞保持一致，否则会自相矛盾：
   *   有 trade_record_id、但本地查不到记录 → 界面写「已成交 · 成交记录未载入」，
   *   那是一笔真交易，只是记录没载入，不能因为查不到就当它不存在。
   * 没有 trade_record_id 的才是「挂单中」「未触发取消」——从未成为一笔交易。
   * 裸记录进来时已经只剩 CLOSE / LIQUIDATION，恒为真。
   */
  const isFilled = useCallback(
    (item: ClassifiableItem) => item.kind === 'orphanRecord' || Boolean(item.journal.trade_record_id),
    [],
  );

  // 未归类 + 落在日期范围内。有效性单独一层，好数出「隐藏了几条」。
  const unclassified = useMemo(() => {
    return symbolScoped.filter(item => {
      const timeMs = itemTimeMs(item);
      if (dateFrom && timeMs < new Date(`${dateFrom}T00:00:00`).getTime()) return false;
      if (dateTo && timeMs > new Date(`${dateTo}T23:59:59`).getTime()) return false;
      if (item.kind === 'journal' && item.journal.campaign_id) return false;
      if (item.kind === 'orphanRecord' && recordCampaignMap.has(item.record.id)) return false;
      return true;
    });
  }, [symbolScoped, dateFrom, dateTo, recordCampaignMap]);

  const unfilledCount = useMemo(
    () => unclassified.filter(item => !isFilled(item)).length,
    [unclassified, isFilled],
  );

  const filtered = useMemo(() => {
    const rows = showUnfilled ? unclassified : unclassified.filter(isFilled);
    const dir = sortAsc ? 1 : -1;
    return [...rows].sort((a, b) => {
      const diff = sortValue(sortKey, a, tradeRecordMap.get(itemRecordRef(a) ?? '') ?? null, a)
        - sortValue(sortKey, b, tradeRecordMap.get(itemRecordRef(b) ?? '') ?? null, b);
      // 同值时退回开仓时间倒序，避免每次渲染顺序抖动
      return (diff !== 0 ? diff * dir : itemTimeMs(b) - itemTimeMs(a));
    });
  }, [unclassified, showUnfilled, isFilled, sortKey, sortAsc, tradeRecordMap]);

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
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-2 text-[11px] text-muted-foreground">
              <span>
                {filteredJournalCount === 0 && filteredOrphanCount === 0
                  ? '该标的暂无可归类项'
                  : `共 ${filteredJournalCount} 个 journal · ${filteredOrphanCount} 条仓位历史记录`}
              </span>
              {/* 过滤掉的东西必须能看见：只说「隐藏了几条」还不够，得给一键放出来的入口，
                  否则一条本该归类的腿被判成「没成交」时，用户永远不会知道它去哪了。 */}
              {unfilledCount > 0 && (
                <button
                  type="button"
                  data-testid="toggle-unfilled"
                  onClick={() => setShowUnfilled(v => !v)}
                  className="underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground"
                  title="没有成交记录的 journal：挂单被撤、或从未触发。它们不是一笔交易，默认不列。"
                >
                  {showUnfilled ? `隐藏 ${unfilledCount} 条无成交记录` : `另有 ${unfilledCount} 条无成交记录 · 显示`}
                </button>
              )}
              <span className="ml-auto">
                按{SORT_LABELS[sortKey]}{sortAsc ? '升序' : '倒序'}
              </span>
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
                <table className="w-full min-w-[1200px] table-fixed text-[11px] font-mono tabular-nums">
                  {/* 列宽契约写死在 colgroup 里（table-fixed 下才真正生效）。
                      固定列合计 1064px，余量全给最右的「归属 / 建议」，
                      1280 笔电（内容区 ≈1232px）不出横向滚动条。 */}
                  <colgroup>
                    <col style={{ width: 40 }} />
                    <col style={{ width: 184 }} />
                    <col style={{ width: 92 }} />
                    <col style={{ width: 124 }} />
                    <col style={{ width: 88 }} />
                    <col style={{ width: 92 }} />
                    <col style={{ width: 124 }} />
                    <col style={{ width: 56 }} />
                    <col style={{ width: 140 }} />
                    <col style={{ width: 124 }} />
                    <col />
                  </colgroup>
                  <thead className="sticky top-0 z-10 bg-card">
                    <tr className="border-b border-border bg-muted/35 text-[11px] text-muted-foreground">
                      <th className="px-3 py-2 text-left font-medium">
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
                      <th className="px-3 py-2 text-left font-medium whitespace-nowrap">合约 · 方向</th>
                      <th className="px-3 py-2 text-right font-medium whitespace-nowrap">开仓均价</th>
                      <SortableTh sortKey="openTime" label="开仓时间" align="left" hint="" active={sortKey} asc={sortAsc} onSort={applySort} />
                      <th className="px-3 py-2 text-right font-medium whitespace-nowrap">数量</th>
                      <th className="px-3 py-2 text-right font-medium whitespace-nowrap">平仓均价</th>
                      <SortableTh sortKey="closeTime" label="平仓时间" align="left" hint="" active={sortKey} asc={sortAsc} onSort={applySort} />
                      <th className="px-3 py-2 text-left font-medium whitespace-nowrap">方式</th>
                      <SortableTh sortKey="pnl" label="盈亏 / ROE" align="right" hint="" active={sortKey} asc={sortAsc} onSort={applySort} />
                      <SortableTh sortKey="operationTime" label="操作时间" align="left" hint="真实钱包时钟下的操作时刻；老记录没有，不用模拟时间冒充。" active={sortKey} asc={sortAsc} onSort={applySort} />
                      <th className="px-3 py-2 text-left font-medium whitespace-nowrap">归属 / 建议</th>
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
                      // 一行只有真的平过仓才有已实现盈亏。未平仓的 journal 其 post_realized_pnl
                      // 可能落库为 0——那是「没有数据」不是「打平」。
                      const journalClosed = Boolean(
                        journal?.post_simulated_close_time
                        || journal?.post_real_close_time
                        || journal?.post_outcome,
                      );
                      const pnl = record
                        ? record.pnl
                        : (journalClosed ? journal?.post_realized_pnl ?? null : null);
                      const roe = roeFromRecord(record);
                      const operationTime = operationTimeForItem(item, record);
                      const openTime = record?.openTime ?? journal?.pre_simulated_time;
                      const orderKindLabel = journal?.order_kind ? (ORDER_KIND_LABEL[journal.order_kind] ?? journal.order_kind) : null;
                      // 没有成交记录的行，平仓侧五格折成一句话——措辞复用下一屏
                      // （ClassifyAsNewCampaignDialog）已有的三态，不另造词：
                      // 一张从未触发、已被取消的对冲挂单，和一笔还持着的仓位，要不要收进同一场战役是完全不同的判断。
                      const closeSideNote = record
                        ? null
                        : journal?.trade_record_id
                          ? '已成交 · 成交记录未载入'
                          : journal?.order_kind === 'hedge'
                            ? '未触发取消 · 无成交'
                            : '挂单中 · 尚未平仓';
                      const pnlTone = typeof pnl !== 'number' ? 'text-muted-foreground' : pnl >= 0 ? 'text-trading-green' : 'text-trading-red';
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
                          className={`h-8 border-b border-border/40 ${rowClickable ? 'cursor-pointer hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring' : ''}`}
                        >
                          <td className="px-3 py-1.5" onClick={event => event.stopPropagation()}>
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
                          {/* 合约字符串保持单一文本节点（测试按整串 getByText）；
                              方向徽标 ml-auto 贴右——一场战役只有一个方向，它是勾选时的第一判别式，必须成一条竖线。 */}
                          <td className="px-3 py-1.5 whitespace-nowrap">
                            <span className="flex items-center gap-1.5">
                              <span className="min-w-0 truncate font-medium text-foreground">{fmtContractForItem(item, record)}</span>
                              {orderKindLabel && (
                                <span className="shrink-0 rounded-sm bg-muted px-1 text-[10px] leading-4 text-muted-foreground">{orderKindLabel}</span>
                              )}
                              <span className={`ml-auto shrink-0 rounded-sm px-1.5 text-[10px] font-bold leading-4 ${direction === 'short' ? 'bg-trading-red/15 text-trading-red' : 'bg-trading-green/15 text-trading-green'}`}>
                                {direction === 'short' ? '空' : '多'}{leverage ? ` ${leverage}x` : ''}
                              </span>
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-right text-foreground whitespace-nowrap">{fmtPrice(entryPrice)}</td>
                          <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap" title={fmtClockFull(openTime)}>{fmtClock(openTime)}</td>
                          {closeSideNote ? (
                            <td colSpan={5} className="px-3 py-1.5 text-muted-foreground/70 whitespace-nowrap">{closeSideNote}</td>
                          ) : (
                            <>
                              <td className="px-3 py-1.5 text-right text-foreground whitespace-nowrap">{fmtAmount(quantity)}</td>
                              <td className="px-3 py-1.5 text-right text-foreground whitespace-nowrap">{fmtPrice(exitPrice)}</td>
                              <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap" title={fmtClockFull(record?.closeTime)}>{fmtClock(record?.closeTime)}</td>
                              <td className="px-3 py-1.5 whitespace-nowrap">{exitMethodLabel(record)}</td>
                              <td className={`px-3 py-1.5 text-right whitespace-nowrap font-bold ${pnlTone}`}>
                                {fmtSignedUsdt(pnl)}
                                {typeof roe === 'number' && (
                                  <span className="ml-1.5 font-medium opacity-80">{fmtRoe(roe)}</span>
                                )}
                              </td>
                            </>
                          )}
                          <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap" title={fmtClockFull(operationTime)}>{fmtClock(operationTime)}</td>
                          <td className="px-3 py-1.5 whitespace-nowrap" onClick={event => event.stopPropagation()}>
                            <div className="flex min-w-0 items-center gap-2 overflow-hidden text-[11px]">
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
                                <span
                                  className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-muted px-1.5 text-[10px] leading-4 text-muted-foreground"
                                  title={`建议 ${LEG_ROLE_LABELS[suggestion.suggestedRole]} · ${suggestion.reason}`}
                                >
                                  <span className={`h-1.5 w-1.5 rounded-full ${CONFIDENCE_DOT[suggestion.confidence]}`} aria-hidden />
                                  {LEG_ROLE_LABELS[suggestion.suggestedRole]}
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

/** 可点表头排序的列。只列真正能比出先后的，文本列不掺进来。 */
type SortKey = 'operationTime' | 'openTime' | 'closeTime' | 'pnl';

const SORT_LABELS: Record<SortKey, string> = {
  operationTime: '操作时间',
  openTime: '开仓时间',
  closeTime: '平仓时间',
  pnl: '平仓盈亏',
};

function itemRecordRef(item: ClassifiableItem): string | null {
  return item.kind === 'journal' ? item.journal.trade_record_id ?? null : item.record.id;
}

/**
 * 排序取值。缺值一律排到最后（升序取 +∞、降序由调用方乘 −1 后自然落底），
 * 而不是当成 0 —— 未平仓的行混进盈亏最差的一档会误导判断。
 */
function sortValue(
  key: SortKey,
  item: ClassifiableItem,
  record: TradeRecord | null,
  original: ClassifiableItem,
): number {
  if (key === 'openTime') return itemTimeMs(original);
  if (key === 'closeTime') return record?.closeTime || Number.NEGATIVE_INFINITY;
  if (key === 'pnl') {
    const pnl = record?.pnl;
    return typeof pnl === 'number' && Number.isFinite(pnl) ? pnl : Number.NEGATIVE_INFINITY;
  }
  return operationTimeForItem(item, record) ?? Number.NEGATIVE_INFINITY;
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
