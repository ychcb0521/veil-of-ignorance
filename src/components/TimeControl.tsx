import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Play, Pause, Square, Clock, BookmarkX,
  Database, ChevronDown, Upload, Plus, Trash2, X, ArrowRightCircle, CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatUTC8 } from '@/lib/timeFormat';
import {
  type TradeSignal,
  loadSignals, saveSignals, parseSignalText, mergeSignals, sortSignalsAlpha, sortSignalsByTime, signalMonthKey,
} from '@/lib/signalLibrary';
import type { TimeMachineStatus } from '@/hooks/useTimeSimulator';
import type { TimeMode } from '@/contexts/TradingContext';
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
  clockRef?: React.RefObject<HTMLSpanElement>;
  timeMode?: TimeMode;
  originTime?: number | null;
  onSymbolChange?: (symbol: string) => void;
  activeSymbol?: string;
  onJumpToSignal?: (symbol: string, timeMs: number) => void;
}

const SPEED_OPTIONS = [1, 2, 5, 10, 30, 60, 180, 300, 900];

export function TimeControl({
  status, currentSimulatedTime, speed,
  onStart, onPause, onResume, onStop, onSetSpeed, clockRef,
  timeMode = 'synced',
  originTime, onSymbolChange, activeSymbol, onJumpToSignal,
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

  // ===== 信号库（Time Machine 旁的折叠接口）=====
  const fileRef = useRef<HTMLInputElement>(null);
  const [signalLibOpen, setSignalLibOpen] = useState(false);
  const [signals, setSignals] = useState<TradeSignal[]>(() => loadSignals());
  // 「上传 / 粘贴信号」窗口默认折叠成一个极小的隐形入口；仅当信号库为空时默认展开，方便首次导入。
  const [importOpen, setImportOpen] = useState(() => signals.length === 0);
  const [importText, setImportText] = useState('');
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [monthFilter, setMonthFilter] = useState(''); // '' = 全部月份
  const [sortMode, setSortMode] = useState<'alpha' | 'time-desc' | 'time-asc'>('alpha');

  useEffect(() => { saveSignals(signals); }, [signals]);

  // 信号里出现过的月份（按 UTC+8 墙钟），倒序 + 每月条数，喂给「按月份定位」下拉。
  const monthOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of signals) {
      const k = signalMonthKey(s.timeMs);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([month, count]) => ({ month, count }));
  }, [signals]);

  // 选中的月份若因删除 / 清空而消失，自动回到「全部月份」。
  useEffect(() => {
    if (monthFilter && !monthOptions.some(m => m.month === monthFilter)) setMonthFilter('');
  }, [monthFilter, monthOptions]);

  const sortedFiltered = useMemo(() => {
    const q = query.trim().toUpperCase();
    let base = sortMode === 'alpha'
      ? sortSignalsAlpha(signals)
      : sortSignalsByTime(signals, sortMode === 'time-asc' ? 'asc' : 'desc');
    if (monthFilter) base = base.filter(s => signalMonthKey(s.timeMs) === monthFilter);
    return q ? base.filter(s => s.symbol.includes(q)) : base;
  }, [signals, query, monthFilter, sortMode]);

  // 「被做过交易」的标的集合：已平仓记录(tradeHistory) ∪ 当前持仓(positionsMap)，
  // 大写归一以匹配 sig.symbol。开仓即标记、平仓后仍保留——用于在信号库里识别已交易标的。
  const tradedSymbols = useMemo(() => {
    const set = new Set<string>();
    for (const t of ctx.tradeHistory) {
      if (t.symbol) set.add(t.symbol.toUpperCase());
    }
    for (const [sym, list] of Object.entries(ctx.positionsMap)) {
      if (Array.isArray(list) && list.length > 0) set.add(sym.toUpperCase());
    }
    return set;
  }, [ctx.tradeHistory, ctx.positionsMap]);

  const doImport = (text: string) => {
    const { signals: parsed, errors } = parseSignalText(text);
    setImportErrors(errors);
    if (parsed.length === 0) {
      toast.error('没有可导入的信号', { description: errors[0] ?? '请粘贴「日期时间表头 + 多行标的」或「标的, 时间, 兜底区」' });
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

  const handleStart = () => {
    const ts = new Date(dateInput.replace(' ', 'T') + 'Z').getTime() - 8 * 3600_000;
    if (isNaN(ts)) return;
    onStart(ts);
  };

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
                title="未下单但全程观察：当场不下单，只记录此刻判断；复盘时再分该开没开 / 正确避开"
                className="h-7 w-7 flex items-center justify-center rounded text-[#848E9C] hover:text-[#F0B90B] hover:bg-accent transition-colors"
              >
                <BookmarkX className="w-3.5 h-3.5" />
              </button>
            </div>
            <SpeedButtons />
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
                title="未下单但全程观察：当场不下单，只记录此刻判断；复盘时再分该开没开 / 正确避开"
                className="h-7 w-7 flex items-center justify-center rounded text-[#848E9C] hover:text-[#F0B90B] hover:bg-accent transition-colors"
              >
                <BookmarkX className="w-3.5 h-3.5" />
              </button>
            </div>
            <SpeedButtons />
            <TimeDisplay paused />
          </>
        )}
      </div>

      {/* 信号库折叠面板 */}
      {signalLibOpen && (
        <div className="mt-3 border-t border-border/60 pt-3">
          {/* 极简「上传 / 粘贴信号」入口：默认近乎隐形，点开才展开导入窗口 */}
          <button
            onClick={() => setImportOpen(o => !o)}
            title={importOpen ? '收起上传 / 粘贴信号' : '上传 / 粘贴信号'}
            className={`flex items-center gap-1 text-[10px] transition-colors ${
              importOpen ? 'text-primary' : 'text-muted-foreground/30 hover:text-muted-foreground'
            }`}
          >
            <Upload className="h-3 w-3" />
            <ChevronDown className={`h-2.5 w-2.5 transition-transform ${importOpen ? 'rotate-180' : ''}`} />
          </button>

          {importOpen && (
          <div className="mt-2">
          <div className="mb-1.5 text-[10px] text-muted-foreground">
            上传 / 粘贴信号 · 支持「<span className="font-mono text-foreground">日期时间表头 + 多行标的</span>」或「<span className="font-mono text-foreground">标的, 时间, 兜底区</span>」· 时间按 UTC+8 · 标的自动补 USDT
          </div>
          <textarea
            value={importText}
            onChange={e => setImportText(e.target.value)}
            rows={3}
            spellCheck={false}
            placeholder={'2026-04-29 18:27\nnaoris 0.107\nMoodeng 0.0608\n\n2026-04-28 21:00\ntac 谢林兜底区 0.0127'}
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
          </div>
          )}

          <div className="mt-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {signals.length > 0 && (
                <select
                  value={sortMode}
                  onChange={e => setSortMode(e.target.value as 'alpha' | 'time-desc' | 'time-asc')}
                  title="排序方式"
                  className="input-dark shrink-0 text-[11px]"
                >
                  <option value="alpha">标的 A→Z</option>
                  <option value="time-desc">时间 新→旧</option>
                  <option value="time-asc">时间 旧→新</option>
                </select>
              )}
              {monthOptions.length > 0 && (
                <select
                  value={monthFilter}
                  onChange={e => setMonthFilter(e.target.value)}
                  title="按月份定位信号"
                  className="input-dark shrink-0 font-mono text-[11px]"
                >
                  <option value="">全部月份（{signals.length}）</option>
                  {monthOptions.map(({ month, count }) => (
                    <option key={month} value={month}>{month}（{count}）</option>
                  ))}
                </select>
              )}
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="筛选标的…"
                className="input-dark min-w-[7rem] flex-1 text-[11px]"
              />
            </div>
            {sortedFiltered.length === 0 ? (
              <div className="rounded border border-dashed border-border/60 px-3 py-6 text-center text-[10px] text-muted-foreground">
                {signals.length === 0
                  ? '还没有信号。上传或粘贴「标的 + 时间 + 兜底区」后，这里会列出（可按标的或时间排序），点开即可越过手动输入、直接跳转盘面。'
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
                      <span
                        className="flex w-24 shrink-0 items-center gap-1 font-mono text-[11px] font-medium text-foreground"
                        title={tradedSymbols.has(sig.symbol) ? '已交易过该标的' : undefined}
                      >
                        {tradedSymbols.has(sig.symbol) && (
                          <CheckCircle2 className="h-3 w-3 shrink-0 text-[#0ecb81]" aria-label="已交易" />
                        )}
                        <span className="truncate">{sig.symbol}</span>
                      </span>
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
    </div>
  );
}
