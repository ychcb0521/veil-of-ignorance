import { useEffect, useRef, useState } from 'react';
import { MANAGED_CLOSE_GRACE, MANAGED_MINUTE, binanceManualId, type BinanceManualAnchor, type BinanceManualState } from '@/lib/fish/binanceManualMonitor';
import { binanceManualAdvance, binanceManualSample, binanceManualSeed } from '@/lib/fish/binanceManualStrategy';
import { instantMonitorTemplateIssue, type InstantMonitorSettings } from '@/lib/fish/instantMonitorSettings';
import { isLegacyQualityPlan } from '@/lib/fish/qualityLegacyEngine';
import { readPageInstantMonitor } from './useFish';
import type { useUsdtFollow } from './useUsdtFollow';
import type { useUsdtLiveTrading } from './useUsdtLiveTrading';

export function useBinanceManualMonitor(follow: ReturnType<typeof useUsdtFollow>, live: ReturnType<typeof useUsdtLiveTrading>, settings?: InstantMonitorSettings) {
  const { owner, connected, manualMonitor, paused, readManualMonitor, adoptManualMonitor, advanceManualMonitor } = follow;
  const input = useRef({ settings, live, paused });
  input.current = { settings, live, paused };
  const [view, setView] = useState<{ owner: string; positions: BinanceManualState['positions']; issue?: string }>();
  useEffect(() => {
    if (!owner || !connected || manualMonitor !== 1) { setView(undefined); return; }
    const lifetime = new AbortController();
    const { signal } = lifetime;
    const evaluated = new Map<string, number>();
    let busy = false;
    let hasManaged = false;
    const sync = async () => {
      if (busy || signal.aborted) return;
      if (!hasManaged && !input.current.live.snapshot?.positions.length) return;
      busy = true;
      try {
        const state = await readManualMonitor(signal);
        if (signal.aborted) return;
        hasManaged = !!state.positions.length;
        const issues: string[] = [];
        const current = input.current;
        const existing = new Set(state.positions.map(({ position }) => binanceManualId(position.anchor)));
        const activePositions = current.live.snapshot?.positions ?? [];
        const first = current.live.openCampaigns?.find(campaign => {
          const fill = campaign.fills[0];
          if (!fill || campaign.followId || campaign.direction !== 'long' || campaign.asset !== 'USDT' ||
            !campaign.fills.every(trade => trade.action === 'open')) return false;
          const anchor: BinanceManualAnchor = { symbol: campaign.symbol,
            positionSide: campaign.positionSide === 'LONG' ? 'LONG' : 'BOTH', openedAt: campaign.openedAt,
            openingTradeId: fill.id, openingOrderId: fill.orderId };
          return !existing.has(binanceManualId(anchor)) &&
            activePositions.some(row => row.symbol === campaign.symbol && row.positionSide === campaign.positionSide && row.direction === 'long');
        });
        if (first && !current.paused) {
          try {
            const monitor = current.settings;
            if (!monitor) throw Error('等待选择「即时交易」买后模板');
            const issue = instantMonitorTemplateIssue({ id: monitor.templateId, name: monitor.name, plan: monitor.plan });
            if (issue || isLegacyQualityPlan(monitor.plan)) throw Error(issue || '这份历史模板暂不支持实盘手动仓位接入');
            const opening = first.fills[0];
            await adoptManualMonitor({ symbol: first.symbol, positionSide: first.positionSide === 'LONG' ? 'LONG' : 'BOTH',
              openedAt: first.openedAt, openingTradeId: opening.id, openingOrderId: opening.orderId }, monitor, signal);
          } catch (error) {
            issues.push(first.symbol + ' · ' + (error instanceof Error ? error.message : '手动仓位等待接入'));
          }
        }
        for (const { position, status } of state.positions) {
          if (signal.aborted) return;
          if (position.pending || status.state !== 'tracking') continue;
          const id = binanceManualId(position.anchor);
          const sample = binanceManualSample(position);
          const base = binanceManualSeed(position, sample);
          const end = Math.floor((state.observedAt - MANAGED_CLOSE_GRACE) / MANAGED_MINUTE) * MANAGED_MINUTE;
          if (end <= base.endTime! || (evaluated.get(id) ?? 0) >= end) continue;
          try {
            const result = await readPageInstantMonitor(sample, position.monitor, position.anchor.openedAt, end, signal, base, state.observedAt);
            if (signal.aborted) return;
            const next = binanceManualAdvance(position, base, result);
            if (next) await advanceManualMonitor(id, position.revision, next.checkpoint, next.decision, signal);
            if (result.status !== 'waiting' && (result.endTime ?? 0) >= end - MANAGED_MINUTE) evaluated.set(id, end);
          } catch (error) {
            issues.push(position.anchor.symbol + ' · ' + (error instanceof Error ? error.message : '持仓策略等待数据'));
          }
        }
        if (!signal.aborted) setView({ owner, positions: state.positions, issue: issues.join('；') || undefined });
      } catch (error) {
        if (!signal.aborted) setView(previous => ({ owner, positions: previous?.owner === owner ? previous.positions : [],
          issue: error instanceof Error ? error.message : '手动仓位等待同步' }));
      } finally {
        busy = false;
      }
    };
    const refresh = () => void sync();
    const timer = window.setInterval(refresh, 6000);
    document.addEventListener('visibilitychange', refresh);
    refresh();
    return () => {
      lifetime.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [owner, connected, manualMonitor, readManualMonitor, adoptManualMonitor, advanceManualMonitor]);
  return connected && view?.owner === owner ? view : undefined;
}
