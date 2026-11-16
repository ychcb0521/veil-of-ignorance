import { useCallback, useEffect, useRef, useState } from 'react';
import { MANAGED_CLOSE_GRACE, MANAGED_MINUTE, binanceManualId, type BinanceManualAnchor, type BinanceManualState } from '@/lib/fish/binanceManualMonitor';
import { binanceManualAdvance, binanceManualSample, binanceManualSeed } from '@/lib/fish/binanceManualStrategy';
import { instantMonitorTemplateIssue, type InstantMonitorSettings } from '@/lib/fish/instantMonitorSettings';
import { isLegacyQualityPlan } from '@/lib/fish/qualityLegacyEngine';
import { readPageInstantMonitor } from './useFish';
import type { useUsdtFollow } from './useUsdtFollow';
import type { useUsdtLiveTrading } from './useUsdtLiveTrading';
import { USDT_EXECUTION_SAFETY } from '@/lib/fish/usdtLiveEntry';

export function useBinanceManualMonitor(follow: ReturnType<typeof useUsdtFollow>, live: ReturnType<typeof useUsdtLiveTrading>, settings?: InstantMonitorSettings) {
  const { owner, connected, manualMonitor, paused, executionSafety, readManualMonitor, adoptManualMonitor, advanceManualMonitor } = follow;
  const input = useRef({ live, executionSafety });
  input.current = { live, executionSafety };
  const wake = useRef<() => void>();
  const [view, setView] = useState<{ owner: string; positions: BinanceManualState['positions']; issue?: string }>();
  const adopt = useCallback(async (anchor: BinanceManualAnchor, monitor: InstantMonitorSettings, revision: number) => {
    if (!connected || paused || executionSafety !== USDT_EXECUTION_SAFETY)
      throw Error('实盘跟随未开启或执行端待更新');
    const issue = instantMonitorTemplateIssue({ id: monitor.templateId, name: monitor.name, plan: monitor.plan });
    if (issue || isLegacyQualityPlan(monitor.plan)) throw Error(issue || '该历史模板暂不支持实盘托管');
    await adoptManualMonitor(anchor, monitor, revision, AbortSignal.timeout(65_000));
    wake.current?.();
  }, [connected, paused, executionSafety, adoptManualMonitor]);
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
            if (next?.decision?.kind === 'add' && input.current.executionSafety !== USDT_EXECUTION_SAFETY) continue;
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
    wake.current = refresh;
    const timer = window.setInterval(refresh, 6000);
    document.addEventListener('visibilitychange', refresh);
    refresh();
    return () => {
      lifetime.abort();
      wake.current = undefined;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [owner, connected, manualMonitor, readManualMonitor, advanceManualMonitor]);
  return connected && manualMonitor === 1 ? {
    positions: view?.owner === owner ? view?.positions ?? [] : [],
    issue: view?.owner === owner ? view?.issue : undefined,
    template: settings, adopt,
  } : undefined;
}
