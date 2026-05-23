/**
 * /journal — 错题集主入口页（按模式聚类）
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Tag } from 'lucide-react';
import { BackButton } from '@/components/journal/BackButton';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { listAllJournalDataForUser, type BulkJournalData } from '@/lib/journalApi';
import {
  groupJournalsByPattern, sortClusters, computeMetaAlerts,
} from '@/lib/journalAggregations';
import { JournalFilterBar, getFilteredJournals } from '@/components/journal/JournalFilterBar';
import { PatternClusterCard } from '@/components/journal/PatternClusterCard';
import { JournalTimelineList } from '@/components/journal/JournalTimelineList';
import { UnreviewedJournalList } from '@/components/journal/UnreviewedJournalList';
import { JournalStatsSidebar } from '@/components/journal/JournalStatsSidebar';
import { JournalMetaAlerts } from '@/components/journal/JournalMetaAlerts';

type SortKey = 'severity' | 'frequency' | 'pnl' | 'recent';

export default function JournalListPage() {
  const nav = useNavigate();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [params, setParams] = useSearchParams();

  const [data, setData] = useState<BulkJournalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [largeDataset, setLargeDataset] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('severity');
  const [expandAllSignal, setExpandAllSignal] = useState<boolean | null>(null);

  const view = (params.get('view') ?? 'patterns') as 'patterns' | 'timeline' | 'unreviewed';

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      try {
        // 先粗查所有数据，> 1000 则限 90 天
        const all = await listAllJournalDataForUser(user.id);
        if (all.journals.length > 1000) {
          setLargeDataset(true);
          const since = new Date(Date.now() - 90 * 86400000).toISOString();
          const limited = await listAllJournalDataForUser(user.id, { dateFrom: since });
          setData(limited);
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

  const categoriesById = useMemo(
    () => new Map((data?.categories ?? []).map(c => [c.id, c.name_zh])),
    [data?.categories],
  );

  const filteredJournals = useMemo(
    () => (data ? getFilteredJournals(data.journals, params, categoriesById) : []),
    [data, params, categoriesById],
  );

  const clusters = useMemo(() => {
    if (!data) return [];
    const selectedCats = new Set((params.get('cats') ?? '').split(',').filter(Boolean));
    let cs = groupJournalsByPattern(filteredJournals, data.assignments, data.patterns, data.categories);
    if (selectedCats.size > 0) cs = cs.filter(c => selectedCats.has(c.category.id));
    return sortClusters(cs, sortKey);
  }, [data, filteredJournals, params, sortKey]);

  const alerts = useMemo(
    () => (data ? computeMetaAlerts(clusters, filteredJournals) : []),
    [data, clusters, filteredJournals],
  );

  const rangeDays = useMemo(() => {
    const r = params.get('range') ?? '30d';
    return ({ '7d': 7, '30d': 30, '90d': 90, all: 9999 } as Record<string, number>)[r] ?? 30;
  }, [params]);

  const setView = (v: string) => {
    const next = new URLSearchParams(params);
    if (v === 'patterns') next.delete('view'); else next.set('view', v);
    setParams(next, { replace: true });
  };

  if (loading || !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground text-sm font-mono">加载中…</div>
      </div>
    );
  }

  const sidebar = (
    <JournalStatsSidebar
      journals={filteredJournals}
      assignments={data.assignments.filter(a => filteredJournals.some(j => j.id === a.journal_id))}
      clusters={clusters}
      rangeDays={rangeDays}
    />
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="px-6 py-3 max-w-[1600px] mx-auto flex items-center gap-3">
          <BackButton />
          <h1 className="text-[14px] font-medium">错题集</h1>
          <div className="flex-1" />
          <Tabs value={view} onValueChange={setView}>
            <TabsList className="h-8 bg-card">
              <TabsTrigger value="patterns" className="text-[12px] h-7 px-3">按模式</TabsTrigger>
              <TabsTrigger value="timeline" className="text-[12px] h-7 px-3">按时间</TabsTrigger>
              <TabsTrigger value="unreviewed" className="text-[12px] h-7 px-3">未评价</TabsTrigger>
            </TabsList>
          </Tabs>
          <Link to="/journal/tags"
            className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground shrink-0">
            <Tag className="w-3.5 h-3.5" /> 标签字典
          </Link>
        </div>
      </header>

      <JournalFilterBar journals={data.journals} categories={data.categories} />

      <main className="max-w-[1600px] mx-auto px-6 py-4">
        {largeDataset && (
          <div className="mb-3 bg-[#F0B90B]/10 border border-[#F0B90B]/30 rounded px-3 py-1.5 text-[11px] text-[#F0B90B]">
            数据量较大，已默认限制为最近 90 天
          </div>
        )}

        {isMobile && (
          <Collapsible className="mb-3">
            <CollapsibleTrigger asChild>
              <Button variant="outline" size="sm" className="w-full h-8 text-[12px]">统计面板（点击展开）</Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">{sidebar}</CollapsibleContent>
          </Collapsible>
        )}

        <div className={isMobile ? '' : 'grid grid-cols-[1fr_320px] gap-4'}>
          <div className="min-w-0">
            <JournalMetaAlerts alerts={alerts} />

            {view === 'patterns' && (
              <>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="text-muted-foreground">排序</span>
                    {([
                      ['severity', '严重度'],
                      ['frequency', '频次'],
                      ['pnl', 'P&L'],
                      ['recent', '最近'],
                    ] as [SortKey, string][]).map(([k, l]) => (
                      <button key={k} onClick={() => setSortKey(k)}
                        className={`h-6 px-2 rounded ${sortKey === k ? 'bg-[#F0B90B] text-black' : 'bg-muted text-foreground hover:bg-[#363c45]'}`}>
                        {l}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 text-[11px]">
                    <Button size="sm" variant="ghost" className="h-6 text-[11px]"
                      onClick={() => setExpandAllSignal(true)}>全部展开</Button>
                    <Button size="sm" variant="ghost" className="h-6 text-[11px]"
                      onClick={() => setExpandAllSignal(false)}>全部收起</Button>
                  </div>
                </div>

                {clusters.length === 0 ? (
                  <div className="border border-border rounded p-10 text-center">
                    <div className="text-[40px] mb-2">📚</div>
                    <div className="text-[12px] text-muted-foreground">
                      尚无可聚类的错误模式 — 完成首笔交易评价后这里会有内容
                    </div>
                  </div>
                ) : (
                  clusters.map(c => (
                    <PatternClusterCard key={c.pattern.id} cluster={c} expandedSignal={expandAllSignal} />
                  ))
                )}
              </>
            )}

            {view === 'timeline' && (
              <JournalTimelineList
                journals={filteredJournals}
                assignments={data.assignments}
                patterns={data.patterns}
              />
            )}

            {view === 'unreviewed' && (
              <UnreviewedJournalList
                journals={data.journals}
                onReviewed={() => {
                  if (user) {
                    listAllJournalDataForUser(user.id).then(setData).catch(e => toast.error(String(e)));
                  }
                }}
              />
            )}
          </div>

          {!isMobile && (
            <div className="sticky top-[60px] self-start">{sidebar}</div>
          )}
        </div>
      </main>
    </div>
  );
}
