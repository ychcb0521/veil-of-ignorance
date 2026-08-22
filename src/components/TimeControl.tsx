import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Play, Pause, Square, Clock, BookmarkX,
  Database, ChevronDown, Upload, Download, Plus, Trash2, X, ArrowRightCircle, CheckCircle2,
  AlertTriangle, Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatUTC8 } from '@/lib/timeFormat';
import {
  type TradeSignal,
  loadSignals, saveSignals, parseSignalText, serializeSignals, mergeSignals, sortSignalsAlpha, sortSignalsByTime, signalMonthKey,
} from '@/lib/signalLibrary';
import {
  preflightSignalJumpIssues,
  signalJumpIssueLabel,
  type SignalJumpResult,
} from '@/lib/signalJumpDiagnostics';
import type { TimeMachineStatus } from '@/hooks/useTimeSimulator';
import type { TimeMode } from '@/contexts/TradingContext';
import { useTradingContext } from '@/contexts/TradingContext';
import { useAuth } from '@/contexts/AuthContext';
import { listAllCampaigns } from '@/lib/journalApi';
import {
  buildCampaignDayIndex, buildTradedDayIndex,
  hasCampaignOnSignalDay, hasTradeOnSignalDay,
} from '@/lib/signalCampaignIndex';
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
  onJumpToSignal?: (symbol: string, timeMs: number) => Promise<SignalJumpResult>;
  signalJumpInterval?: string;
  signalJumpIntervalMs?: number;
}

const SPEED_OPTIONS = [1, 2, 5, 10, 30, 60, 180, 300, 900];

export function TimeControl({
  status, currentSimulatedTime, speed,
  onStart, onPause, onResume, onStop, onSetSpeed, clockRef,
  timeMode = 'synced',
  originTime, onSymbolChange, activeSymbol, onJumpToSignal,
  signalJumpInterval = '1m', signalJumpIntervalMs = 60_000,
}: Props) {
  const ctx = useTradingContext();
  const { user } = useAuth();
  const [noEntryOpen, setNoEntryOpen] = useState(false);
  const [noEntrySimTime, setNoEntrySimTime] = useState<number>(Date.now());
  const [visualSpeed, setVisualSpeed] = useState(speed);
  const speedPointerDownRef = useRef<number | null>(null);
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
  const [jumpingSignalId, setJumpingSignalId] = useState<string | null>(null);
  const [signalAuditProgress, setSignalAuditProgress] = useState<{
    checked: number;
    total: number;
  } | null>(null);
  const completedSignalAuditKeyRef = useRef<string | null>(null);
  const signalsForAuditRef = useRef(signals);
  signalsForAuditRef.current = signals;

  useEffect(() => { saveSignals(signals); }, [signals]);
  useEffect(() => { setVisualSpeed(speed); }, [speed]);

  const signalAuditKey = useMemo(() => {
    let hash = 2166136261;
    for (const signal of signals) {
      const value = `${signal.id}|${signal.symbol}|${signal.timeMs}`;
      for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
    }
    return `${signalJumpInterval}:${signalJumpIntervalMs}:${signals.length}:${hash >>> 0}`;
  }, [signalJumpInterval, signalJumpIntervalMs, signals]);

  useEffect(() => {
    const auditSignals = signalsForAuditRef.current;
    if (auditSignals.length === 0) {
      setSignalAuditProgress(null);
      return;
    }
    if (completedSignalAuditKeyRef.current === signalAuditKey) return;

    const controller = new AbortController();
    const candidates = auditSignals.map(({ id, symbol, timeMs }) => ({ id, symbol, timeMs }));
    const totalSymbols = new Set(candidates.map(item => item.symbol)).size;
    setSignalAuditProgress({ checked: 0, total: totalSymbols });

    void preflightSignalJumpIssues(
      candidates,
      signalJumpInterval,
      signalJumpIntervalMs,
      {
        signal: controller.signal,
        onProgress: ({ checkedSymbols, totalSymbols: total, fatalIssues }) => {
          if (controller.signal.aborted) return;
          if (fatalIssues.length > 0) {
            const issuesById = new Map(fatalIssues.map(item => [item.id, item.issue]));
            setSignals(prev => prev.map(item => {
              const nextIssue = issuesById.get(item.id);
              if (!nextIssue) return item;
              if (
                item.jumpIssue?.code === nextIssue.code
                && item.jumpIssue.reason === nextIssue.reason
              ) {
                return item;
              }
              return { ...item, jumpIssue: nextIssue };
            }));
          }
          setSignalAuditProgress({ checked: checkedSymbols, total });
        },
      },
    ).then((summary) => {
      if (controller.signal.aborted) return;
      if (
        !summary.retryableReason
        && summary.retryableSymbols === 0
        && summary.checkedSymbols === summary.totalSymbols
      ) {
        completedSignalAuditKeyRef.current = signalAuditKey;
      }
      setSignalAuditProgress(null);
    }).catch(() => {
      if (!controller.signal.aborted) setSignalAuditProgress(null);
    });

    return () => controller.abort();
  }, [
    signalAuditKey,
    signalJumpInterval,
    signalJumpIntervalMs,
  ]);

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
  // 「标的@日期」索引：信号那天，这个标的动过手没有。
  // 这里曾经只按标的判定（做过一次 TRB，所有 TRB 信号全被标成已交易），
  // 而同一个币种会在很多个日期出现——按标的判等于把标记稀释成「这币我碰过」，
  // 恰恰丢掉了「这一条信号我执行了没有」这个唯一有用的信息。
  const tradedDayIndex = useMemo(
    () => buildTradedDayIndex(ctx.tradeHistory, ctx.positionsMap),
    [ctx.tradeHistory, ctx.positionsMap],
  );

  // 「该标的在信号当日有没有开过战役」的索引。与上面的 tradedDayIndex 同为按日口径，
  // 但问的不是同一件事：那个是「当天动过手没有」（引擎里的成交/持仓），
  // 这个是「当天那笔交易被归类成战役了没有」——下了单但还没归类的日子只有勾号、没有圆点。
  // 战役数据在服务端，只在信号库展开时拉一次，避免每次渲染都打库。
  const [campaignDayIndex, setCampaignDayIndex] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!signalLibOpen || !user?.id) return;
    let cancelled = false;
    void listAllCampaigns(user.id)
      .then(list => { if (!cancelled) setCampaignDayIndex(buildCampaignDayIndex(list)); })
      // 拉取失败就不标注——这只是辅助信息，绝不能挡住信号库本身的使用
      .catch(() => { if (!cancelled) setCampaignDayIndex(new Set()); });
    return () => { cancelled = true; };
  }, [signalLibOpen, user?.id]);

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

  // 导出：把整库序列化成「区块格式」txt（与导入互逆，可原样再导入），触发浏览器下载。
  const handleExportSignals = () => {
    if (signals.length === 0) return;
    const text = serializeSignals(signals);
    const stamp = formatUTC8(Date.now()).replace(/[^\d]/g, '').slice(0, 12);
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `signal-library-${stamp || 'export'}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success(`已导出 ${signals.length} 条信号`);
  };

  const handleJumpSignal = async (sig: TradeSignal) => {
    if (!onJumpToSignal) {
      onSymbolChange?.(sig.symbol);
      // 选定标的即进入下一阶段，信号库没有继续停留的必要——与跳转成功后一致收起
      setSignalLibOpen(false);
      return;
    }
    if (jumpingSignalId) return;
    setJumpingSignalId(sig.id);
    try {
      const result = await onJumpToSignal(sig.symbol, sig.timeMs);
      if (result.ok) {
        if (sig.jumpIssue) {
          setSignals(prev => prev.map(item =>
            item.id === sig.id ? { ...item, jumpIssue: undefined } : item));
        }
        setSignalLibOpen(false);
        return;
      }
      if (result.fatalIssue) {
        setSignals(prev => prev.map(item =>
          item.id === sig.id ? { ...item, jumpIssue: result.fatalIssue } : item));
      }
    } finally {
      setJumpingSignalId(null);
    }
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
          type="button"
          key={s}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            speedPointerDownRef.current = s;
            setVisualSpeed(s);
            onSetSpeed(s);
          }}
          onClick={() => {
            if (speedPointerDownRef.current === s) {
              speedPointerDownRef.current = null;
              return;
            }
            setVisualSpeed(s);
            onSetSpeed(s);
          }}
          className={`px-2 py-1 rounded text-xs font-mono transition-all duration-100 ease-out active:scale-[0.95] ${
            visualSpeed === s
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
        <div data-testid="signal-library-panel" className="mt-2 border-t border-border/60 pt-2">
          {/* 统一工具条：筛选 + 导入 / 导出 / 预检。
              原先「只放两个 12px 图标」的独立一行已并入这里——横向本来就过剩，
              纵向才是稀缺的，这是把过剩的横向兑换成纵向的一次交易。 */}
          <div>
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              {signals.length > 0 && (
                <select
                  value={sortMode}
                  onChange={e => setSortMode(e.target.value as 'alpha' | 'time-desc' | 'time-asc')}
                  title="排序方式"
                  className="input-dark h-[22px] shrink-0 px-1.5 py-0.5 text-[11px]"
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
                  className="input-dark h-[22px] shrink-0 px-1.5 py-0.5 font-mono text-[11px]"
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
                className="input-dark min-w-[7rem] flex-1 px-1.5 py-0.5 text-[11px] leading-4"
              />
              <button
                onClick={() => setImportOpen(o => !o)}
                title={importOpen ? '收起上传 / 粘贴信号' : '上传 / 粘贴信号'}
                className={`flex h-[22px] shrink-0 items-center gap-0.5 rounded px-1.5 transition-colors ${
                  importOpen ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                <Upload className="h-3 w-3" />
                <ChevronDown className={`h-2.5 w-2.5 transition-transform ${importOpen ? 'rotate-180' : ''}`} />
              </button>
              {signals.length > 0 && (
                <button
                  onClick={handleExportSignals}
                  title="导出信号库为 txt（与导入互逆，可原样再导入）"
                  className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Download className="h-3 w-3" />
                </button>
              )}
              {signalAuditProgress && (
                <span
                  className="flex shrink-0 items-center gap-1 font-mono text-[10px] leading-4 text-muted-foreground/70"
                  title="正在后台预检无法跳转的信号；不影响正常点击"
                  aria-live="polite"
                >
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  预检 {signalAuditProgress.checked}/{signalAuditProgress.total}
                </span>
              )}
            </div>
          {importOpen && (
            <div className="mb-1.5">
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

            {sortedFiltered.length === 0 ? (
              <div className="rounded border border-dashed border-border/60 px-3 py-4 text-center text-[10px] text-muted-foreground">
                {signals.length === 0
                  ? '还没有信号。上传或粘贴「标的 + 时间 + 兜底区」后，这里会列出（可按标的或时间排序），点开即可越过手动输入、直接跳转盘面。'
                  : '没有匹配的标的。'}
              </div>
            ) : (
              <div className="overflow-hidden rounded border border-border/60">
                {/* 表头：与行共用同一套列宽，四列各有名分，不再靠位置猜 */}
                <div className="grid grid-cols-[minmax(108px,148px)_128px_minmax(0,1fr)_auto] items-center gap-2 border-b border-border/60 bg-muted/40 px-2 py-1 pr-[58px] text-[9px] leading-3 font-medium text-muted-foreground">
                  <span className="grid grid-cols-[12px_minmax(0,1fr)] items-center gap-1"><span aria-hidden /><span>标的</span></span>
                  <span>信号时间</span>
                  <span>兜底区</span>
                  <span className="w-5" aria-hidden />
                </div>
                <div className="max-h-56 divide-y divide-border/30 overflow-y-auto overscroll-contain">
                {sortedFiltered.map(sig => {
                  const hasDayCampaign = hasCampaignOnSignalDay(campaignDayIndex, sig);
                  const tradedOnSignalDay = hasTradeOnSignalDay(tradedDayIndex, sig);
                  return (
                  <div key={sig.id} className="group flex items-stretch gap-1.5 px-2 py-0.5 transition-colors hover:bg-accent/60">
                    <button
                      onClick={() => handleJumpSignal(sig)}
                      disabled={jumpingSignalId != null}
                      className="grid flex-1 grid-cols-[minmax(108px,148px)_128px_minmax(0,1fr)_auto] items-center gap-2 overflow-hidden text-left disabled:cursor-wait disabled:opacity-70"
                      title={sig.jumpIssue?.reason ?? `跳转到 ${sig.symbol} @ ${sig.timeLabel}`}
                    >
                      {/* 标的：勾号在前，名称可截断但列宽足够放下常见长度 */}
                      {/* 勾号占一条固定的 12px 列，没勾时留空位而不是让标的左移——
                          条件渲染会让带勾与不带勾的行首字母错开，勾号本身也没有固定的一列可扫。 */}
                      <span
                        className="grid min-w-0 grid-cols-[12px_minmax(0,1fr)] items-center gap-1 font-mono text-[11px] font-medium leading-4 text-foreground"
                        title={tradedOnSignalDay ? `${sig.timeLabel.slice(0, 10)} 当日交易过 ${sig.symbol}` : undefined}
                      >
                        {tradedOnSignalDay
                          ? <CheckCircle2 className="h-3 w-3 text-[#0ecb81]" aria-label="信号当日已交易" />
                          : <span aria-hidden />}
                        <span className="truncate">{sig.symbol}</span>
                      </span>
                      {/* 时间：定宽等宽字体，纵向严格成列 */}
                      <span className="flex items-center gap-1">
                        <span className="font-mono text-[10px] leading-4 tabular-nums text-muted-foreground">{sig.timeLabel}</span>
                        {hasDayCampaign && (
                          // 低调标注：当日该标的已有战役。小圆点而非文字/勾号，
                          // 扫视时不抢注意力，需要时 hover 才给出说明。
                          <span
                            data-testid="signal-day-campaign"
                            title="当日该标的已有交易战役"
                            aria-label="当日已有战役"
                            className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#0ecb81]/50"
                          />
                        )}
                      </span>
                      {/* 兜底区：占据剩余宽度，长文本截断而不挤压他列 */}
                      <span className="truncate text-[10px] leading-4 text-[#F0B90B]/90">
                        {sig.fallbackZone ? `兜底 ${sig.fallbackZone}` : ''}
                      </span>
                      {/* 不可跳转：收成一枚图标徽标，原因进 tooltip——
                          整行文字会把兜底区挤没，且它只在少数行出现 */}
                      {sig.jumpIssue ? (
                        <span
                          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive"
                          title={`不可跳转 · ${signalJumpIssueLabel(sig.jumpIssue.code)}｜${sig.jumpIssue.reason}`}
                          aria-label={`不可跳转：${signalJumpIssueLabel(sig.jumpIssue.code)}`}
                        >
                          <AlertTriangle className="h-3 w-3" />
                        </span>
                      ) : (
                        <span className="h-4 w-4 shrink-0" aria-hidden />
                      )}
                    </button>
                    <button
                      onClick={() => handleJumpSignal(sig)}
                      disabled={jumpingSignalId != null}
                      className="flex h-5 w-5 shrink-0 items-center justify-center text-primary transition-colors hover:text-primary/70 disabled:cursor-wait disabled:opacity-60"
                      title={sig.jumpIssue?.reason ?? '跳转盘面'}
                    >
                      {jumpingSignalId === sig.id
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <ArrowRightCircle className="h-4 w-4" />}
                    </button>
                    <button
                      onClick={() => handleDeleteSignal(sig.id)}
                      className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                      title="删除该信号"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  );
                })}
                </div>
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
