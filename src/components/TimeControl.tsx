import { useFishAccountSettings } from '@/hooks/useFishAccountSettings';
import {setMatchingSourceQuality} from '@/lib/fish/qualitySourceRatings';
import { readFishAccountSettings } from '@/lib/fish/accountSettings';
import {FishBulkDeletionProvider} from './FishBulkDeletion';
import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { useFishAutoScan } from '@/hooks/useFishAutoScan';
import { useFishMining } from '@/hooks/useFishMining';
import { useFishFeatures } from '@/hooks/useFishFeatures';
import {useFishViewportHeight} from '@/hooks/useFishViewportHeight';
import { SignalTurnoverButton } from './SignalTurnover';
import {
  Play, Pause, Square, Clock, BookmarkX,
  Database, ChevronDown, Upload, Download, Plus, Trash2,
  Loader2, Fish, X,
} from 'lucide-react';
import { beginCloseReviewQuiet, toast } from '@/lib/notificationCenter';
import { formatUTC8 } from '@/lib/timeFormat';
import { latestInstantReplaySymbol } from '@/lib/fish/latestScreenedReplaySymbol';
import { useLatestInstantReplay } from '@/hooks/useLatestInstantReplay';
import {
  type TradeSignal, type SignalSortKey,
  parseSignalText, serializeSignals, mergeSignals, sortSignalsAlpha, sortSignalsByTime, signalMonthKey,
  normalizeSignalQuality, setSignalQuality, signalChartSymbol,signalDedupKey,
  sortSignalsBy,
} from '@/lib/signalLibrary';
import { useFishReconstruction } from '@/hooks/useFishReconstruction';
import { useSignalLibrary } from '@/hooks/useSignalLibrary';
import { ENTRY_PERIOD_SIGNALS_KEY, ENTRY_PERIOD_MARKETS, entryPeriodEndLabel, entryPeriodMarketGroup, entryPeriodMarketLabel, mergeEntryPeriodSignals, type EntryPeriodMarket } from '@/lib/entryPeriodSignals';
import { usePersistedState } from '@/hooks/usePersistedState';
import { hydrateSimState } from '@/lib/simStateSync';
import { isTuringCupSymbol, turingCupSymbol, turingCupTicker } from '@/lib/turingCupSymbol';
import { reconstructionMatches } from '@/components/FishReconstruction';
import { useFish } from '@/hooks/useFish';
import { useFishCaptureAutomation, usePageFishQuality, useScreenedInstantPositions } from '@/contexts/FishQualityContext';
import { armQualityReturn } from '@/lib/fish/qualityReturn';
import type { FishExchange } from '@/lib/fish/exchanges';
import { FishPanel, FISH_DEFAULT_ALGORITHMS } from '@/components/FishPanel';
import { ModuleErrorBoundary } from '@/components/ModuleErrorBoundary';
import { SpeedSelector } from '@/components/SpeedSelector';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { SignalLibraryHeader } from '@/components/SignalLibraryHeader';
import { SignalLibraryList } from '@/components/SignalLibraryList';
import {
  preflightSignalJumpIssues,
  type SignalJumpOptions,
  type SignalJumpResult,
} from '@/lib/signalJumpDiagnostics';
import type { TimeMachineStatus } from '@/hooks/useTimeSimulator';
import type { TimeMode } from '@/contexts/TradingContext';
import { useTradingContext } from '@/contexts/TradingContext';
import { useAuth } from '@/contexts/AuthContext';
import { TuringCupReplayPanel } from '@/components/TuringCupReplayPanel';
import { useTuringReplayArchive } from '@/hooks/useTuringReplayArchive';
import { turingReplaySamples } from '@/lib/turingReplaySamples';
import { sourceDeletionMatcher } from '@/lib/fish/libraryDeletion';
import { listAllCampaigns } from '@/lib/journalApi';
import { buildCampaignDayIndex, buildTradedDayIndex } from '@/lib/signalCampaignIndex';
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
  /** 【用户要求】2026-10-19 主栏不再显示「独立时间轴」角标；仍收这个参数，调用方不用改。 */
  timeMode?: TimeMode;
  originTime?: number | null;
  onSymbolChange?: (symbol: string) => void;
  onSelectDefaultReplaySymbol?: (symbol: string) => void;
  activeSymbol?: string;
  onJumpToSignal?: (symbol: string, timeMs: number, options?: SignalJumpOptions) => Promise<SignalJumpResult>;
  signalJumpInterval?: string;
  signalJumpIntervalMs?: number;
}

const FISH_TIME_KEY = 'veil.fish.time';
const EMPTY_SIGNALS: TradeSignal[] = [];
type SignalLibraryKind = 'library' | 'entry-period' | 'turing';
const SIGNAL_LIBRARY_NAMES = {
  'entry-period': '进场期信号库',
  library: '潜力区信号库',
  turing: '图灵杯',
} satisfies Record<SignalLibraryKind, string>;

function ReplayStartControls({ dateInput, onChange, onStart }: {
  dateInput: string | null;
  onChange: (value: string) => void;
  onStart: (timestamp: number) => void;
}) {
  const [now, setNow] = useState(Date.now);
  const [focusedAt, setFocusedAt] = useState<number | null>(null);
  const followingClock = dateInput === null && focusedAt === null;
  useEffect(() => {
    if (!followingClock) return;
    const update = () => setNow(Date.now());
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [followingClock]);
  const start = () => {
    const timestamp = dateInput === null
      ? Math.floor(Date.now() / 1_000) * 1_000
      : new Date(dateInput.replace(' ', 'T') + 'Z').getTime() - 8 * 3600_000;
    if (Number.isFinite(timestamp)) onStart(timestamp);
  };
  return <div className="flex items-center gap-2">
    <input
      type="text"
      value={dateInput ?? formatUTC8(focusedAt ?? now)}
      onFocus={() => setFocusedAt(now)}
      onBlur={() => setFocusedAt(null)}
      onChange={event => onChange(event.target.value)}
      placeholder="YYYY-MM-DD HH:mm:ss"
      className="input-dark w-52 text-xs"
    />
    <button onClick={start} className="btn-long flex items-center gap-1.5 text-xs active:scale-[0.97]">
      <Play className="w-3.5 h-3.5" /> 启动
    </button>
  </div>;
}

export function TimeControl({
  status, currentSimulatedTime, speed,
  onStart, onPause, onResume, onStop, onSetSpeed, clockRef,
  originTime, onSymbolChange, onSelectDefaultReplaySymbol, activeSymbol, onJumpToSignal,
  signalJumpInterval = '1m', signalJumpIntervalMs = 60_000,
}: Props) {
  const ctx = useTradingContext();
  const { user } = useAuth();
  const { settings: fishAccountSettings } = useFishAccountSettings(true);
  const [noEntryOpen, setNoEntryOpen] = useState(false);
  const [noEntrySimTime, setNoEntrySimTime] = useState<number>(Date.now());
  const [noEntryTimelineId, setNoEntryTimelineId] = useState<string | null>(null);
  // 按下即高亮的乐观镜像；外部倍速变化（刷新后读回持久化速度、全屏选择器改速）
  // 必须回灌，否则高亮停在旧档位，看起来像「我选的 3600x 被拒绝了」。
  const [visualSpeed, setVisualSpeed] = useState(speed);
  useEffect(() => { setVisualSpeed(speed); }, [speed]);
  const noEntrySymbol = activeSymbol || 'BTCUSDT';

  const openNoEntry = () => {
    setNoEntrySimTime(ctx.getEffectiveTime(noEntrySymbol));
    // 与锁定的模拟时间同一刻取时间线，赶在自动暂停之前。
    setNoEntryTimelineId(ctx.getTimelineId(noEntrySymbol));
    if (status === 'playing') onPause();
    setNoEntryOpen(true);
  };
  const [dateInput, setDateInput] = useState<string | null>(null);
  const replayDateEdited = useRef(false);

  // ===== 信号库（Time Machine 旁的折叠接口）=====
  const fileRef = useRef<HTMLInputElement>(null);
  const [signalLibOpen, setSignalLibOpen] = useState(false);
  const signalMenuButtonRef = useRef<HTMLButtonElement>(null);
  const signalLibraryView = useRef(0);
  const collapseSignalLibrary = useCallback(() => {
    signalLibraryView.current += 1;
    setSignalLibOpen(false);
  }, []);
  const closeSignalLibrary = () => {
    collapseSignalLibrary();
    signalMenuButtonRef.current?.focus();
  };
  const closeSignalLibraryOnEscape = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing
      || !event.currentTarget.contains(event.target as Node)) return;
    event.stopPropagation();
    closeSignalLibrary();
  };
  const [library, setLibrary] = useState<SignalLibraryKind>('library');
  const turing = library === 'turing';
  const entryPeriod = library === 'entry-period';
  const entryLibraryOpen = signalLibOpen && entryPeriod;
  // 【用户要求】从鱼质量点进交易战役再返回：自动展开「渔」，鱼质量回到原来的位置（见 lib/fish/qualityReturn）
  const [fishOpen, setFishOpen] = useState(() => armQualityReturn(Date.now(),user?.id));
  // 【用户要求】2026-10-26 打开「渔」时不弹「刚平了一笔 — 要现在做平仓评价吗？」，只记进消息列表
  useEffect(() => fishOpen ? beginCloseReviewQuiet() : undefined, [fishOpen]);
  const fishHostRef = useRef<HTMLDivElement>(null);
  const fishHeight=useFishViewportHeight(fishOpen,fishHostRef);
  const fishReturnPosition = useRef<{panelTop:number;ancestors:{node:HTMLElement;top:number;left:number}[]}|null>(null);
  const rememberFishPosition = useCallback(()=>{
    const panel=fishHostRef.current?.querySelector<HTMLElement>('[data-testid="fish-panel"]');
    if(!panel)return;
    const ancestors:{node:HTMLElement;top:number;left:number}[]=[];
    for(let node=fishHostRef.current?.parentElement;node;node=node.parentElement)ancestors.push({node,top:node.scrollTop,left:node.scrollLeft});
    fishReturnPosition.current={panelTop:panel.scrollTop,ancestors};
  },[]);
  useLayoutEffect(()=>{
    if(!fishOpen||!fishReturnPosition.current)return;
    const restore=()=>{const saved=fishReturnPosition.current,panel=fishHostRef.current?.querySelector<HTMLElement>('[data-testid="fish-panel"]');if(!saved||!panel)return;panel.scrollTop=saved.panelTop;for(const {node,top,left} of saved.ancestors)if(node.isConnected){node.scrollTop=top;node.scrollLeft=left;}};
    restore();const frame=requestAnimationFrame(restore);return()=>cancelAnimationFrame(frame);
  },[fishOpen]);
  // 历史截止时间仅用于本轮；算法与调度优先恢复已保存的账号配置。
  const [fishInputs, setFishInputsState] = useState({ time: '', threshold: '0.3' });
  const setFishInputs = useCallback((value: { time: string; threshold: string }) => { setFishInputsState(value); try { sessionStorage.setItem(FISH_TIME_KEY, value.time); } catch { /* 记不住只是刷新后要重填 */ } }, []);
  const [fishSelection, setFishSelection] = useState<{ exchanges: FishExchange[]; includeDuplicates: boolean; includeUsStocks?: boolean }>(() => readFishAccountSettings()?.selection ?? { exchanges: ['binance'], includeDuplicates: false, includeUsStocks: false });
  useEffect(() => { setFishSelection(fishAccountSettings?.selection ?? { exchanges: ['binance'], includeDuplicates: false, includeUsStocks: false }); }, [fishAccountSettings, user?.id]);
  const { enqueue, notify: fishNotify } = useFishCaptureAutomation();
  const fish = useFish(user?.id, { onNewFish: (signal, liveCapturedAt) => {
    enqueue(signal, status === 'stopped' ? liveCapturedAt : undefined);
  } });
  const [onlineSignals, setOnlineSignals] = useSignalLibrary();
  const [entrySignals, setEntrySignals] = usePersistedState(ENTRY_PERIOD_SIGNALS_KEY, EMPTY_SIGNALS);
  const [entrySyncStatus, setEntrySyncStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [entrySyncAttempt, setEntrySyncAttempt] = useState(0);
  useEffect(() => {
    const account = user?.id;
    if (!entryLibraryOpen || !account) return;
    const request = new AbortController();
    const timeout = window.setTimeout(() => {
      request.abort();
      setEntrySyncStatus('error');
    }, 12_000);
    const finish = (status: 'ready' | 'error') => {
      window.clearTimeout(timeout);
      if (!request.signal.aborted) setEntrySyncStatus(status);
    };
    void hydrateSimState(account, [ENTRY_PERIOD_SIGNALS_KEY], request.signal).then(
      result => finish(result.status === 'hydrated' || result.status === 'empty' ? 'ready' : 'error'),
      () => finish('error'),
    );
    return () => {
      window.clearTimeout(timeout);
      request.abort();
    };
  }, [entryLibraryOpen, entrySyncAttempt, user?.id]);
  const entryNeedsSync = entryLibraryOpen && !!user?.id && entrySignals.length === 0 && entrySyncStatus !== 'ready';

  const entrySignalsRef = useRef(entrySignals);
  entrySignalsRef.current = entrySignals;
  const [savedTuringSignals, setSavedTuringSignals] = usePersistedState('turing_cup_signals_v1', EMPTY_SIGNALS);
  const [workspaceRequested, setWorkspaceRequested] = useState(fishOpen);
  const [workspaceTuringOpen, setWorkspaceTuringOpen] = useState(false);
  const needsTuringArchive = (turing && signalLibOpen) || (fishOpen && workspaceTuringOpen) || isTuringCupSymbol(activeSymbol ?? '');
  const turingArchive = useTuringReplayArchive(user?.id, needsTuringArchive);
  const replaySamples = useMemo(() => turingArchive.archive ? turingReplaySamples(turingArchive.archive) : EMPTY_SIGNALS, [turingArchive.archive]);
  const replayIds = useMemo(() => new Set(replaySamples.map(signal => signal.id)), [replaySamples]);
  const turingInputs = useMemo(() => {
    const saved = Array.isArray(savedTuringSignals) ? savedTuringSignals.filter(signal =>
      signal && typeof signal.id === 'string' && typeof signal.symbol === 'string' && isTuringCupSymbol(signal.symbol)
      && Number.isFinite(signal.timeMs) && typeof signal.timeLabel === 'string' && typeof signal.fallbackZone === 'string'
      && (!signal.turingReplaySample || replayIds.has(signal.id))
    ) : EMPTY_SIGNALS;
    return replaySamples.length ? mergeSignals(saved, replaySamples) : saved;
  }, [savedTuringSignals, replaySamples, replayIds]);
  const fishQuality = usePageFishQuality(fish.signals, onlineSignals, turingInputs, workspaceRequested || (signalLibOpen && !entryPeriod), false);
  const panelQuality = {
    ...fishQuality,
    ...(!workspaceRequested ? { requestWorkspace: () => setWorkspaceRequested(true) } : {}),
    workspaceTuringSource: {
      onOpenChange: setWorkspaceTuringOpen,
      loading: turingArchive.loading,
      error: turingArchive.error,
      retry: turingArchive.retry,
    },
  };
  const instant = useScreenedInstantPositions();
  const openScreenedPositions = instant?.positions;
  const openBinanceCampaigns = instant?.usdtLive?.openCampaigns;
  const { admitted, localSales } = fishQuality.cdaTracking ?? {};
  const recentArchive = useLatestInstantReplay(user?.id, status === 'stopped' && !replayDateEdited.current);
  const replaySymbol = useMemo(() => latestInstantReplaySymbol(recentArchive, openScreenedPositions, admitted, localSales, openBinanceCampaigns),
    [recentArchive, openScreenedPositions, admitted, localSales, openBinanceCampaigns]);
  useEffect(() => {
    if (status !== 'stopped') replayDateEdited.current = true;
    if (replayDateEdited.current || !replaySymbol) return;
    onSelectDefaultReplaySymbol?.(replaySymbol);
  }, [status, replaySymbol, onSelectDefaultReplaySymbol]);
  const { deletedSources, resolvedLegacySources } = fishQuality.study;
  const turingSignals = useMemo(() => {
    const deleted = sourceDeletionMatcher(deletedSources, resolvedLegacySources);
    return turingInputs.filter(signal => !signal.turingReplaySample || !deleted(signal, signal.timeMs, 'turing'));
  }, [turingInputs, deletedSources, resolvedLegacySources]);
  const visibleReplaySamples = useMemo(() => turingSignals.filter(signal => signal.turingReplaySample), [turingSignals]);
  const setTuringSignals = useCallback((value: TradeSignal[] | ((previous: TradeSignal[]) => TradeSignal[])) => {
    setSavedTuringSignals(previous => {
      const saved = Array.isArray(previous) ? previous.filter(signal => signal && typeof signal.symbol === 'string') : [];
      const next = typeof value === 'function' ? value(mergeSignals(saved, visibleReplaySamples)) : value;
      // The archive regenerates sample rows. Persist only signals and user edits to those samples.
      return next.filter(signal => !signal.turingReplaySample || signal.quality !== undefined || signal.jumpIssue !== undefined);
    });
  }, [setSavedTuringSignals, visibleReplaySamples]);
  const [signals, setSignals] = entryPeriod ? [entrySignals, setEntrySignals]
    : turing ? [turingSignals, setTuringSignals] : [onlineSignals, setOnlineSignals];
  const libraryName = SIGNAL_LIBRARY_NAMES[library];
  const onlineReconstruction = useFishReconstruction(user?.id, onlineSignals, fish.reconstruct);
  const turingReconstruction = useFishReconstruction(user?.id, turingSignals, fish.reconstruct, true);
  const reconstruction = turing ? turingReconstruction : onlineReconstruction;
  // 定时自动捕捞：放在这里而不是面板里，面板收起时也照常按时捕
  const reconstructionRunning = useRef(false); reconstructionRunning.current = onlineReconstruction.running || turingReconstruction.running;
  const fishAuto = useFishAutoScan({ account: user?.id, selection: fishSelection,
    start: settings => fish.startWithProgress(settings, status === 'stopped'), busy: () => fish.busy() || reconstructionRunning.current });
  const fishWasOpen = useRef(false);
  useEffect(() => {
    if (fishOpen && !fishWasOpen.current) {
      fishAuto.resetDefaults();
      if (fishInputsRef.current.time) setFishInputs({ ...fishInputsRef.current, time: '' });
    }
    fishWasOpen.current = fishOpen;
  }, [fishOpen, fishAuto.resetDefaults, setFishInputs]);
  // 比较探测的持续挖掘：取数器空闲才挖，捕捞一开始就让路
  const fishDefs = useFishFeatures();
  const fishMining = useFishMining({ account: user?.id, selection: fishSelection, defs: fishDefs, mine: fish.mine, stop: fish.stopMining, busy: () => fish.busy() || reconstructionRunning.current, signalsRef: fish.signalsRef, commit: fish.commit });
  // 切到自动模式时时间回到「现在」；之后在自动模式里自己输的照用（只用于手动点「开始捕捞」）
  const fishInputsRef = useRef(fishInputs); fishInputsRef.current = fishInputs;
  const lastFishMode = useRef(fishAuto.mode);
  useEffect(() => { if (fishAuto.mode === 'auto' && lastFishMode.current !== 'auto' && fishInputsRef.current.time) setFishInputs({ ...fishInputsRef.current, time: '' }); lastFishMode.current = fishAuto.mode; }, [fishAuto.mode, setFishInputs]);
  const signalMatches = useMemo(() => reconstructionMatches(reconstruction.result, reconstruction.mode, reconstruction.stale), [reconstruction.result, reconstruction.mode, reconstruction.stale]);
  // 「上传 / 粘贴信号」窗口默认折叠成一个极小的隐形入口；仅当信号库为空时默认展开，方便首次导入。
  const [importOpen, setImportOpen] = useState(() => signals.length === 0);
  const [importText, setImportText] = useState('');
  const [entryImportPending, setEntryImportPending] = useState(false);
  const [marketFilter, setMarketFilter] = useState<EntryPeriodMarket | ''>('');
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [monthFilter, setMonthFilter] = useState(''); // '' = 全部月份
  /**
   * 排序改成**点表头**,不再用独立的下拉框:列名本来就在那儿,
   * 再放一个「标的 A→Z」的选择器等于把同一件事说两遍,而且它排不了新增的评分列。
   */
  const [sortKey, setSortKey] = useState<SignalSortKey>('symbol');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const libraryMenu: { kind: SignalLibraryKind; count: number; title?: string }[] = [
    { kind: 'entry-period', count: entrySignals.length },
    { kind: 'library', count: onlineSignals.length, title: '上传「标的 + 时间 + 兜底区」，点开标的跳转盘面' },
    { kind: 'turing', count: turingSignals.length, title: '使用导入的离线行情查看盘面和复盘' },
  ];
  const toggleLibrary = (next: SignalLibraryKind) => {
    signalLibraryView.current += 1;
    setFishOpen(false);
    if (next === 'entry-period' && !entryLibraryOpen) setEntrySyncStatus('loading');
    if (next !== library) {
      setLibrary(next);
      const nextSignals = next === 'entry-period' ? entrySignals : next === 'turing' ? turingSignals : onlineSignals;
      setImportOpen(nextSignals.length === 0);
      setMarketFilter('');
      setImportText('');
      setImportErrors([]);
      setQuery('');
      setMonthFilter('');
      setSortKey('symbol');
      setSortDir('asc');
    }
    setSignalLibOpen(open => next !== library || !open);
  };
  const toggleSort = (key: SignalSortKey) => {
    if (key === sortKey) { setSortDir(d => (d === 'asc' ? 'desc' : 'asc')); return; }
    setSortKey(key);
    // 文本和分类按默认顺序，数值和时间从大的起。
    setSortDir(key === 'symbol' || key === 'entryMarket' ? 'asc' : 'desc');
  };

  /**
   * 选中某个具体月份时把排序切成「时间 旧→新」。
   *
   * 两种浏览方式要的顺序不同：看全部月份是在上千条里找某个标的，字母序才查得动；
   * 缩到一个月是在读那段时间里信号出现的先后，字母序会把时间线打散。
   *
   * 只在「切换月份」这个动作上生效，之后手动改排序不会被抢回去——
   * 每次重新选月份才重新应用这个默认值。切回「全部月份」不动排序：
   * 用户没要求那个方向，替他改回去只会显得系统在跟他抢方向盘。
   */
  const selectMonth = (month: string) => {
    setMonthFilter(month);
    if (month) { setSortKey('time'); setSortDir('asc'); }
  };
  const [pendingJump, setPendingJump] = useState<{ id: string; fromQuality: boolean } | null>(null);
  const jumpingSignalId = pendingJump?.id ?? null;
  const [signalAuditProgress, setSignalAuditProgress] = useState<{
    checked: number;
    total: number;
  } | null>(null);
  const completedSignalAuditKeys = useRef<{ library?: string; turing?: string }>({});
  const [turingCoverageWarning, setTuringCoverageWarning] = useState(false);
  /**
   * 行上的三个回调（跳转 / 删除 / 打分）必须**身份恒定**：
   * TimeControl 每跳一格模拟时间就重渲染一次（时钟、倍速、状态都挂在它身上），
   * 回调一换身份，memo 化的信号列表立刻失效，回放期间每跳一格都要重渲染整张表。
   * 所以凡是会变的东西一律走 ref，useCallback 的依赖保持为空。
   */
  const signalsRef = useRef(signals);
  signalsRef.current = signals;
  const pendingJumpRef = useRef<typeof pendingJump>(null);
  const jumpPropsRef = useRef({ onJumpToSignal, onSymbolChange });
  jumpPropsRef.current = { onJumpToSignal, onSymbolChange };

  useEffect(() => { setVisualSpeed(speed); }, [speed]);

  const signalAuditKey = useMemo(() => {
    if (!signalLibOpen || entryPeriod) return '';
    let hash = 2166136261;
    for (const signal of signals) {
      const value = `${signal.id}|${signal.market??'crypto'}|${signal.symbol}|${signal.timeMs}`;
      for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
    }
    return `${signalJumpInterval}:${signalJumpIntervalMs}:${signals.length}:${hash >>> 0}`;
  }, [signalLibOpen, entryPeriod, signalJumpInterval, signalJumpIntervalMs, signals]);

  useEffect(() => {
    if (!signalAuditKey) { setSignalAuditProgress(null); return; }
    const auditSignals = signalsRef.current.filter(s => !s.turingReplaySample && signalChartSymbol(s));
    if (auditSignals.length === 0) {
      if (turing) setTuringCoverageWarning(false);
      setSignalAuditProgress(null);
      return;
    }
    const source = turing ? 'turing' : 'library';
    if (completedSignalAuditKeys.current[source] === signalAuditKey) { setSignalAuditProgress(null); return; }

    const controller = new AbortController();
    const candidates = auditSignals.map(s => ({ id: s.id, symbol: signalChartSymbol(s)!, timeMs: s.timeMs }));
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
      if (turing) setTuringCoverageWarning(summary.retryableSymbols > 0);
      if (
        !summary.retryableReason
        && summary.retryableSymbols === 0
        && summary.checkedSymbols === summary.totalSymbols
      ) {
        completedSignalAuditKeys.current[source] = signalAuditKey;
      }
      setSignalAuditProgress(null);
    }).catch(() => {
      if (!controller.signal.aborted) setSignalAuditProgress(null);
    });

    return () => controller.abort();
  }, [
    signalAuditKey,
    setSignals,
    turing,
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

  /**
   * 【用户要求】打分后不重排：按评分排序时刚打分的那一条一下子跳走、找不着了。
   * 打分时记下这一条打分前的评分（每条只记第一次，null = 未评），排序按记下的评分算，行里照常显示新评分；
   * 用户点表头换排序 / 切方向、换月份或搜索（listResetKey 变了）时清空，按新评分重排。
   */
  /**
   * 「这一批行是按什么口径排出来的」的指纹，交给列表决定何时把滚动条拨回顶部。
   * 刻意不看 sortedFiltered 的身份：打分和删除也会换掉那个数组，
   * 但那两种情况下把人弹回顶部只会让他丢失刚才看到哪儿了。
   */
  const listResetKey = `${libraryName}|${sortKey}|${sortDir}|${monthFilter}|${marketFilter}|${query.trim().toUpperCase()}`;
  const listResetKeyRef = useRef(listResetKey);
  listResetKeyRef.current = listResetKey;
  // 冻结表带着记下时的口径：口径一变即作废（点表头那一帧就按新评分排，不闪旧顺序）
  const [frozenQuality, setFrozenQuality] = useState<{ key: string; map: ReadonlyMap<string, number | null> }>(
    () => ({ key: '', map: new Map() }),
  );
  // 口径变了就清空：否则切到升序再切回降序，口径又回到记下时那个，旧冻结会「复活」
  useEffect(() => {
    if (frozenQuality.key !== listResetKey && frozenQuality.map.size > 0) setFrozenQuality({ key: listResetKey, map: new Map() });
  }, [frozenQuality, listResetKey]);
  const activeFrozenQuality = frozenQuality.key === listResetKey && frozenQuality.map.size > 0 ? frozenQuality.map : null;
  const sortedFiltered = useMemo(() => {
    if (!signalLibOpen) return EMPTY_SIGNALS;
    const q = query.trim().toUpperCase();
    const basis = !activeFrozenQuality ? signals : signals.map(sig => (
      activeFrozenQuality.has(sig.id) ? { ...sig, quality: activeFrozenQuality.get(sig.id) ?? undefined } : sig
    ));
    const sortedBasis = sortSignalsBy(basis, sortKey, sortDir);
    // 同一个顺序换回真实的信号对象（行里显示新评分，行的身份也不变）
    const real = basis === signals ? null : new Map(signals.map(sig => [sig.id, sig]));
    const base = real ? sortedBasis.map(sig => real.get(sig.id) ?? sig) : sortedBasis;
    const byMonth = monthFilter ? base.filter(s => signalMonthKey(s.timeMs) === monthFilter) : base;
    const byMarket = marketFilter ? byMonth.filter(s => entryPeriodMarketGroup(s.entryPeriod?.market) === marketFilter) : byMonth;
    return q ? byMarket.filter(s => s.symbol.toUpperCase().includes(q)) : byMarket;
  }, [signalLibOpen, signals, query, monthFilter, marketFilter, sortKey, sortDir, activeFrozenQuality]);
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
    if ((!signalLibOpen && !fishOpen) || !user?.id) return;
    let cancelled = false;
    void listAllCampaigns(user.id)
      .then(list => { if (!cancelled) setCampaignDayIndex(buildCampaignDayIndex(list)); })
      // 拉取失败就不标注——这只是辅助信息，绝不能挡住信号库本身的使用
      .catch(() => { if (!cancelled) setCampaignDayIndex(new Set()); });
    return () => { cancelled = true; };
  }, [signalLibOpen, fishOpen, user?.id]);

  const doImport = (text: string) => {
    const { signals: parsed, errors } = parseSignalText(text, turing ? turingCupSymbol : undefined);
    const accepted = turing ? parsed : parsed.filter(signal => !isTuringCupSymbol(signal.symbol));
    setImportErrors(errors);
    if (accepted.length === 0) {
      toast.error('没有可导入的信号', { description: errors[0] ?? '请粘贴「日期时间表头 + 多行标的」或「标的, 时间, 兜底区」' });
      return;
    }
    const merged = mergeSignals(signals, accepted);
    const added = merged.length - signals.length;
    setSignals(merged);
    toast.success(`已导入 ${added} 条信号`, added < accepted.length ? { description: `${accepted.length - added} 条重复已跳过` } : undefined);
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

  const handleEntryPeriodFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length || entryImportPending) return;
    setEntryImportPending(true);
    try {
      const { readEntryPeriodWorkbooks } = await import('@/lib/entryPeriodWorkbook');
      const incoming = await readEntryPeriodWorkbooks(files);
      if (!incoming.length) { toast.error('没有找到标记为「进1」或「进1(逼近)」的记录'); return; }
      const previous = entrySignalsRef.current;
      const merged = mergeEntryPeriodSignals(previous, incoming);
      const added = merged.length - previous.length;
      setEntrySignals(current => mergeEntryPeriodSignals(current, incoming));
      const filled = previous.reduce((count, row, index) => count + Number(row !== merged[index]), 0);
      toast.success('已导入 ' + added + ' 条信号', { description: '库内共 ' + merged.length + ' 条，补齐 ' + filled + ' 条结束时间' });
    } catch (error) {
      toast.error('进场期信号导入失败', { description: (error as Error).message });
    } finally {
      setEntryImportPending(false);
    }
  };

  const handleDeleteSignal = useCallback(
    (id: string) => {
      if (entryPeriod) { setEntrySignals(previous => previous.filter(signal => signal.id !== id)); return; }
      const source = signalsRef.current.find(signal => signal.id === id);
      if (!source) return;
      void (async () => {
        try {
          await fishQuality.deleteSources?.([{ source, entry: null, origin: turing ? 'turing' : 'library' }]);
          setSignals(previous => previous.filter(signal => signal.id !== id));
        } catch (error) {
          toast.error((error as Error).message);
        }
      })();
    },
    [entryPeriod, setEntrySignals, fishQuality.deleteSources, setSignals, turing],
  );
  /**
   * 打分。setSignals 会将这次手动修改落盘，并顺着 saveSignals 推到云端；
   * 云端恢复与首次展示不会回传旧缓存，所以「最新评分覆盖旧的」保持成立，
   * 不需要另开一条保存路径。
   */
  const {ready:qualityRatingsReady,setSourceQuality:saveSourceRating}=fishQuality;
  const {commit:commitFish,signalsRef:fishSourcesRef}=fish;
  const handleRateQualitySource=useCallback((source:TradeSignal,value:number)=>{
    const quality=normalizeSignalQuality(source.quality)===value?undefined:value,key=signalDedupKey(source);
    if(qualityRatingsReady)saveSourceRating?.(source,quality);
    if(fishSourcesRef.current.some(signal=>signalDedupKey(signal)===key))commitFish(setMatchingSourceQuality(fishSourcesRef.current,source,quality));
    if(onlineSignals.some(signal=>signalDedupKey(signal)===key))setOnlineSignals(previous=>setMatchingSourceQuality(previous,source,quality));
    if(turingSignals.some(signal=>signalDedupKey(signal)===key))setTuringSignals(previous=>setMatchingSourceQuality(previous,source,quality));
  },[commitFish,fishSourcesRef,qualityRatingsReady,saveSourceRating,onlineSignals,setOnlineSignals,turingSignals,setTuringSignals]);
  const rateQualitySourceRef = useRef(handleRateQualitySource);
  rateQualitySourceRef.current = handleRateQualitySource;
  const handleRateSignal = useCallback((id: string, next: number) => {
    // 记下打分前的评分：列表按它排、不跳位，直到用户点表头（见 frozenQuality）
    const before = normalizeSignalQuality(signalsRef.current.find(sig => sig.id === id)?.quality) ?? null;
    setFrozenQuality(prev => {
      const key = listResetKeyRef.current;
      const map = prev.key === key ? prev.map : new Map<string, number | null>();
      return map.has(id) ? prev : { key, map: new Map(map).set(id, before) };
    });
    if (entryPeriod) { setEntrySignals(previous => setSignalQuality(previous, id, next)); return; }
    const source = signalsRef.current.find(signal => signal.id === id);
    if (source) rateQualitySourceRef.current(source, next);
  }, [entryPeriod, setEntrySignals]);
  const handleClearSignals = async () => {
    try {
      if (turing && visibleReplaySamples.length) {
        await fishQuality.deleteSources?.(visibleReplaySamples.map(source => ({ source, entry: null, origin: 'turing' })));
      }
      setSignals([]);
      setImportErrors([]);
      toast.message(`${libraryName}已清空`);
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  // 保持每个库的导出可重新导入。
  const handleExportSignals = async () => {
    if (signals.length === 0) return;
    const stamp = formatUTC8(Date.now()).replace(/[^\d]/g, '').slice(0, 12);
    let blob: Blob;
    let fileName: string;
    if (entryPeriod) {
      const { buildXlsx } = await import('@/lib/xlsxWorkbook');
      blob = buildXlsx([{
        name: '数据',
        columns: ['日期', '币种', '进退场周期', '市场', '进场期结束时间', '进场时间来源', '结束时间来源'].map(header => ({ header, width: 20 })),
        rows: signals.map(signal => [
          signal.timeLabel.slice(0, 10), signal.symbol, signal.entryPeriod?.mark,
          signal.entryPeriod ? entryPeriodMarketLabel(signal.entryPeriod.market) : undefined,
          entryPeriodEndLabel(signal.entryPeriod?.endTimeMs),
          signal.entryPeriod?.startInferred ? '倒推' : '原表',
          signal.entryPeriod?.endTimeMs === undefined ? '' : signal.entryPeriod.endInferred ? '倒推' : '原表',
        ]),
      }]);
      fileName = '进场期信号库-' + stamp + '.xlsx';
    } else {
      const text = turing ? signals.map(signal =>
        [turingCupTicker(signal.symbol), formatUTC8(signal.timeMs), signal.fallbackZone].join(', ')
      ).join('\n') + '\n' : serializeSignals(signals);
      blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      fileName = (turing ? 'turing-cup' : 'signal-library') + '-' + (stamp || 'export') + '.txt';
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success(`已导出 ${signals.length} 条信号`);
  };

  // 只吃一个 id：整条信号由 ref 里的最新 signals 取，回调才能恒定。
  const handleJumpSignal = useCallback(async (id: string) => {
    const sig = signalsRef.current.find(item => item.id === id);
    if (!sig || !signalChartSymbol(sig)) return;
    const { onJumpToSignal: jumpTo, onSymbolChange: changeSymbol } = jumpPropsRef.current;
    if (!jumpTo) {
      changeSymbol?.(signalChartSymbol(sig)!);
      // 选定标的即进入下一阶段，信号库没有继续停留的必要——与跳转成功后一致收起
      collapseSignalLibrary();
      return;
    }
    if (pendingJumpRef.current) return;
    const sourceView = signalLibraryView.current;
    const request = { id: sig.id, fromQuality: false };
    pendingJumpRef.current = request;
    setPendingJump(request);
    try {
      const chartSymbol = signalChartSymbol(sig)!;
      const result = await (sig.turingReplaySample
        ? jumpTo(chartSymbol, sig.timeMs, { fromFirstCandle: true })
        : jumpTo(chartSymbol, sig.timeMs));
      if (result.ok) {
        if (sig.turingReplaySample) setDateInput(formatUTC8(sig.timeMs));
        if (sig.jumpIssue) {
          setSignals(prev => prev.map(item =>
            item.id === sig.id ? { ...item, jumpIssue: undefined } : item));
        }
        if (signalLibraryView.current === sourceView) collapseSignalLibrary();
        return;
      }
      const issue = 'fatalIssue' in result ? result.fatalIssue : undefined;
      if (issue) {
        setSignals(prev => prev.map(item =>
          item.id === sig.id ? { ...item, jumpIssue: issue } : item));
      }
    } finally {
      pendingJumpRef.current = null;
      setPendingJump(null);
    }
  }, [collapseSignalLibrary, setSignals]);

  // 手动删除走 fish.remove：记删除记号，别的设备 / 窗口的旧副本合并时不会把它带回来
  const handleDeleteFish = useCallback((id: string) => fish.remove(id), [fish.remove]);
  const handleRateFish = useCallback((id:string,quality:number)=>{const source=fishSourcesRef.current.find(signal=>signal.id===id);if(source)handleRateQualitySource(source,quality);},[fishSourcesRef,handleRateQualitySource]);
  const handleJumpFish = useCallback(async (id: string, qualitySource?: TradeSignal) => {
    const fishSignal = fish.signalsRef.current.find(s => s.id === id);
    const sig = qualitySource ?? fishSignal;
    const chartSymbol = sig && signalChartSymbol(sig);
    if (!sig || !chartSymbol) return;
    const pending = pendingJumpRef.current;
    if (pending && (!qualitySource || !pending.fromQuality || pending.id === id)) return;
    rememberFishPosition();
    const { onJumpToSignal: jumpTo, onSymbolChange: changeSymbol } = jumpPropsRef.current;
    if (!jumpTo) { changeSymbol?.(chartSymbol); setFishOpen(false); return; }
    const request = { id, fromQuality: !!qualitySource };
    pendingJumpRef.current = request;
    setPendingJump(request);
    const updateIssue = (issue: TradeSignal['jumpIssue']) => {
      if (fishSignal) fish.commit(fish.signalsRef.current.map(s => s.id === id ? { ...s, jumpIssue: issue } : s));
      else (isTuringCupSymbol(sig.symbol) ? setTuringSignals : setOnlineSignals)(previous => previous.map(s => s.id === id ? { ...s, jumpIssue: issue } : s));
    };
    try {
      const result = await (sig.turingReplaySample
        ? jumpTo(chartSymbol, sig.timeMs, { fromFirstCandle: true })
        : jumpTo(chartSymbol, sig.timeMs));
      if (pendingJumpRef.current !== request) return;
      if (result.ok) {
        if (sig.turingReplaySample) setDateInput(formatUTC8(sig.timeMs));
        if (sig.jumpIssue) updateIssue(undefined);
        setFishOpen(false);
      } else {
        const issue = 'fatalIssue' in result ? result.fatalIssue : undefined;
        if (issue) updateIssue(issue);
      }
    } finally {
      if (pendingJumpRef.current === request) {
        pendingJumpRef.current = null;
        setPendingJump(null);
      }
    }
  }, [fish.commit, fish.signalsRef, rememberFishPosition, setOnlineSignals, setTuringSignals]);

  // 元素而不是内部组件：TimeControl 每跳一格时钟就重渲染，内部组件会被卸载重建、下拉面板随之关掉
  const speedButtons = <SpeedSelector speed={visualSpeed} onSelect={s => { setVisualSpeed(s); onSetSpeed(s); }} />;

  const paused = status === 'paused';
  const timeDisplay = (
    <div className="ml-auto flex items-center gap-3 whitespace-nowrap">
      {originTime != null && (
        // 【用户要求】2026-10-19 这一行要放得下：启始只写「月-日 时:分」，悬停看完整时间
        // 窄屏（< 1280px）不显示，悬停当前时间可以看到
        <span className="hidden xl:flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground" title={`启始 ${formatUTC8(originTime)}`}>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted font-medium tracking-wide">启始</span>
          {formatUTC8(originTime).slice(5, 16)}
        </span>
      )}
      <span className={`font-mono text-sm font-medium ${paused ? 'text-yellow-400 animate-pulse' : 'text-primary'}`} title={originTime != null ? `启始 ${formatUTC8(originTime)}` : undefined}>
        {paused && '⏸ '}
        <span ref={clockRef}>{formatUTC8(currentSimulatedTime)}</span>
      </span>
    </div>
  );

  return (
    <div className="panel px-4 py-3 bg-card">
      <div className="flex items-center gap-x-2.5 gap-y-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide whitespace-nowrap">Time Machine</span>
        </div>

        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button type="button" ref={signalMenuButtonRef}
              onKeyDown={signalLibOpen ? closeSignalLibraryOnEscape : undefined}
              className={`group flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] font-medium transition-colors ${
                signalLibOpen ? 'border-primary/40 bg-primary/15 text-primary' : 'border-border/60 text-muted-foreground hover:text-foreground hover:bg-accent'
              }`}>
              <Database className="w-3 h-3" />信号库
              <ChevronDown className="w-3 h-3 transition-transform group-data-[state=open]:rotate-180" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-36 !animate-none">
            {libraryMenu.map(({ kind, count, title }) => (
              <DropdownMenuCheckboxItem key={kind} checked={signalLibOpen && library === kind}
                onSelect={() => toggleLibrary(kind)} title={title} className="cursor-pointer gap-3 text-xs">
                {SIGNAL_LIBRARY_NAMES[kind]}
                {count > 0 && <span aria-hidden="true" className="ml-auto rounded-full bg-primary/15 px-1.5 font-mono text-[10px] text-primary">{count}</span>}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <button type="button" aria-expanded={fishOpen} onClick={() => { collapseSignalLibrary(); if(!fishOpen)armQualityReturn(Date.now(),fishQuality.account); else setWorkspaceTuringOpen(false); setFishOpen(o => !o); }}
          className={`flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] font-medium transition-colors ${fishOpen ? 'border-primary/40 bg-primary/15 text-primary' : 'border-border/60 text-muted-foreground hover:text-foreground hover:bg-accent'}`}>
          <Fish className="w-3 h-3" />渔
          <ChevronDown className={`w-3 h-3 transition-transform ${fishOpen ? 'rotate-180' : ''}`} />
        </button>

        {status === 'stopped' && (
          <ReplayStartControls dateInput={dateInput} onStart={onStart} onChange={value => {
            replayDateEdited.current = true;
            setDateInput(value);
          }}/>
        )}

        {status === 'playing' && (
          <>
            <div className="flex items-center gap-2">
              <button onClick={onPause} className="flex h-7 items-center gap-1 text-xs px-2 rounded bg-yellow-500/20 whitespace-nowrap text-yellow-400 hover:bg-yellow-500/30 transition-all duration-100 ease-out active:scale-[0.97] font-medium">
                <Pause className="w-3.5 h-3.5" /> 暂停
              </button>
              <button onClick={onStop} className="flex h-7 items-center gap-1 text-xs px-2 rounded bg-destructive/20 whitespace-nowrap text-destructive hover:bg-destructive/30 transition-all duration-100 ease-out active:scale-[0.97] font-medium">
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
            {speedButtons}
            {timeDisplay}
          </>
        )}

        {status === 'paused' && (
          <>
            <div className="flex items-center gap-2">
              <button onClick={onResume} className="btn-long flex h-7 items-center gap-1 !px-2 text-xs whitespace-nowrap active:scale-[0.97]">
                <Play className="w-3.5 h-3.5" /> 继续
              </button>
              <button onClick={onStop} className="flex h-7 items-center gap-1 text-xs px-2 rounded bg-destructive/20 whitespace-nowrap text-destructive hover:bg-destructive/30 transition-all duration-100 ease-out active:scale-[0.97] font-medium">
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
            {speedButtons}
            {timeDisplay}
          </>
        )}
      </div>

      <div ref={fishHostRef} data-testid="fish-viewport" className={fishOpen?'relative z-30 flex min-h-0 flex-col bg-card':undefined} style={{height:fishHeight}}>{fishOpen && <ModuleErrorBoundary label="渔" backgroundTasks><FishBulkDeletionProvider state={fishQuality} removeFish={fish.removeMany}><FishPanel fillHeight quality={panelQuality} mining={fishMining} defaultAlgorithms={FISH_DEFAULT_ALGORITHMS} hasRound={fish.hasRound} roundPlans={fish.roundPlans} onRecombine={fish.recombine} onLiveCombination={fish.switchLive} onCardsChange={onlineReconstruction.onCardsChange} reconstructionRunning={onlineReconstruction.running} librarySignals={onlineSignals} onSuggest={fish.suggest} signals={fish.signals} progress={fish.progress} inputs={fishInputs} onInputsChange={setFishInputs} selection={fishSelection} onSelectionChange={setFishSelection} onStart={settings => { fishAuto.noteManualRun(); void fish.start(settings, status === 'stopped'); }} auto={fishAuto} notify={fishNotify} onCancel={fish.cancel}
        onJump={handleJumpFish} onJumpQuality={source => void handleJumpFish(source.id, source)} onRateQuality={handleRateQualitySource} onImportCabin={fish.importCabin} onDelete={handleDeleteFish} onRate={handleRateFish} jumpingSignalId={jumpingSignalId} qualityJumpPending={pendingJump?.fromQuality} tradedDayIndex={tradedDayIndex} campaignDayIndex={campaignDayIndex} /></FishBulkDeletionProvider></ModuleErrorBoundary>}</div>

      {/* 信号库折叠面板 */}
      {signalLibOpen && (
        <div key={libraryName} data-testid={entryPeriod ? 'entry-period-signal-library-panel' : turing ? 'turing-cup-panel' : 'signal-library-panel'} className="mt-2 border-t border-border/60 pt-2" onKeyDown={closeSignalLibraryOnEscape}>

          {/* 统一工具条：筛选 + 导入 / 导出 / 预检。
              原先「只放两个 12px 图标」的独立一行已并入这里——横向本来就过剩，
              纵向才是稀缺的，这是把过剩的横向兑换成纵向的一次交易。 */}
          <div>
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              <h2 className="mr-1 whitespace-nowrap text-xs font-medium">{libraryName}</h2>
              {monthOptions.length > 0 && (
                <select
                  value={monthFilter}
                  onChange={e => selectMonth(e.target.value)}
                  title="按月份定位信号（选中某个月会自动按时间旧→新排列）"
                  className="input-dark h-[22px] shrink-0 px-1.5 py-0.5 font-mono text-[11px]"
                >
                  <option value="">全部月份（{signals.length}）</option>
                  {monthOptions.map(({ month, count }) => (
                    <option key={month} value={month}>{month}（{count}）</option>
                  ))}
                </select>
              )}
              {entryPeriod && <select
                aria-label="筛选市场" value={marketFilter}
                onChange={e => setMarketFilter(e.target.value as EntryPeriodMarket | '')}
                className="input-dark h-[22px] shrink-0 px-1.5 py-0.5 text-[11px]"
              >
                <option value="">全部市场</option>
                {Object.entries(ENTRY_PERIOD_MARKETS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>}
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="筛选标的…"
                className="input-dark min-w-[7rem] flex-1 px-1.5 py-0.5 text-[11px] leading-4"
              />
              <button
                onClick={() => setImportOpen(o => !o)}
                disabled={entryNeedsSync}
                aria-label={entryPeriod ? '导入进场期 Excel' : undefined}
                title={entryPeriod ? '导入进场期 Excel' : importOpen ? '收起上传 / 粘贴信号' : '上传 / 粘贴信号'}
                className={`flex h-[22px] shrink-0 items-center gap-0.5 rounded px-1.5 transition-colors disabled:opacity-50 ${
                  importOpen ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                <Upload className="h-3 w-3" />
                <ChevronDown className={`h-2.5 w-2.5 transition-transform ${importOpen ? 'rotate-180' : ''}`} />
              </button>
              {signals.length > 0 && (
                <button
                  onClick={handleExportSignals}
                  aria-label={entryPeriod ? '导出进场期信号（Excel）' : undefined}
                  title={entryPeriod ? '导出进场期信号（Excel）' : `导出${libraryName}为 txt（与导入互逆，可原样再导入）`}
                  className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Download className="h-3 w-3" />
                </button>
              )}
              {!entryPeriod && signals.length > 0 && (
                <SignalTurnoverButton turing={turing} signals={signals} run={fish.turnover} busyReason={fish.progress?.status === 'running' || reconstructionRunning.current ? '捕捞或复原进行中，结束后再统计' : undefined} />
              )}
              {turing && user && <TuringCupReplayPanel key={user.id} accountId={user.id} source={turingArchive} />}
              {!entryPeriod && signalAuditProgress && (
                <span
                  className="flex shrink-0 items-center gap-1 font-mono text-[10px] leading-4 text-muted-foreground/70"
                  title="正在后台预检无法跳转的信号；不影响正常点击"
                  aria-live="polite"
                >
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  预检 {signalAuditProgress.checked}/{signalAuditProgress.total}
                </span>
              )}
              {turing && !signalAuditProgress && turingCoverageWarning && (
                <span className="text-[10px] text-muted-foreground">部分信号缺少当前周期的离线 K 线</span>
              )}
              <button type="button" aria-label={`收起${libraryName}`} title={`收起${libraryName}`}
                onClick={closeSignalLibrary}
                className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
          {importOpen && !entryNeedsSync && (entryPeriod ? (
            <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
              <label className="flex items-center gap-1 rounded border border-border/60 px-2 py-1 hover:bg-accent focus-within:ring-1 focus-within:ring-ring">
                <Upload className="h-3 w-3" />
                {entryImportPending ? '正在读取 Excel…' : '上传 Excel'}
                <input type="file" aria-label="上传进场期 Excel" accept=".xlsx" multiple disabled={entryImportPending}
                  onChange={handleEntryPeriodFiles} className="sr-only" />
              </label>
              <span>可多选连续原表 · 按周期序号补齐缺失首日 · 北京时间 16:00</span>
              {signals.length > 0 && <button type="button" disabled={entryImportPending}
                className="ml-auto rounded px-2 py-1 text-destructive hover:bg-destructive/10" onClick={handleClearSignals}>清空</button>}
            </div>
          ) : (
            <div className="mb-1.5">
            <div className="mb-1.5 text-[10px] text-muted-foreground">
              上传 / 粘贴信号 · 支持「<span className="font-mono text-foreground">日期时间表头 + 多行标的</span>」或「<span className="font-mono text-foreground">标的, 时间, 兜底区</span>」· 时间按 UTC+8 · {turing ? '标的需与离线行情一致' : '标的自动补 USDT'}
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
            ))}

            {entryNeedsSync ? (
              <div className="flex items-center justify-center gap-2 rounded border border-dashed border-border/60 px-3 py-4 text-[11px] text-muted-foreground">
                <span role="status">{entrySyncStatus === 'loading' ? '正在同步进场期信号…' : '暂时无法读取进场期信号'}</span>
                {entrySyncStatus === 'error' && <button type="button"
                  className="rounded border border-border/60 px-2 py-1 text-foreground hover:bg-accent"
                  onClick={() => {
                    setEntrySyncStatus('loading');
                    setEntrySyncAttempt(attempt => attempt + 1);
                  }}>重新同步</button>}
              </div>
            ) : sortedFiltered.length === 0 ? (
              <div className="rounded border border-dashed border-border/60 px-3 py-4 text-center text-[10px] text-muted-foreground">
                {signals.length === 0
                  ? entryPeriod ? '暂无进场期信号。上传 Excel 即可导入。' : turing ? '图灵杯暂无信号。导入行情文件后，回放样本会出现在这里，也可以上传或粘贴信号。' : '还没有信号。上传或粘贴「标的 + 时间 + 兜底区」后，这里会列出（可按标的或时间排序），点开即可越过手动输入、直接跳转盘面。'
                  : '没有匹配的标的。'}
              </div>
            ) : (
              <div className="space-y-1">
                {!entryPeriod && <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                  <label className="inline-flex items-center gap-1">匹配<select aria-label="匹配门槛" className="rounded border border-border/50 bg-background px-1 py-0.5" value={reconstruction.mode} onChange={e=>reconstruction.setMode(e.target.value as 'best'|'current')}><option value="best">最佳门槛</option><option value="current">各卡当前阈值</option></select></label>
                  {/* 【用户要求】2026-10-19「匹配之后为何还是这样」：「匹配」下拉只选显示哪种门槛，不会计算；
                      复原入口原先只在「渔」里，这里直接给出——没跑过 / 已过期时点「复原」，进度与不能运行的原因写在同一行 */}
                  {reconstruction.running
                    ? <span role="status" data-testid="library-reconstruction-progress">复原中 · {reconstruction.progress?.phase==='thresholds'?'门槛评估':'历史取数'} {reconstruction.progress?.done??0} / {reconstruction.progress?.total??0}<button type="button" className="ml-1.5 hover:text-foreground" onClick={reconstruction.cancel}>取消</button></span>
                    : (!reconstruction.result||reconstruction.stale)&&<>
                      <span>{reconstruction.stale?'已过期':'尚未复原'}</span>
                      <button type="button" data-testid="library-reconstruction-start" className="rounded border border-border/50 px-1.5 py-0.5 text-foreground/80 hover:bg-accent disabled:opacity-40" disabled={!reconstruction.available||!!reconstruction.settingsError||fish.progress?.status==='running'} title={reconstruction.settingsError||'用每条信号发生前的数据，评估「渔」里各算法卡的捕获率、噪音与最佳门槛；只保存在本机'} onClick={()=>void reconstruction.start()}>复原</button>
                      {reconstruction.settingsError&&<span className="text-destructive/80">{reconstruction.settingsError}（在「渔」里改）</span>}
                    </>}
                  {reconstruction.error&&!reconstruction.running&&<span className="text-destructive/80">{reconstruction.error}</span>}
                </div>}
                <div className="overflow-x-auto rounded border border-border/60"><div className="min-w-[900px]">
                {/* 表头：与行共用同一套列宽，四列各有名分，不再靠位置猜 */}
                <SignalLibraryHeader showMatch={!entryPeriod} showEntryPeriod={entryPeriod} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                {/* 列表整块 memo 化 + 窗口化：它既不该跟着时钟重渲染，
                    也不该为了 791 条信号一次铺出两万多个节点。 */}
                <SignalLibraryList
                  matches={entryPeriod ? undefined : signalMatches}
                  rows={sortedFiltered}
                  tradedDayIndex={tradedDayIndex}
                  campaignDayIndex={campaignDayIndex}
                  jumpingSignalId={jumpingSignalId}
                  resetKey={listResetKey}
                  onJump={handleJumpSignal}
                  onDelete={handleDeleteSignal}
                  onRate={handleRateSignal}
                />
              </div></div></div>
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
        timelineId={noEntryTimelineId}
        lockedEntryPrice={ctx.priceMap[noEntrySymbol] ?? null}
        leverage={1}
        marginMode="isolated"
        pricePrecision={2}
      />
    </div>
  );
}
