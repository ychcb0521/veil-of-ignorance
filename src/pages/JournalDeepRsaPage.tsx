/**
 * /journal/deep-rsa — Deep RSA：买方优势特征研究（复盘中心里「规则」正下方）。
 *
 * 只读研究页：不改原有功能和交易逻辑，不自动实盘，不编造结果。
 * 分组读数直接取交易战役列表同一份缓存行（与列表 / Excel 同一个数），不另算一套口径。
 * 【用户要求】从列表进详情再返回要回到原处：分组筛选放在 URL 上，点进战役前记下滚动位置。
 */
import { useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BackButton } from '@/components/journal/BackButton';
import { DeepRsaView } from '@/components/journal/DeepRsaView';
import { DeepRsaRunPanel } from '@/components/journal/DeepRsaRunPanel';
import { useAuth } from '@/contexts/AuthContext';
import { useTradingContext } from '@/contexts/TradingContext';
import { useCampaignList } from '@/hooks/useCampaignList';
import { useDeepRsaRun } from '@/hooks/useDeepRsaRun';
import { buildRunItems } from '@/lib/deepRsa/pipeline';
import { buildCampaignGroupReport, GROUP_ORDER } from '@/lib/deepRsa/report';
import type { DeepRsaGroup } from '@/lib/deepRsa/grouping';

const SCROLL_KEY_PREFIX = 'journal-deep-rsa-scroll:';

function parseGroup(search: string): DeepRsaGroup {
  const g = new URLSearchParams(search).get('g');
  return GROUP_ORDER.includes(g as DeepRsaGroup) ? (g as DeepRsaGroup) : 'positive';
}

export default function JournalDeepRsaPage() {
  const nav = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { tradeHistory, ordersMap, filledOrders, positionsMap } = useTradingContext();
  const { rows, complete, loaded, total } = useCampaignList(user?.id, { tradeHistory, ordersMap, filledOrders, positionsMap });
  // 平仓价校正是否拉齐在列表缓存内部、本页看不到：按已拉齐处理，页面上整组标「暂定」
  const report = useMemo(() => (rows.length ? buildCampaignGroupReport(rows, true) : null), [rows]);
  const group = useMemo(() => parseGroup(location.search), [location.search]);
  const deepRun = useDeepRsaRun(user?.id);
  const plannedItems = useMemo(() => (report ? buildRunItems(report, 20261015).items.length : 0), [report]);

  const setGroup = (next: DeepRsaGroup) => {
    const params = new URLSearchParams(location.search);
    if (next === 'positive') params.delete('g'); else params.set('g', next);
    const search = params.toString();
    // 换筛选不新增 history 记录：返回键仍是「回到上一页」
    nav({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: true });
  };

  // 从战役返回：滚回点进去之前的位置（按这条 history 记录记的，只用一次）
  useEffect(() => {
    if (!report) return;
    const storageKey = `${SCROLL_KEY_PREFIX}${location.key}`;
    let saved: number;
    try {
      saved = Number(sessionStorage.getItem(storageKey));
      sessionStorage.removeItem(storageKey);
    } catch {
      return;
    }
    if (!Number.isFinite(saved) || saved <= 0) return;
    const frame = window.requestAnimationFrame(() => window.scrollTo({ top: saved }));
    return () => window.cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report != null, location.key]);

  const openCampaign = (campaignId: string) => {
    try {
      sessionStorage.setItem(`${SCROLL_KEY_PREFIX}${location.key}`, String(window.scrollY));
    } catch {
      // 存不了也照样跳，只是回来时不回到原位置
    }
    // 详情页对 fromCampaignList 的处理是退回上一条 history 记录，正好回到这一页的原样
    nav(`/journal/campaigns/${campaignId}`, { state: { fromCampaignList: true } });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-[980px] items-center gap-3 px-4 sm:px-6">
          <BackButton />
          <div className="min-w-0">
            <h1 className="text-[14px] font-medium">Deep RSA</h1>
            <p className="truncate text-[11px] text-muted-foreground">
              强势上涨前的买方优势特征研究<span className="max-sm:hidden"> · 只读，不改交易逻辑，不自动实盘</span>
            </p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[980px] px-4 py-5 sm:px-6">
        <DeepRsaView
          report={report}
          loading={!complete}
          loaded={loaded}
          total={total}
          group={group}
          onGroupChange={setGroup}
          onOpenCampaign={openCampaign}
          run={deepRun.result}
          runPanel={(
            <DeepRsaRunPanel
              status={deepRun.status}
              progress={deepRun.progress}
              result={deepRun.result}
              error={deepRun.error}
              plannedItems={plannedItems}
              // 战役列表读完才开跑：读到一半的分组会漏事件
              canRun={!!report && complete && !!user}
              onRun={() => { if (report) void deepRun.run(report); }}
              onCancel={deepRun.cancel}
              onDownload={deepRun.download}
            />
          )}
        />
      </main>
    </div>
  );
}
