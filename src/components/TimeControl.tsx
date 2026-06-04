import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Play, Pause, Square, Clock, Globe, Split, Lock, BookmarkX, Brain, Zap,
  Database, ChevronDown, Upload, Plus, Trash2, X, ArrowRightCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatUTC8 } from '@/lib/timeFormat';
import {
  type TradeSignal,
  loadSignals, saveSignals, parseSignalText, mergeSignals, sortSignalsAlpha,
} from '@/lib/signalLibrary';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { TimeMachineStatus } from '@/hooks/useTimeSimulator';
import type { TimeMode, CoinTimelinesMap } from '@/contexts/TradingContext';
import { useTradingContext } from '@/contexts/TradingContext';
import { PreTradeSnapshotDialog } from '@/components/journal/PreTradeSnapshotDialog';

interface Props {
  status: TimeMachineStatus;
  currentSimulatedTime: number;
  speed: number;
  onStart: (timestamp: number) => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onSetSpeed: (speed: number) => void;
  onStopAllAndSwitchToSynced?: () => void | Promise<void>;
  clockRef?: React.RefObject<HTMLSpanElement>;
  timeMode?: TimeMode;
  onSetTimeMode?: (v: TimeMode) => void;
  totalPositionCount?: number;
  originTime?: number | null;
  coinTimelines?: CoinTimelinesMap;
  onSymbolChange?: (symbol: string) => void;
  activeSymbol?: string;
  onJumpToSignal?: (symbol: string, timeMs: number) => void;
}

const SPEED_OPTIONS = [1, 2, 5, 10, 30, 60, 180, 300, 900];

type GuardedCoin = {
  sym: string;
  status: 'playing' | 'paused';
};

export function TimeControl({
  status, currentSimulatedTime, speed,
  onStart, onPause, onResume, onStop, onSetSpeed, onStopAllAndSwitchToSynced, clockRef,
  timeMode = 'synced', onSetTimeMode, totalPositionCount = 0,
  originTime, coinTimelines = {}, onSymbolChange, activeSymbol, onJumpToSignal,
}: Props) {
  const ctx = useTradingContext();
  const [noEntryOpen, setNoEntryOpen] = useState(false);
  const [noEntrySimTime, setNoEntrySimTime] = useState<number>(Date.now());
  const noEntrySymbol = activeSymbol || 'BTCUSDT';

  const openNoEntry = () => {
    setNoEntrySimTime(ctx.getEffectiveTime(noEntrySymbol));
    if (status === 'playing') onPause();
    setNoEntryOpen(true);
  };
  const [dateInput, setDateInput] = useState('2024-01-15 16:00:00');
  const [guardDialogOpen, setGuardDialogOpen] = useState(false);
  const [guardedCoins, setGuardedCoins] = useState<GuardedCoin[]>([]);
  const [isStoppingAll, setIsStoppingAll] = useState(false);

  // ===== 信号库（Time Machine 旁的折叠接口）=====
  const fileRef = useRef<HTMLInputElement>(null);
  const [signalLibOpen, setSignalLibOpen] = useState(false);
  const [signals, setSignals] = useState<TradeSignal[]>(() => loadSignals());
  const [importText, setImportText] = useState('');
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => { saveSignals(signals); }, [signals]);

  const sortedFiltered = useMemo(() => {
    const q = query.trim().toUpperCase();
    const base = sortSignalsAlpha(signals);
    return q ? base.filter(s => s.symbol.includes(q)) : base;
  }, [signals, query]);

  const doImport = (text: string) => {
    const { signals: parsed, errors } = parseSignalText(text);
    setImportErrors(errors);
    if (parsed.length === 0) {
      toast.error('没有可导入的信号', { description: errors[0] ?? '请按「标的, 时间, 兜底区」每行一条填写' });
      return;
    }
    const merged = mergeSignals(signals, parsed);
    const added = merged.length - signals.length;
    setSignals(merged);
    toast.success(`已导入 ${added} 条信号`, added < parsed.length ? { description: `${parsed.length - added} 条重复已跳过` } : undefined);
  };

  const handleImport = () => { doImport(importText); setImportText(''); };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => doImport(String(reader.result ?? ''));
    reader.onerror = () => toast.error('文件读取失败');
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleDeleteSignal = (id: string) => setSignals(prev => prev.filter(s => s.id !== id));
  const handleClearSignals = () => { setSignals([]); setImportErrors([]); toast.message('信号库已清空'); };

  const handleJumpSignal = (sig: TradeSignal) => {
    if (!onJumpToSignal) {
      onSymbolChange?.(sig.symbol);
      return;
    }
    onJumpToSignal(sig.symbol, sig.timeMs);
    setSignalLibOpen(false);
  };

  const runningCoinEntries = Object.entries(coinTimelines)
    .filter(([, ct]) => ct.status === 'playing' || ct.status === 'paused')
    .map(([sym, ct]) => ({ sym, status: ct.status } as GuardedCoin));

  const hasBlockingPositions = totalPositionCount > 0;
  const hasRunningCoins = timeMode === 'isolated' && runningCoinEntries.length > 0;
  const showGuardLock = hasBlockingPositions || hasRunningCoins;

  const handleStart = () => {
    const ts = new Date(dateInput.replace(' ', 'T') + 'Z').getTime() - 8 * 3600_000;
    if (isNaN(ts)) return;
    onStart(ts);
  };

  // Pure event-driven guard — no useEffect, no side effects
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

  // Derived values for mode selector (no inner component to avoid remount flicker)
  const blockedReason = hasBlockingPositions
    ? `有 ${totalPositionCount} 笔持仓`
    : hasRunningCoins
      ? `有 ${runningCoinEntries.length} 个币种正在运行`
      : null;

  const modeSelectorButtons = onSetTimeMode ? (
    <div className="flex items-center gap-1 border-l border-border pl-3 ml-1">
      {showGuardLock && <Lock className="w-3 h-3 text-muted-foreground shrink-0" />}
      <button
        onClick={(e) => handleModeSwitchClick(e, 'synced')}
        title={blockedReason ? `当前不可切换：${blockedReason}` : '切换到同步模式'}
        aria-disabled={hasBlockingPositions || hasRunningCoins}
        className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all duration-100 ease-out active:scale-[0.97] ${
          timeMode === 'synced'
            ? 'bg-primary/20 text-primary'
            : showGuardLock
              ? 'bg-secondary text-muted-foreground opacity-50 cursor-not-allowed hover:bg-secondary'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent'
        }`}
      >
        <Globe className="w-3 h-3" /> 同步
      </button>
      <button
        onClick={(e) => handleModeSwitchClick(e, 'isolated')}
        title={hasBlockingPositions ? `当前不可切换：${blockedReason}` : '切换到隔离模式'}
        aria-disabled={hasBlockingPositions}
        className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all duration-100 ease-out active:scale-[0.97] ${
          timeMode === 'isolated'
            ? 'bg-primary/20 text-primary'
            : hasBlockingPositions
              ? 'bg-secondary text-muted-foreground opacity-50 cursor-not-allowed hover:bg-secondary'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent'
        }`}
      >
        <Split className="w-3 h-3" /> 隔离
      </button>
    </div>
  ) : null;

  /**
   * Switch between 决策记录 ↔ 直接交易 modes.
   * Both directions are unconditional — no review-pending gate. Unreviewed journals
   * (if any) simply remain pending and can be reviewed manually from /journal later.
   */
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

  const tradingModeButtons = (
    <div className="flex items-center gap-1 border-l border-border pl-3 ml-1">
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
    </div>
  );

  const SpeedButtons = () => (
    <div className="flex items-center gap-1">
      {SPEED_OPTIONS.map(s => (
        <button
          key={s}
          onClick={() => onSetSpeed(s)}
          className={`px-2 py-1 rounded text-xs font-mono transition-all duration-100 ease-out active:scale-[0.95] ${
            speed === s
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary text-secondary-foreground hover:bg-accent'
          }`}
        >
          {s}x
        </button>
      ))}
    </div>
  );

  const TimeDisplay = ({ paused }: { paused?: boolean }) => (
    <div className="ml-auto flex items-center gap-4">
      {originTime != null && (
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted font-medium tracking-wide">启始</span>
          {formatUTC8(originTime)}
        </span>
      )}
      <span className={`font-mono text-sm font-medium ${paused ? 'text-yellow-400 animate-pulse' : 'text-primary'}`}>
        {paused && '⏸ '}
        <span ref={clockRef}>{formatUTC8(currentSimulatedTime)}</span>
      </span>
    </div>
  );

  return (
    <div className="panel px-4 py-3 bg-card">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Time Machine</span>
          {timeMode === 'isolated' && status !== 'stopped' && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent text-accent-foreground font-medium">独立时间轴</span>
          )}
        </div>

        <button
          onClick={() => setSignalLibOpen(o => !o)}
          title="信号库：上传「标的 + 时间 + 兜底区」，从下拉里点开标的即可直接跳转盘面"
          className={`flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] font-medium transition-colors ${
            signalLibOpen
              ? 'border-primary/40 bg-primary/15 text-primary'
              : 'border-border/60 text-muted-foreground hover:text-foreground hover:bg-accent'
          }`}
        >
          <Database className="w-3 h-3" />
          信号库
          {signals.length > 0 && (
            <span className="ml-0.5 rounded-full bg-primary/20 px-1.5 font-mono text-[9px] text-primary">{signals.length}</span>
          )}
          <ChevronDown className={`w-3 h-3 transition-transform ${signalLibOpen ? 'rotate-180' : ''}`} />
        </button>

        {status === 'stopped' && (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={dateInput}
              onChange={e => setDateInput(e.target.value)}
              placeholder="YYYY-MM-DD HH:mm:ss"
              className="input-dark w-52 text-xs"
            />
            <button onClick={handleStart} className="btn-long flex items-center gap-1.5 text-xs active:scale-[0.97]">
              <Play className="w-3.5 h-3.5" /> 启动
            </button>
            {modeSelectorButtons}
            {tradingModeButtons}
          </div>
        )}

        {status === 'playing' && (
          <>
            <div className="flex items-center gap-2">
              <button onClick={onPause} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 transition-all duration-100 ease-out active:scale-[0.97] font-medium">
                <Pause className="w-3.5 h-3.5" /> 暂停
              </button>
              <button onClick={onStop} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-destructive/20 text-destructive hover:bg-destructive/30 transition-all duration-100 ease-out active:scale-[0.97] font-medium">
                <Square className="w-3.5 h-3.5" /> 停止
              </button>
              <button
                onClick={openNoEntry}
                title="记录'该开没开'决策（不下单）"
                className="h-7 w-7 flex items-center justify-center rounded text-[#848E9C] hover:text-[#F0B90B] hover:bg-accent transition-colors"
              >
                <BookmarkX className="w-3.5 h-3.5" />
              </button>
            </div>
            <SpeedButtons />
            {modeSelectorButtons}
            {tradingModeButtons}
            <TimeDisplay />
          </>
        )}

        {status === 'paused' && (
          <>
            <div className="flex items-center gap-2">
              <button onClick={onResume} className="btn-long flex items-center gap-1.5 text-xs active:scale-[0.97]">
                <Play className="w-3.5 h-3.5" /> 继续
              </button>
              <button onClick={onStop} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-destructive/20 text-destructive hover:bg-destructive/30 transition-all duration-100 ease-out active:scale-[0.97] font-medium">
                <Square className="w-3.5 h-3.5" /> 停止
              </button>
              <button
                onClick={openNoEntry}
                title="记录'该开没开'决策（不下单）"
                className="h-7 w-7 flex items-center justify-center rounded text-[#848E9C] hover:text-[#F0B90B] hover:bg-accent transition-colors"
              >
                <BookmarkX className="w-3.5 h-3.5" />
              </button>
            </div>
            <SpeedButtons />
            {modeSelectorButtons}
            {tradingModeButtons}
            <TimeDisplay paused />
          </>
        )}
      </div>

      {/* 信号库折叠面板 */}
      {signalLibOpen && (
        <div className="mt-3 border-t border-border/60 pt-3">
          <div className="mb-1.5 text-[10px] text-muted-foreground">
            上传 / 粘贴信号 · 每行 <span className="font-mono text-foreground">标的, 时间, 兜底区</span> · 时间按 UTC+8（例：<span className="font-mono">BTCUSDT, 2024-01-15 16:00:00, 72000-74000</span>）
          </div>
          <textarea
            value={importText}
            onChange={e => setImportText(e.target.value)}
            rows={3}
            spellCheck={false}
            placeholder={'BTCUSDT, 2024-01-15 16:00:00, 72000-74000\nETHUSDT, 2024-02-01 09:30, 2300'}
            className="input-dark w-full resize-y font-mono text-[11px]"
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <button onClick={handleImport} className="btn-long flex items-center gap-1 px-2 py-1 text-[10px] active:scale-[0.97]">
              <Plus className="w-3 h-3" /> 导入
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Upload className="w-3 h-3" /> 上传文件
            </button>
            <input ref={fileRef} type="file" accept=".csv,.txt,.tsv" className="hidden" onChange={handleFile} />
            {signals.length > 0 && (
              <button
                onClick={handleClearSignals}
                className="ml-auto flex items-center gap-1 rounded px-2 py-1 text-[10px] text-destructive transition-colors hover:bg-destructive/10"
              >
                <Trash2 className="w-3 h-3" /> 清空
              </button>
            )}
          </div>

          {importErrors.length > 0 && (
            <div className="mt-1.5 space-y-0.5 text-[10px] text-destructive">
              {importErrors.slice(0, 5).map((er, i) => <div key={i}>{er}</div>)}
              {importErrors.length > 5 && <div>…等 {importErrors.length} 行未识别</div>}
            </div>
          )}

          <div className="mt-3">
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="筛选标的…"
              className="input-dark mb-2 w-full text-[11px]"
            />
            {sortedFiltered.length === 0 ? (
              <div className="rounded border border-dashed border-border/60 px-3 py-6 text-center text-[10px] text-muted-foreground">
                {signals.length === 0
                  ? '还没有信号。上传或粘贴「标的 + 时间 + 兜底区」后，这里会按字母顺序列出，点开即可越过手动输入、直接跳转盘面。'
                  : '没有匹配的标的。'}
              </div>
            ) : (
              <div className="max-h-56 divide-y divide-border/40 overflow-y-auto rounded border border-border/60">
                {sortedFiltered.map(sig => (
                  <div key={sig.id} className="group flex items-center gap-2 px-2.5 py-1.5 hover:bg-accent/60">
                    <button
                      onClick={() => handleJumpSignal(sig)}
                      className="flex flex-1 items-center gap-2 overflow-hidden text-left"
                      title={`跳转到 ${sig.symbol} @ ${sig.timeLabel}`}
                    >
                      <span className="w-24 shrink-0 font-mono text-[11px] font-medium text-foreground">{sig.symbol}</span>
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{sig.timeLabel}</span>
                      {sig.fallbackZone && (
                        <span className="truncate text-[10px] text-[#F0B90B]/90">兜底 {sig.fallbackZone}</span>
                      )}
                    </button>
                    <button
                      onClick={() => handleJumpSignal(sig)}
                      className="shrink-0 text-primary transition-colors hover:text-primary/70"
                      title="跳转盘面"
                    >
                      <ArrowRightCircle className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteSignal(sig.id)}
                      className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                      title="删除该信号"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* No-entry snapshot dialog */}
      <PreTradeSnapshotDialog
        isOpen={noEntryOpen}
        onOpenChange={setNoEntryOpen}
        mode="no_entry"
        symbol={noEntrySymbol}
        direction="no_entry"
        simulatedTimeMs={noEntrySimTime}
        lockedEntryPrice={ctx.priceMap[noEntrySymbol] ?? null}
        leverage={1}
        marginMode="isolated"
        pricePrecision={2}
      />

      {/* Guard Dialog — mounted only when needed, completely outside the flex layout */}
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
