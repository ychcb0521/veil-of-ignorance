/**
 * /journal — 错题集。
 *
 * 默认页是「汇总」：把开仓快照 / 平仓评价的每个问题做成一行可展开，
 * 展开后看到的是历史全部主力单在这个问题上的答案分布 / 列表 / 数值统计。
 * 旁边并列三个 tab：结构成熟度、盲区（手动登记你没预想到的错）、待复盘。
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { BackButton } from '@/components/journal/BackButton';
import { useAuth } from '@/contexts/AuthContext';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { listAllJournalDataForUser, type BulkJournalData } from '@/lib/journalApi';
import { useBlindSpots } from '@/lib/blindSpots';
import { JournalSummaryView } from '@/components/journal/JournalSummaryView';
import { StructureMaturityView } from '@/components/journal/StructureMaturityView';
import { BlindSpotModule } from '@/components/journal/BlindSpotModule';
import { UnreviewedJournalList } from '@/components/journal/UnreviewedJournalList';

type View = 'summary' | 'structures' | 'blindspots' | 'unreviewed';

export default function JournalListPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();

  const [data, setData] = useState<BulkJournalData | null>(null);
  const [loading, setLoading] = useState(true);

  const blindSpots = useBlindSpots(user?.id);

  const view = (params.get('view') ?? 'summary') as View;

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      try {
        const all = await listAllJournalDataForUser(user.id);
        // 数据量极大时只看最近 90 天，避免一次性拉全量。
        if (all.journals.length > 1000) {
          const since = new Date(Date.now() - 90 * 86400000).toISOString();
          setData(await listAllJournalDataForUser(user.id, { dateFrom: since }));
        } else {
          setData(all);
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  // 错题集只看真实交易；'太难'(no_trade) 记录只在元监控展示，不进误差。
  const tradeJournals = useMemo(
    () => (data?.journals ?? []).filter(j => (j.journal_kind ?? 'trade') === 'trade'),
    [data?.journals],
  );
  const unreviewedCount = useMemo(
    () => (data?.journals ?? []).filter(j => j.trade_record_id && !j.post_reviewed_at).length,
    [data?.journals],
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
          <JournalSummaryView journals={tradeJournals} />
        )}

        {view === 'structures' && <StructureMaturityView journals={tradeJournals} />}

        {view === 'blindspots' && (
          <BlindSpotModule items={blindSpots.items} onAdd={blindSpots.add} onRemove={blindSpots.remove} />
        )}

        {view === 'unreviewed' && (
          <UnreviewedJournalList
            journals={tradeJournals}
            onReviewed={() => {
              if (user) {
                listAllJournalDataForUser(user.id).then(setData).catch(e => toast.error(String(e)));
              }
            }}
          />
        )}
      </main>
    </div>
  );
}
