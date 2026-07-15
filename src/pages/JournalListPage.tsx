/**
 * /journal — 错题集。
 *
 * 默认页是「汇总」：把开仓快照 / 平仓评价的每个问题做成一行可展开，
 * 展开后看到的是历史全部主力单在这个问题上的答案分布 / 列表 / 数值统计。
 * 旁边并列三个 tab：结构成熟度、盲区（手动登记你没预想到的错）、待复盘。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { BackButton } from '@/components/journal/BackButton';
import { useAuth } from '@/contexts/AuthContext';
import { useTradingContext } from '@/contexts/TradingContext';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { listAllCampaigns, listAllJournalDataForUser, type BulkJournalData } from '@/lib/journalApi';
import { applyLocalMirror } from '@/lib/journalLocalMirror';
import { buildJournalCampaignIdIndex } from '@/lib/journalCampaignNavigation';
import { useBlindSpots } from '@/lib/blindSpots';
import { JournalSummaryView } from '@/components/journal/JournalSummaryView';
import { StructureMaturityView } from '@/components/journal/StructureMaturityView';
import { BlindSpotModule } from '@/components/journal/BlindSpotModule';
import { UnreviewedJournalList } from '@/components/journal/UnreviewedJournalList';
import type { TradeCampaign } from '@/types/journal';
import { buildUnreviewedLongMainItems } from '@/lib/unreviewedLongMainTrades';

type View = 'summary' | 'structures' | 'blindspots' | 'unreviewed';

export default function JournalListPage() {
  const { user } = useAuth();
  const { tradeHistory } = useTradingContext();
  const [params, setParams] = useSearchParams();

  const [data, setData] = useState<BulkJournalData | null>(null);
  const [campaigns, setCampaigns] = useState<TradeCampaign[]>([]);
  const [loading, setLoading] = useState(true);

  const blindSpots = useBlindSpots(user?.id);

  const view = (params.get('view') ?? 'summary') as View;

  /**
   * 重新拉数据。silent=true 时不切 loading（用于背景刷新，避免页面闪屏）。
   * 用于：① mount 首次拉；② 平仓评价完成事件；③ 页面从隐藏切回可见；④ 待复盘列表完成评价回调。
   */
  const reloadData = useCallback(async (silent = false) => {
    if (!user) return;
    if (!silent) setLoading(true);
    try {
      const campaignsPromise = listAllCampaigns(user.id).catch(() => [] as TradeCampaign[]);
      const all = await listAllJournalDataForUser(user.id);
      // 本地镜像兜底：远程库 schema 漂移时本地存了一份完整字段，合并回去——
      // 用户单设备上始终能看到自己填的所有内容，不受远程缺列影响。
      const applyMirror = (d: BulkJournalData): BulkJournalData =>
        ({ ...d, journals: applyLocalMirror(user.id, d.journals) });
      // API 已分页拉全历史；不再在记录多时退化为最近 90 天，否则待复盘与汇总会漏币种。
      setCampaigns(await campaignsPromise);
      setData(applyMirror(all));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void reloadData(false);
  }, [reloadData]);

  /**
   * 监听全局事件：
   * - 'journal:reviewed' 由 PostTradeReviewSheet 保存评价时发出，覆盖
   *   "用户在别处做完评价、回到错题集看不到"的核心场景；
   * - 'visibilitychange' 兜底：用户从其他 tab / 窗口切回时也刷新一次。
   */
  useEffect(() => {
    if (!user) return;
    const onReviewed = () => { void reloadData(true); };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reloadData(true);
    };
    window.addEventListener('journal:reviewed', onReviewed);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('journal:reviewed', onReviewed);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user, reloadData]);

  // 错题集只看真实交易；'太难'(no_trade) 记录只在元监控展示，不进误差。
  const tradeJournals = useMemo(
    () => (data?.journals ?? []).filter(j => (j.journal_kind ?? 'trade') === 'trade'),
    [data?.journals],
  );
  const navigableTradeJournals = useMemo(() => {
    const index = buildJournalCampaignIdIndex(tradeJournals, campaigns);
    return tradeJournals.map(journal => (
      index[journal.id] && journal.campaign_id !== index[journal.id]
        ? { ...journal, campaign_id: index[journal.id] }
        : journal
    ));
  }, [campaigns, tradeJournals]);
  const unreviewedCount = useMemo(
    () => buildUnreviewedLongMainItems(data?.journals ?? [], tradeHistory).length,
    [data?.journals, tradeHistory],
  );

  const setView = (v: string) => {
    const next = new URLSearchParams(params);
    if (v === 'summary') next.delete('view');
    else next.set('view', v);
    setParams(next, { replace: true });
  };

  if (loading || !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground text-sm font-mono">加载中…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="px-6 py-3 max-w-[1000px] mx-auto flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <BackButton />
            <div className="min-w-0">
              <h1 className="text-[14px] font-medium leading-tight">错题集</h1>
              <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                把错误按类型归集，看见它、消除它
              </div>
            </div>
          </div>
          <div className="flex-1" />
          <Tabs value={view} onValueChange={setView}>
            <TabsList className="h-8 bg-card">
              <TabsTrigger value="summary" className="text-[12px] h-7 px-3">汇总</TabsTrigger>
              <TabsTrigger value="structures" className="text-[12px] h-7 px-3">结构成熟度</TabsTrigger>
              <TabsTrigger value="blindspots" className="text-[12px] h-7 px-3">
                盲区{blindSpots.items.length > 0 ? ` ${blindSpots.items.length}` : ''}
              </TabsTrigger>
              <TabsTrigger value="unreviewed" className="text-[12px] h-7 px-3">
                待复盘{unreviewedCount > 0 ? ` ${unreviewedCount}` : ''}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </header>

      <main className="max-w-[1000px] mx-auto px-6 py-5">
        {view === 'summary' && (
          <JournalSummaryView journals={navigableTradeJournals} />
        )}

        {view === 'structures' && <StructureMaturityView journals={navigableTradeJournals} />}

        {view === 'blindspots' && (
          <BlindSpotModule items={blindSpots.items} onAdd={blindSpots.add} onRemove={blindSpots.remove} />
        )}

        {view === 'unreviewed' && (
          <UnreviewedJournalList
            journals={tradeJournals}
            onReviewed={() => { void reloadData(true); }}
          />
        )}
      </main>
    </div>
  );
}
