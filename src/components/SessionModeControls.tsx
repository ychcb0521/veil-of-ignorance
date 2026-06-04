/**
 * 会话模式控制条 —— 从 TimeControl 抽出、移到主 Header（复盘中心左侧）。
 * 包含两组开关：
 *   ① 交易模式：决策记录 ↔ 直接交易（全局会话开关，直接显示）；
 *   ② 时间模式：同步 ↔ 隔离（折叠进一个极小、近乎隐形的符号，点开才切换）。
 * 时间模式的切换守卫（持仓阻断 / 运行中币种确认弹窗）一并迁来，逻辑与原 TimeControl 一致。
 */

import { useState } from 'react';
import { Globe, Split, Lock, Brain, Zap } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { TimeMode, CoinTimelinesMap } from '@/contexts/TradingContext';
import { useTradingContext } from '@/contexts/TradingContext';

interface Props {
  timeMode?: TimeMode;
  onSetTimeMode?: (v: TimeMode) => void;
  onStopAllAndSwitchToSynced?: () => void | Promise<void>;
  totalPositionCount?: number;
  coinTimelines?: CoinTimelinesMap;
  onSymbolChange?: (symbol: string) => void;
}

type GuardedCoin = {
  sym: string;
  status: 'playing' | 'paused';
};

export function SessionModeControls({
  timeMode = 'synced',
  onSetTimeMode,
  onStopAllAndSwitchToSynced,
  totalPositionCount = 0,
  coinTimelines = {},
  onSymbolChange,
}: Props) {
  const ctx = useTradingContext();
  const [timeModeOpen, setTimeModeOpen] = useState(false);
  const [guardDialogOpen, setGuardDialogOpen] = useState(false);
  const [guardedCoins, setGuardedCoins] = useState<GuardedCoin[]>([]);
  const [isStoppingAll, setIsStoppingAll] = useState(false);

  const runningCoinEntries = Object.entries(coinTimelines)
    .filter(([, ct]) => ct.status === 'playing' || ct.status === 'paused')
    .map(([sym, ct]) => ({ sym, status: ct.status } as GuardedCoin));

  const hasBlockingPositions = totalPositionCount > 0;
  const hasRunningCoins = timeMode === 'isolated' && runningCoinEntries.length > 0;
  const showGuardLock = hasBlockingPositions || hasRunningCoins;
  const blockedReason = hasBlockingPositions
    ? `有 ${totalPositionCount} 笔持仓`
    : hasRunningCoins
      ? `有 ${runningCoinEntries.length} 个币种正在运行`
      : null;

  // ===== 时间模式：同步 / 隔离（带切换守卫，逻辑与原 TimeControl 一致） =====
  const handleModeSwitchClick = (
    e: React.MouseEvent<HTMLButtonElement>,
    nextMode: TimeMode,
  ) => {
    e.preventDefault();
    e.stopPropagation();

    if (!onSetTimeMode || nextMode === timeMode) return;

    if (hasBlockingPositions) {
      toast.error('无法切换模式', {
        description: `有 ${totalPositionCount} 笔持仓，需全部平仓后才能切换模式。`,
        duration: 5000,
      });
      return; // Do NOT touch timeMode state
    }

    if (nextMode === 'synced' && timeMode === 'isolated' && runningCoinEntries.length > 0) {
      // Snapshot coins at click time, open modal, do NOT change timeMode
      setGuardedCoins([...runningCoinEntries]);
      setGuardDialogOpen(true);
      return;
    }

    // Only if all checks pass, actually change mode
    onSetTimeMode(nextMode);
  };

  const handleDialogOpenChange = (open: boolean) => {
    if (isStoppingAll) return;
    setGuardDialogOpen(open);
  };

  const handleJumpToCoin = (e: React.MouseEvent<HTMLButtonElement>, symbol: string) => {
    e.preventDefault();
    e.stopPropagation();
    onSymbolChange?.(symbol);
    setGuardDialogOpen(false);
  };

  const handleStopAllAndSwitch = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onStopAllAndSwitchToSynced) return;

    try {
      setIsStoppingAll(true);
      await onStopAllAndSwitchToSynced();
      setGuardDialogOpen(false);
    } finally {
      setIsStoppingAll(false);
    }
  };

  // ===== 交易模式：决策记录 / 直接交易 =====
  const handleTradingModeClick = (next: 'decision' | 'direct') => {
    if (next === ctx.tradingMode) return;
    ctx.setTradingMode(next);
    toast.message(
      next === 'direct' ? '已切换到直接交易模式' : '已切换到决策记录模式',
      {
        description: next === 'direct'
          ? '下单不再弹出快照、平仓无需评价。错题集 / 元监控 不会收录这些单。'
          : '完整的开仓快照 + 平仓评价 + 错题集 + 元监控 全部生效。',
      },
    );
  };

  const timeModeBtnCls = (active: boolean, disabled: boolean) =>
    `flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all duration-100 ease-out active:scale-[0.97] ${
      active
        ? 'bg-primary/20 text-primary'
        : disabled
          ? 'bg-secondary text-muted-foreground opacity-50 cursor-not-allowed hover:bg-secondary'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent'
    }`;

  return (
    <div className="flex items-center gap-1">
      {/* 交易模式：直接显示 */}
      <button
        onClick={() => handleTradingModeClick('decision')}
        title="决策记录：完整快照 / 评价 / 错题集 / 元监控"
        className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all duration-100 ease-out active:scale-[0.97] ${
          ctx.tradingMode === 'decision'
            ? 'bg-primary/20 text-primary'
            : 'text-muted-foreground hover:text-foreground hover:bg-accent'
        }`}
      >
        <Brain className="w-3 h-3" /> 决策记录
      </button>
      <button
        onClick={() => handleTradingModeClick('direct')}
        title="直接交易：跳过快照与评价，仍可在交易战役中归类，但不进错题集/元监控"
        className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all duration-100 ease-out active:scale-[0.97] ${
          ctx.tradingMode === 'direct'
            ? 'bg-[#F0B90B]/20 text-[#F0B90B]'
            : 'text-muted-foreground hover:text-foreground hover:bg-accent'
        }`}
      >
        <Zap className="w-3 h-3" /> 直接交易
      </button>

      {/* 时间模式：折叠进一个极小、近乎隐形的符号；点开才露出 同步 / 隔离 */}
      {onSetTimeMode && (
        <div className="flex items-center gap-1 border-l border-border/60 pl-2 ml-1">
          <button
            onClick={() => setTimeModeOpen(o => !o)}
            title={`时间模式：当前${timeMode === 'isolated' ? '隔离' : '同步'}${showGuardLock ? `（${blockedReason}）` : ''} · 点击展开切换`}
            className={`flex items-center gap-0.5 transition-colors ${
              timeModeOpen ? 'text-primary' : 'text-muted-foreground/30 hover:text-muted-foreground'
            }`}
          >
            {showGuardLock && <Lock className="w-3 h-3 shrink-0" />}
            {timeMode === 'isolated' ? <Split className="w-3 h-3" /> : <Globe className="w-3 h-3" />}
          </button>
          {timeModeOpen && (
            <>
              <button
                onClick={(e) => handleModeSwitchClick(e, 'synced')}
                title={blockedReason ? `当前不可切换：${blockedReason}` : '切换到同步模式'}
                aria-disabled={hasBlockingPositions || hasRunningCoins}
                className={timeModeBtnCls(timeMode === 'synced', showGuardLock && timeMode !== 'synced')}
              >
                <Globe className="w-3 h-3" /> 同步
              </button>
              <button
                onClick={(e) => handleModeSwitchClick(e, 'isolated')}
                title={hasBlockingPositions ? `当前不可切换：${blockedReason}` : '切换到隔离模式'}
                aria-disabled={hasBlockingPositions}
                className={timeModeBtnCls(timeMode === 'isolated', hasBlockingPositions && timeMode !== 'isolated')}
              >
                <Split className="w-3 h-3" /> 隔离
              </button>
            </>
          )}
        </div>
      )}

      {/* 切换守卫弹窗：隔离→同步 但仍有币种在运行时 */}
      {guardDialogOpen && (
        <Dialog open={guardDialogOpen} onOpenChange={handleDialogOpenChange}>
          <DialogContent
            className="sm:max-w-md"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <DialogHeader>
              <DialogTitle>无法切换模式</DialogTitle>
              <DialogDescription>
                当前仍有币种处于独立运行状态。请先查看或停止这些币种，再切换到同步模式。
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <div className="rounded-lg border border-border bg-card/60 p-3">
                <div className="mb-2 text-xs font-medium text-muted-foreground">运行中的币种</div>
                <div className="flex flex-col gap-2">
                  {guardedCoins.map(({ sym, status: coinStatus }) => (
                    <button
                      key={sym}
                      onClick={(e) => handleJumpToCoin(e, sym)}
                      className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-left transition-colors duration-100 ease-out hover:bg-accent active:scale-[0.98]"
                    >
                      <span className="text-sm font-medium text-foreground">{sym}</span>
                      <span className={`text-xs ${coinStatus === 'playing' ? 'text-primary' : 'text-muted-foreground'}`}>
                        {coinStatus === 'playing' ? '运行中' : '已暂停'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <DialogFooter>
              <button
                type="button"
                onClick={() => setGuardDialogOpen(false)}
                className="inline-flex items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-all duration-100 ease-out hover:bg-accent active:scale-[0.97]"
              >
                取消
              </button>
              <button
                type="button"
                onClick={(e) => void handleStopAllAndSwitch(e)}
                disabled={isStoppingAll}
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-all duration-100 ease-out hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isStoppingAll ? '处理中…' : '一键停止所有并切换'}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
