/**
 * 会话模式控制条 —— 从 TimeControl 抽出、移到主 Header（复盘中心左侧）。
 * 「加仓」按钮直接放在顶栏；其余四组开关收进一个「模式」菜单（触发按钮写出当前的交易模式与持仓限制模式）：
 *   ① 播放：正序 ↔ 倒叙播放；
 *   ② 交易模式：决策记录 ↔ 直接交易（全局会话开关）；
 *   ③ 持仓限制模式：无限制 ↔ 币安标准（默认无限制，见 lib/positionLimitMode）；
 *   ④ 时间模式：同步 ↔ 隔离。
 * 时间模式的切换守卫（持仓阻断 / 运行中币种确认弹窗）一并迁来，逻辑与原 TimeControl 一致。
 */

import { useState } from 'react';
import { Globe, Split, Lock, Brain, Zap, Rewind, Minus, Plus, Play, SlidersHorizontal, ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { AddPositionCalculator } from '@/components/AddPositionCalculator';
import { ReductionCalculator } from '@/components/ReductionCalculator';
import { readHeldPosition } from '@/lib/addSizing';
import { getCoinMarginedContractSizeUsd } from '@/lib/coinMargined';
import { toast } from '@/lib/notificationCenter';
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
import {
  POSITION_LIMIT_MODE_HINT,
  POSITION_LIMIT_MODE_LABEL,
  POSITION_LIMIT_MODE_SWITCH_LINE,
  normalizePositionLimitMode,
  type PositionLimitMode,
} from '@/lib/positionLimitMode';
import { binanceSwitchRiskText, ordersRefusedUnderBinance } from '@/lib/positionLimitModeSwitch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface Props {
  timeMode?: TimeMode;
  onSetTimeMode?: (v: TimeMode) => void;
  onStopAllAndSwitchToSynced?: () => void | Promise<void>;
  totalPositionCount?: number;
  coinTimelines?: CoinTimelinesMap;
  onSymbolChange?: (symbol: string) => void;
  /** 当前盘面标的——加仓计算器据此读持仓与结算方式 */
  activeSymbol?: string;
  /** 实时现价（Index 的 displayCurrentPrice）；没有 activeFillBasePrice 时供加仓计算器预填 S₂ */
  activePrice?: number;
  /**
   * 引擎市价成交的基准价（Index 的 latestChartPriceRef.current || priceMap[symbol] || currentPrice，
   * 与下单按钮传给 placeOrder 的 latestPrice 同一个式子）。加仓计算器的 S₂ 从它种下并跟着它走——
   * displayCurrentPrice 是平滑后的显示值，不是引擎撮合用的那个价。
   */
  activeFillBasePrice?: number;
  /** 下单面板的价格精度（Index 的 chartPricePrecision）：加仓计算器的限价 / 条件单档按它向有利侧取整挂单价 / 触发价。 */
  activePricePrecision?: number;
  /** 下单面板的数量精度（Index 的 quantityPrecision）：U 本位「按上限下单」按钮上的币数按它向下取整，与面板预填同一个数。 */
  activeQuantityPrecision?: number;
}

/** 「模式」菜单里每一行左侧的名字：淡、小、左对齐。 */
const MENU_LABEL = 'text-[10px] text-muted-foreground/70';

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
  activeSymbol,
  activePrice,
  activeFillBasePrice,
  activePricePrecision,
  activeQuantityPrecision,
}: Props) {
  const ctx = useTradingContext();
  const [addSizingOpen, setAddSizingOpen] = useState(false);
  const [reductionOpen, setReductionOpen] = useState(false);
  const [modesOpen, setModesOpen] = useState(false);
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

  // ===== 倒叙播放：翻转时间机器方向（默认正序） =====
  const reverseActive = ctx.timeDirection === -1;
  const handleDirectionToggle = () => {
    const next = reverseActive ? 1 : -1;
    ctx.setTimeDirection(next);
    toast.message(next === -1 ? '已开启倒叙播放' : '已恢复正序播放', {
      description: next === -1
        ? '镜像视图：盘面呈现未来一侧，更早的 K 线逐帧从右侧出现，横轴时间从左到右递减；模拟时间及其绑定的一切随之倒走（客观操作时间除外）。'
        : '时间恢复正常方向推进，盘面回到常规视图。',
    });
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

  // ===== 持仓限制模式：无限制 / 币安标准 =====
  // 旧的测试替身里可能没有这两个字段：读不到按默认的无限制显示，点了也不报错。
  const positionLimitMode = normalizePositionLimitMode(ctx.positionLimitMode);
  const handlePositionLimitModeClick = (next: PositionLimitMode) => {
    if (next === positionLimitMode || !ctx.setPositionLimitMode) return;
    /**
     * 切到币安标准：无限制下挂出的委托到触发 / 成交时按币安判，按此刻的持仓与价格就过不去的先数出来说——
     * 尤其是按成数挂的止盈止损（触发时超单笔上限被撤，仓位就没了保护）。有这样的单时提示升为警告。
     */
    const risk = next === 'binance'
      ? binanceSwitchRiskText(ordersRefusedUnderBinance(ctx.ordersMap, ctx.positionsMap, ctx.priceMap))
      : null;
    ctx.setPositionLimitMode(next);
    const title = next === 'unlimited' ? '已切换到无限制模式' : '已切换到币安标准模式';
    const description = `${POSITION_LIMIT_MODE_SWITCH_LINE[next]}。`
      + '现有仓位保持原来的维持保证金口径；新模式作用于之后的下单、挂单触发 / 成交与杠杆调整。'
      + (risk ? ` ${risk}` : '');
    if (risk) toast.warning(title, { description });
    else toast.message(title, { description });
  };
  // 与决策记录 / 直接交易同一套尺寸与选中样式；选中色另取一种（像倒叙播放的紫色一样），免得和紧挨着的「直接交易」金色连成一片
  const limitSegmentCls = (active: boolean) =>
    `flex items-center whitespace-nowrap px-2 py-1 rounded text-[10px] font-medium transition-all duration-100 ease-out active:scale-[0.97] ${
      active
        ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400'
        : 'text-muted-foreground hover:text-foreground hover:bg-accent'
    }`;

  const segmentCls = (active: boolean, activeCls: string) =>
    `flex items-center gap-1 whitespace-nowrap px-2 py-1 rounded text-[10px] font-medium transition-all duration-100 ease-out active:scale-[0.97] ${
      active ? 'bg-foreground/[0.07] text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent'
    }`;

  const timeModeBtnCls = (active: boolean, disabled: boolean) =>
    `flex items-center gap-1 whitespace-nowrap px-2 py-1 rounded text-[10px] font-medium transition-all duration-100 ease-out active:scale-[0.97] ${
      active
        ? 'bg-foreground/[0.07] text-foreground'
        : disabled
          ? 'bg-secondary text-muted-foreground opacity-50 cursor-not-allowed hover:bg-secondary'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent'
    }`;

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => setReductionOpen(true)}
        data-testid="reduction-calculator-open"
        title="减仓计算器 · X / T 双向计算"
        className="flex items-center gap-1 whitespace-nowrap rounded px-2 py-1 text-[10px] font-medium text-muted-foreground transition-all duration-100 ease-out hover:bg-accent hover:text-foreground active:scale-[0.97]"
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-teal-600/[0.08] text-teal-700 dark:bg-teal-400/10 dark:text-teal-400"><Minus className="h-3.5 w-3.5" strokeWidth={2.5} /></span>
        减仓
      </button>
      {reductionOpen && <ReductionCalculator open onClose={() => setReductionOpen(false)} seed={{
        pricePrecision: activePricePrecision,
        T: activeFillBasePrice || activePrice,
        S: activeSymbol ? readHeldPosition(activeSymbol, ctx.positionsMap[activeSymbol], 'LONG', getCoinMarginedContractSizeUsd(activeSymbol))?.avgEntry : undefined,
        K: activeSymbol ? (ctx.ordersMap[activeSymbol] ?? [])
          .filter(order => order.side === 'SHORT' && !order.reduceOnly && ['NEW', 'PENDING', 'ACTIVE'].includes(order.status))
          .sort((a, b) => b.createdAt - a.createdAt)
          .map(order => order.stopPrice > 0 ? order.stopPrice : order.price)
          .find(price => price > 0) : undefined,
      }} />}
      {/* 加仓计算器：浮盈垫锁死的加仓量与对冲量（使用说明 3.4）。
          只在打开时挂载弹窗，按钮本身不读持仓，不给顶栏增加任何渲染负担。 */}
      <button
        type="button"
        onClick={() => setAddSizingOpen(true)}
        data-testid="add-sizing-open"
        disabled={!activeSymbol}
        title={activeSymbol
          ? `加仓计算器：按浮盈垫锁死算 ${activeSymbol} 的加仓上限与对冲量`
          : '加仓计算器：先选一个标的'}
        className="flex items-center gap-1 whitespace-nowrap rounded px-2 py-1 text-[10px] font-medium text-muted-foreground transition-all duration-100 ease-out hover:bg-accent hover:text-foreground active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-orange-500/[0.08] text-orange-600 dark:bg-orange-400/10 dark:text-orange-400"><Plus className="h-3.5 w-3.5" strokeWidth={2.5} /></span>
        加仓
      </button>
      {addSizingOpen && activeSymbol && (
        <AddPositionCalculator
          open
          symbol={activeSymbol}
          currentPrice={activePrice}
          fillBasePrice={activeFillBasePrice}
          pricePrecision={activePricePrecision}
          quantityPrecision={activeQuantityPrecision}
          onClose={() => setAddSizingOpen(false)}
        />
      )}

      {/* 【用户要求】顶栏合成一行：倒叙播放、交易模式、持仓限制模式、时间模式收进一个「模式」菜单，加仓留在外面。
          触发按钮直接写出当前的交易模式与持仓限制模式；倒叙、隔离不是默认，开着时多一枚小标签。
          不用 title：浏览器的悬停提示会盖在右上角的模拟时钟上，说明写在 aria-label 里。 */}
      <Popover open={modesOpen} onOpenChange={setModesOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid="session-modes-trigger"
            aria-label={`模式：${ctx.tradingMode === 'direct' ? '直接交易' : '决策记录'} · ${POSITION_LIMIT_MODE_LABEL[positionLimitMode]}${reverseActive ? ' · 倒叙播放' : ''}${timeMode === 'isolated' ? ' · 隔离' : ''}；点击展开切换`}
            className={`flex items-center gap-1 whitespace-nowrap rounded px-2 py-1 text-[10px] font-medium transition-all duration-100 ease-out hover:bg-foreground/[0.05] active:scale-[0.97] ${modesOpen ? 'bg-foreground/[0.06]' : ''}`}
          >
            <SlidersHorizontal className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">模式</span>
            <ChevronDown className={`h-3 w-3 text-muted-foreground/60 transition-transform ${modesOpen ? 'rotate-180' : ''}`} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={6}
          collisionPadding={8}
          data-testid="session-modes-menu"
          className="w-auto p-2"
        >
          <div className="grid grid-cols-[auto_auto] items-center gap-x-3 gap-y-1.5">
            <span className={MENU_LABEL}>播放</span>
            {/* 倒叙播放：默认正序，选中后时间倒序推进 */}
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => { if (reverseActive) handleDirectionToggle(); }}
                aria-pressed={!reverseActive}
                className={segmentCls(!reverseActive, 'bg-primary/20 text-primary')}
              >
                <Play className="w-3 h-3" /> 正序
              </button>
              <button
                type="button"
                onClick={() => { if (!reverseActive) handleDirectionToggle(); }}
                data-testid="time-direction-toggle"
                aria-pressed={reverseActive}
                aria-label={reverseActive
                  ? '倒叙播放中：时间倒序推进，K 线逐根回退（客观操作时间不受影响）'
                  : '倒叙播放：让时间机器倒着走，K 线逐根回退；默认正序'}
                className={segmentCls(reverseActive, 'bg-[#B080FF]/20 text-[#B080FF]')}
              >
                <Rewind className="w-3 h-3" /> 倒叙播放
              </button>
            </div>

            <span className={MENU_LABEL}>交易</span>
            {/* 交易模式 */}
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => handleTradingModeClick('decision')}
                aria-label="决策记录：完整快照 / 评价 / 错题集 / 元监控"
                aria-pressed={ctx.tradingMode === 'decision'}
                className={segmentCls(ctx.tradingMode === 'decision', 'bg-primary/20 text-primary')}
              >
                <Brain className="w-3 h-3" /> 决策记录
              </button>
              <button
                type="button"
                onClick={() => handleTradingModeClick('direct')}
                // 两种模式的说明在切换时记入「历史消息」（见 handleTradingModeClick）。
                aria-label="直接交易：跳过快照与评价，仍可在交易战役中归类，但不进错题集/元监控"
                aria-pressed={ctx.tradingMode === 'direct'}
                className={segmentCls(ctx.tradingMode === 'direct', 'bg-[#F0B90B]/20 text-[#F0B90B]')}
              >
                <Zap className="w-3 h-3" /> 直接交易
              </button>
            </div>

            <span className={MENU_LABEL}>持仓</span>
            {/* 持仓限制模式：紧跟在「直接交易」那一行下面。
                说明写在 aria-label 里，悬停 / 聚焦时在按钮**正下方**弹一个定位好的说明（Radix Tooltip，贴着按钮、不跟鼠标），切换时记入「历史消息」。
                说明不可点，关掉「悬停在说明上保持打开」：否则从一段移到紧挨着的另一段时，鼠标落在前一段说明的保持区里，另一段的说明打不开 */}
            <TooltipProvider delayDuration={300} disableHoverableContent>
              <div
                role="group"
                aria-label="持仓限制模式"
                data-testid="position-limit-mode"
                className="flex items-center gap-0.5"
              >
                {(['unlimited', 'binance'] as const).map(mode => (
                  <Tooltip key={mode}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => handlePositionLimitModeClick(mode)}
                        data-testid={`position-limit-mode-${mode}`}
                        aria-pressed={positionLimitMode === mode}
                        aria-label={POSITION_LIMIT_MODE_HINT[mode]}
                        className={limitSegmentCls(positionLimitMode === mode)}
                      >
                        {POSITION_LIMIT_MODE_LABEL[mode]}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="bottom"
                      align="end"
                      collisionPadding={8}
                      data-testid={`position-limit-mode-tip-${mode}`}
                      className="max-w-[260px] text-[11px] leading-5"
                    >
                      {POSITION_LIMIT_MODE_HINT[mode]}
                      {mode === 'unlimited' ? '（默认）' : ''}
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </TooltipProvider>

            {/* 时间模式：同步 / 隔离；有持仓或有币种在跑时带锁，说明写在按钮的 title 里（菜单里不挡时钟） */}
            {onSetTimeMode && (
              <>
                <span className={`${MENU_LABEL} flex items-center gap-0.5`}>
                  时间
                  {showGuardLock && <Lock data-testid="time-mode-lock" aria-label={blockedReason ?? undefined} className="h-2.5 w-2.5" />}
                </span>
                <div data-testid="time-mode" className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={(e) => handleModeSwitchClick(e, 'synced')}
                    title={blockedReason ? `当前不可切换：${blockedReason}` : '切换到同步模式'}
                    aria-disabled={hasBlockingPositions || hasRunningCoins}
                    aria-pressed={timeMode === 'synced'}
                    className={timeModeBtnCls(timeMode === 'synced', showGuardLock && timeMode !== 'synced')}
                  >
                    <Globe className="w-3 h-3" /> 同步
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleModeSwitchClick(e, 'isolated')}
                    title={hasBlockingPositions ? `当前不可切换：${blockedReason}` : '切换到隔离模式'}
                    aria-disabled={hasBlockingPositions}
                    aria-pressed={timeMode === 'isolated'}
                    className={timeModeBtnCls(timeMode === 'isolated', hasBlockingPositions && timeMode !== 'isolated')}
                  >
                    <Split className="w-3 h-3" /> 隔离
                  </button>
                </div>
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* 切换守卫弹窗：隔离→同步 但仍有币种在运行时 */}
      {guardDialogOpen && (
        <Dialog open={guardDialogOpen} onOpenChange={handleDialogOpenChange}>
          <DialogContent
            className="flex max-h-[calc(100vh-32px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <DialogHeader className="shrink-0 px-6 pt-6 pb-4">
              <DialogTitle>无法切换模式</DialogTitle>
              <DialogDescription>
                当前仍有币种处于独立运行状态。请先查看或停止这些币种，再切换到同步模式。
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">
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

            <DialogFooter className="shrink-0 border-t border-border/60 px-6 py-4">
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
