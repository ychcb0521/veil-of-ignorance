/**
 * P_gap —— 优势边际仪表（独立模块）。
 *
 * 只做一件事：把「主观胜率 P」减去「市场免费给的基线胜率 P₀」的差额实时显示出来。
 * S 随行情跳动，K / T / P 由用户拖动；任一输入变动立即重算。读数即全部功能：
 * 不落库、不记历史、不做校准统计、不给仓位建议。
 */
import { useEffect, useMemo, useRef } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { computeAdvantageGap, computeBankableRatio } from '@/lib/advantageGap';
import { BreakEvenCurve } from '@/components/BreakEvenCurve';

interface Props {
  /** 现价 S，来自盘面实时数据，只读。 */
  currentPrice: number;
  pricePrecision: number;
  /** 默认完整显示；折叠后只留表头与一行读数。 */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onClose?: () => void;
  /** 该账号交易战役的整体胜率（0–100），作为 P 的默认值；样本不足时为 null。 */
  defaultWinRatePct?: number | null;
  /** 已了结战役数，用于标注默认值的样本量。 */
  winRateSampleCount?: number;
  /** 当前该标的多单的按数量加权平均开仓价；无多单时为 null。 */
  longEntryPrice?: number | null;
  /** 当前多单笔数，用于标注这个均价来自几笔。 */
  longPositionCount?: number;
  /** 该多单最早设定的止损价（风险锚 K₀），b_可落袋 的默认分母；无可追溯止损时为 null。 */
  longRiskAnchorPrice?: number | null;
  /** 当前标的；切换标的时清掉手动改过的 K₀。 */
  symbol?: string;
}

/** P_gap 的手填量按标的存档，刷新页面不丢；键名带版本以便将来结构变更时平滑失效。 */
const P_GAP_DRAFT_KEY = 'p_gap_draft_v1';

interface PGapDraft {
  stopLoss: number | null;
  target: number | null;
  survivalPct: number | null;
  breakoutPct: number | null;
  manualRiskK: number | null;
  /** 优势条满格基准——锚定 P 那一刻的 gap。 */
  anchorGap: number | null;
}

const EMPTY_DRAFT: PGapDraft = {
  stopLoss: null, target: null, survivalPct: null, breakoutPct: null,
  manualRiskK: null, anchorGap: null,
};

/** 滑块围绕现价展开的半幅：±12% 足够覆盖常规止损/目标，又不至于精度过粗。 */
const SLIDER_SPAN = 0.12;

const GREEN = '#0ECB81';
const RED = '#F6465D';
const YELLOW = '#FCD535';

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function formatSignedPercent(fraction: number, digits = 1) {
  const percent = fraction * 100;
  const normalized = Math.abs(percent) < 0.05 ? 0 : percent;
  return `${normalized > 0 ? '+' : ''}${normalized.toFixed(digits)}%`;
}

type FieldProps = {
  id: string;
  symbol: string;
  label: string;
  accent: string;
  value: number | null;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  suffix?: string;
  placeholder?: string;
  onChange: (next: number | null) => void;
  onCommit?: () => void;
};

/**
 * 单行输入行。用固定三栏栅格而不是 flex 自由排布——K/T/P₁/P₂ 四行的
 * 符号、滑块、数字框因此严格竖向对齐，这是整块面板秩序感的来源。
 * 标签列宽度随容器伸缩但有下限，避免「结构存活」被截成「结构…」。
 */
function GapField({
  id, symbol, label, accent, value, min, max, step,
  disabled = false, suffix, placeholder = '—', onChange, onCommit,
}: FieldProps) {
  return (
    <div
      className="grid h-[32px] items-center gap-2 px-3"
      style={{ gridTemplateColumns: 'clamp(58px,24cqw,76px) minmax(0,1fr) clamp(56px,26cqw,74px)' }}
    >
      <label htmlFor={`p-gap-${id}-number`} className="flex min-w-0 items-center gap-1 select-none">
        <span
          className="w-[14px] flex-none font-mono text-[11px] font-semibold leading-none"
          style={{ color: accent }}
        >
          {symbol}
        </span>
        <span
          title={label}
          className="min-w-0 truncate whitespace-nowrap text-[9px] leading-none text-gray-500 dark:text-[#848e9c]"
        >
          {label}
        </span>
      </label>
      <input
        data-testid={`p-gap-${id}-slider`}
        type="range"
        aria-label={`${label} 滑块`}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={value == null ? min : clamp(value, min, max)}
        onChange={event => onChange(Number.parseFloat(event.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        style={{ accentColor: accent }}
        className="h-[3px] w-full cursor-pointer appearance-none rounded-full bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-[#2b3139]"
      />
      {/* 单位内嵌进输入框，右缘因此与上下各行严格对齐 */}
      <div className="relative">
        <input
          id={`p-gap-${id}-number`}
          data-testid={`p-gap-${id}-number`}
          type="number"
          inputMode="decimal"
          step={step}
          min={min}
          max={max}
          disabled={disabled}
          placeholder={placeholder}
          value={value == null ? '' : value}
          onChange={event => {
            const next = Number.parseFloat(event.target.value);
            onChange(Number.isFinite(next) ? next : null);
          }}
          onBlur={onCommit}
          className={`h-[22px] w-full rounded border border-gray-200 bg-gray-50 py-0 text-right font-mono text-[10px] tabular-nums text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-[#fcd535] focus:bg-white disabled:opacity-40 dark:border-[#2b3139] dark:bg-[#161a1e] dark:text-[#EAECEF] dark:placeholder:text-[#5e6673] dark:focus:bg-[#12161a] ${suffix ? 'pl-1 pr-[14px]' : 'px-1.5'}`}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-1 flex items-center text-[9px] leading-none text-gray-400 dark:text-[#5e6673]">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

export function PGapPanel({
  currentPrice,
  pricePrecision,
  collapsed = false,
  onToggleCollapsed,
  onClose,
  defaultWinRatePct = null,
  winRateSampleCount = 0,
  longEntryPrice = null,
  longPositionCount = 0,
  longRiskAnchorPrice = null,
  symbol = '',
}: Props) {
  const hasPrice = Number.isFinite(currentPrice) && currentPrice > 0;

  // 五个手填量按标的存档，刷新页面后同一标的原样恢复；换标的各存各的、互不串味。
  // K / T 用现价两侧的对称括号作起手，滑块才有落点；P₁ / P₂ / K₀ 严格无默认值。
  const [draftBySymbol, setDraftBySymbol] = usePersistedState<Record<string, PGapDraft>>(
    P_GAP_DRAFT_KEY,
    {},
  );
  const draft = draftBySymbol[symbol] ?? EMPTY_DRAFT;
  const patchDraft = (patch: Partial<PGapDraft>) => {
    setDraftBySymbol(prev => ({
      ...prev,
      [symbol]: { ...(prev[symbol] ?? EMPTY_DRAFT), ...patch },
    }));
  };

  const stopLoss = draft.stopLoss;
  const target = draft.target;
  const survivalPct = draft.survivalPct;
  const breakoutPct = draft.breakoutPct;
  const setStopLoss = (v: number | null) => patchDraft({ stopLoss: v });
  const setTarget = (v: number | null) => patchDraft({ target: v });
  const setSurvivalPct = (v: number | null) => patchDraft({ survivalPct: v });
  const setBreakoutPct = (v: number | null) => patchDraft({ breakoutPct: v });

  // 只在该标的尚无存档时落起手值——已有存档（含刷新后恢复的）绝不覆盖。
  useEffect(() => {
    if (!hasPrice) return;
    if (draft.stopLoss != null || draft.target != null) return;
    patchDraft({
      stopLoss: Number((currentPrice * 0.98).toFixed(pricePrecision)),
      target: Number((currentPrice * 1.02).toFixed(pricePrecision)),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, hasPrice]);

  // 最终主观概率 P（%）= 结构存活概率 × 存活后突破 T 的条件概率。
  // 只读、实时；任一项缺失即为 null——不臆造。战役整体胜率只作参考展示，不再落种。
  const winRatePct = useMemo(() => {
    if (survivalPct == null || breakoutPct == null) return null;
    return (survivalPct / 100) * (breakoutPct / 100) * 100;
  }, [survivalPct, breakoutPct]);

  const result = useMemo(
    () => computeAdvantageGap(
      hasPrice ? currentPrice : null,
      stopLoss,
      target,
      winRatePct == null ? null : winRatePct / 100,
    ),
    [currentPrice, hasPrice, stopLoss, target, winRatePct],
  );

  // 满格 = 锚定 P 那一刻的 gap；随后 S 推高基线，条向零收缩，
  // 直观展示优势被价格吃掉的过程。P 或 K/T 改动即重新锚定。
  const anchorGap = draft.anchorGap;
  const reanchor = () => {
    patchDraft({ anchorGap: result.valid && result.gap != null && result.gap > 0 ? result.gap : null });
  };

  const sliderBounds = useMemo(() => {
    if (!hasPrice) return { min: 0, max: 1, step: 1 };
    const min = currentPrice * (1 - SLIDER_SPAN);
    const max = currentPrice * (1 + SLIDER_SPAN);
    return { min, max, step: Math.max((max - min) / 400, 10 ** -pricePrecision) };
  }, [currentPrice, hasPrice, pricePrecision]);

  // b_可落袋 的分母锚 K₀：手动值 > 该多单最早设定的止损（预期最大亏损所在位）> 面板情景 K。
  // 面板上的 K 滑条是拿来做情景推演的，随手一拖不该改写「入场时承担的风险」，
  // 所以可落袋的分母必须有自己的锚，只在无锚可用时才退回情景 K。
  const manualRiskK = draft.manualRiskK;
  const setManualRiskK = (v: number | null) => patchDraft({ manualRiskK: v });
  const effectiveRiskK = manualRiskK ?? longRiskAnchorPrice ?? stopLoss;

  // 可落袋 R：只看已持有的多单（现价 vs 开仓价，以 K₀ 度量的每 R 为单位），与目标 T 无关
  const bankable = useMemo(
    () => computeBankableRatio(hasPrice ? currentPrice : null, longEntryPrice, effectiveRiskK),
    [currentPrice, hasPrice, longEntryPrice, effectiveRiskK],
  );

  const gap = result.valid ? result.gap : null;
  const positive = gap != null && gap > 0;
  const remainingFraction = anchorGap != null && anchorGap > 0 && gap != null
    ? clamp(gap / anchorGap, 0, 1)
    : positive ? 1 : 0;

  const invalidMessage = result.valid
    ? null
    : result.reason === 'incomplete'
      ? hasPrice ? '请填写止损 K 与目标 T' : '等待行情数据…'
      : result.reason === 'degenerate'
        ? '目标 T 与止损 K 相同，基线概率无意义'
        : '方向不成立：多头需 K < S < T，空头需 T < S < K';

  return (
    <div
      data-testid="p-gap-panel"
      data-collapsed={collapsed ? 'true' : 'false'}
      className="flex h-full min-h-0 flex-col overflow-hidden bg-white dark:bg-[#1e2329] select-none [container-type:inline-size]"
    >
      {/* 模块表头 */}
      <div className="group flex-none flex items-center justify-between gap-2 pl-3 pr-2 h-9 border-b border-gray-200 dark:border-[#2b3139]">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="relative flex h-full items-center whitespace-nowrap font-mono text-[12px] font-semibold text-gray-900 dark:text-[#EAECEF]">
            P_gap
          </span>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                data-testid="p-gap-help"
                aria-label="P_gap 使用说明"
                title="使用说明"
                className="flex h-4 w-4 flex-none items-center justify-center rounded-full text-gray-500 opacity-25 transition-opacity hover:opacity-100 group-hover:opacity-60 dark:text-[#848e9c]"
              >
                <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
                  <circle cx="8" cy="8" r="6.4" />
                  <path d="M6.3 6.1a1.8 1.8 0 1 1 2.4 1.7c-.5.2-.8.6-.8 1.1v.4" strokeLinecap="round" />
                  <circle cx="8" cy="11.6" r="0.7" fill="currentColor" stroke="none" />
                </svg>
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              side="bottom"
              collisionPadding={12}
              data-testid="p-gap-help-content"
              className="flex max-h-[var(--radix-popover-content-available-height)] w-[300px] flex-col overflow-y-auto overscroll-contain border-gray-200 bg-white p-3 text-[11px] leading-relaxed dark:border-[#2b3139] dark:bg-[#1e2329]"
            >
              <div className="font-medium text-gray-900 dark:text-[#EAECEF]">P_gap · 优势边际</div>
              <p className="mt-1 text-gray-500 dark:text-[#848e9c]">
                这是一块仪表，只回答一个问题：你自认的胜率，比市场白送的那份高出多少。
              </p>

              <div className="mt-2.5 rounded bg-gray-50 px-2 py-1.5 font-mono text-[10px] text-gray-900 dark:bg-[#161a1e] dark:text-[#EAECEF]">
                P₀ = |S − K| ÷ |T − K|<br />
                P&nbsp;&nbsp;= P₁ × P₂<br />
                gap = P − P₀
              </div>

              <dl className="mt-2.5 space-y-1.5 text-gray-500 dark:text-[#848e9c]">
                <div>
                  <dt className="inline font-mono font-semibold" style={{ color: YELLOW }}>S</dt>
                  <dd className="inline"> · 现价，随行情实时跳动，只读。</dd>
                </div>
                <div>
                  <dt className="inline font-mono font-semibold" style={{ color: RED }}>K</dt>
                  <dd className="inline"> · 止损价，你打算认错的位置。</dd>
                </div>
                <div>
                  <dt className="inline font-mono font-semibold" style={{ color: GREEN }}>T</dt>
                  <dd className="inline"> · 目标价，你打算兑现的位置。</dd>
                </div>
                <div>
                  <dt className="inline font-mono font-semibold" style={{ color: YELLOW }}>P₁</dt>
                  <dd className="inline"> · 结构存活概率：当前交易结构继续存活、不被证伪的概率。由你自己填写。</dd>
                </div>
                <div>
                  <dt className="inline font-mono font-semibold" style={{ color: YELLOW }}>P₂</dt>
                  <dd className="inline"> · 存活后突破 T 的概率，是<strong>条件概率</strong>——先假定结构成立，再问价格走到 T 的把握；<strong>不是</strong>独立的「突破 T 概率」，否则结构风险会被重复计价。由你自己填写。</dd>
                </div>
                <div>
                  <dt className="inline font-mono font-semibold" style={{ color: YELLOW }}>P</dt>
                  <dd className="inline"> · 最终主观胜率 = P₁ × P₂（链式法则），<strong>自动计算、只读</strong>，任一项变化即实时重算；任一项缺失则不出数。面板底部的战役整体胜率仅作参考对照，不会自动填入。</dd>
                </div>
                <div>
                  <dt className="inline font-mono font-semibold text-gray-700 dark:text-[#B7BDC6]">b</dt>
                  <dd className="inline"> · 动态赔率 =（T − S）÷（S − K），此刻的盈亏比。P₀ 恒等于 1 ÷ (1 + b)；点 b 可打开盈亏平衡胜率曲线。</dd>
                </div>
                <div>
                  <dt className="inline font-semibold text-gray-700 dark:text-[#B7BDC6]">P₀ 基线概率</dt>
                  <dd className="inline"> · 在没有任何优势的市场里，价格先摸到 T 而不是先摸到 K 的概率。止损放得越远、目标定得越近，它越高——这是市场免费给你的胜率。</dd>
                </div>
                <div>
                  <dt className="inline font-semibold text-gray-700 dark:text-[#B7BDC6]">gap 优势边际</dt>
                  <dd className="inline"> · P 高出基线的部分，才真正属于你。<span style={{ color: GREEN }}>正数为绿</span>；<span style={{ color: RED }}>≤ 0 转红并显示「优势已耗尽」</span>，意味着这笔已不值得下手。gap 只做「P 对 P₀」的纯几何对比，不与持仓成本价比较——持仓的盈亏状态请看 b 可落袋。</dd>
                </div>
                <div>
                  <dt className="inline font-semibold text-gray-700 dark:text-[#B7BDC6]">优势条</dt>
                  <dd className="inline"> · 满格为你锚定 P 那一刻的 gap。价格越往 T 走，P₀ 越高，条就越短——把优势被价格吃掉的过程直接画出来。</dd>
                </div>
              </dl>

              <p className="mt-2.5 border-t border-gray-100 pt-2 text-gray-400 dark:border-[#2b3139] dark:text-[#5e6673]">
                方向由 S、K、T 的相对位置自动判定：多头 K &lt; S &lt; T，空头 T &lt; S &lt; K。两者都不成立或 T = K 时不出数字，只出提示。
                本面板只读不写：不落库、不记历史、不做校准统计、不给仓位建议。
              </p>
            </PopoverContent>
          </Popover>
          {collapsed && gap != null ? (
            // 折叠后表头即读数：仪表不该因为收起就什么都不说。
            <span
              data-testid="p-gap-collapsed-value"
              className="truncate font-mono text-[11px] font-semibold tabular-nums"
              style={{ color: positive ? GREEN : RED }}
            >
              {positive ? formatSignedPercent(gap) : '优势已耗尽'}
            </span>
          ) : (
            <span className="truncate text-[10px] text-gray-500 dark:text-[#848e9c]">优势边际</span>
          )}
        </div>
        <div className="flex flex-none items-center gap-1">
          {onToggleCollapsed && (
            <button
              type="button"
              data-testid="p-gap-collapse-toggle"
              aria-expanded={!collapsed}
              title={collapsed ? '展开 P_gap' : '折叠 P_gap'}
              onClick={onToggleCollapsed}
              className="flex h-6 w-6 items-center justify-center rounded text-gray-500 opacity-30 transition-all hover:bg-gray-100 hover:text-gray-900 hover:opacity-100 group-hover:opacity-70 dark:text-[#848e9c] dark:hover:bg-[#2b3139] dark:hover:text-white"
            >
              <svg
                className={`h-3 w-3 transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`}
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M2 4.5l4 4 4-4" />
              </svg>
            </button>
          )}
          {onClose && (
            <button
              type="button"
              title="关闭 P_gap"
              onClick={onClose}
              className="flex h-6 w-6 items-center justify-center rounded text-gray-500 opacity-0 transition-all group-hover:opacity-100 hover:bg-gray-100 hover:text-gray-900 dark:text-[#848e9c] dark:hover:bg-[#2b3139] dark:hover:text-white"
            >
              <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M3 3l6 6M9 3l-6 6" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {!collapsed && (
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-[#2b3139] scrollbar-track-transparent">
        {/* 读数区 —— 模块的主角 */}
        <div className="px-3 pt-2 pb-2.5 border-b border-gray-200 dark:border-[#2b3139]">
          {result.valid ? (
            <>
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-[10px] leading-none text-gray-500 dark:text-[#848e9c]">
                  基线概率 P<sub className="text-[8px]">0</sub>
                </span>
                <span
                  data-testid="p-gap-baseline"
                  className="flex-none font-mono text-[clamp(14px,6.5cqw,19px)] font-semibold leading-none tabular-nums text-gray-900 dark:text-[#EAECEF]"
                >
                  {(result.baseline * 100).toFixed(1)}%
                </span>
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span className="text-[9px] leading-none text-gray-400 dark:text-[#5e6673]">
                  市场免费给你的胜率，P 必须高于它
                </span>
                {/* 动态赔率 b：低调入口，点开是盈亏平衡胜率曲线 */}
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      data-testid="p-gap-payoff-ratio"
                      title="动态赔率 b =（T − S）÷（S − K）· 点击查看盈亏平衡胜率曲线"
                      className="flex-none border-b border-dashed border-gray-300 font-mono text-[9px] leading-none text-gray-400 opacity-60 transition-opacity hover:opacity-100 dark:border-[#2b3139] dark:text-[#5e6673]"
                    >
                      b {result.payoffRatio.toFixed(2)}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    side="bottom"
                    collisionPadding={12}
                    data-testid="p-gap-payoff-chart"
                    className="flex max-h-[var(--radix-popover-content-available-height)] w-[320px] flex-col overflow-y-auto overscroll-contain border-gray-200 bg-white p-3 dark:border-[#2b3139] dark:bg-[#1e2329]"
                  >
                    <div className="text-[11px] font-medium text-gray-900 dark:text-[#EAECEF]">盈亏平衡胜率</div>
                    <div className="mt-0.5 font-mono text-[9px] text-gray-500 dark:text-[#848e9c]">
                      P = 1 ÷ (1 + b)　·　b = (T − S) ÷ (S − K)
                    </div>
                    <div className="mt-2">
                      <BreakEvenCurve
                        currentPayoffRatio={result.payoffRatio}
                        winRate={winRatePct == null ? null : winRatePct / 100}
                      />
                    </div>
                    <p className="mt-2 border-t border-gray-100 pt-2 text-[9px] leading-relaxed text-gray-500 dark:border-[#2b3139] dark:text-[#848e9c]">
                      曲线随赔率增大急速下降：b 从 1 到 2，门槛就从 50% 掉到 33%——把目标放远、止损收紧，比硬提胜率省力得多。
                      当前赔率对应的门槛恒等于上方的基线概率 P₀，两者本就是同一个数的两种算法。
                    </p>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 dark:border-[#2b3139] dark:bg-[#161a1e]">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[10px] leading-none text-gray-500 dark:text-[#848e9c]">优势边际 gap</span>
                  {gap == null ? (
                    <span data-testid="p-gap-value" className="font-mono text-[11px] text-gray-400 dark:text-[#5e6673]">
                      请填写 P₁ 与 P₂
                    </span>
                  ) : (
                    <span
                      data-testid="p-gap-value"
                      data-gap-sign={positive ? 'positive' : 'non-positive'}
                      className="font-mono text-[clamp(12px,5.5cqw,16px)] font-semibold leading-none tabular-nums"
                      style={{ color: positive ? GREEN : RED }}
                    >
                      {positive ? formatSignedPercent(gap) : '优势已耗尽'}
                    </span>
                  )}
                </div>

                {/* 优势条：满格为锚定时的 gap，随基线抬高向零收缩 */}
                <div
                  data-testid="p-gap-bar"
                  data-remaining={remainingFraction.toFixed(4)}
                  className="mt-1.5 h-[4px] w-full overflow-hidden rounded-full bg-gray-200 dark:bg-[#2b3139]"
                >
                  <div
                    className="h-full rounded-full transition-[width] duration-300 ease-out"
                    style={{
                      width: `${positive ? remainingFraction * 100 : 100}%`,
                      backgroundColor: positive ? GREEN : RED,
                    }}
                  />
                </div>
              </div>
            </>
          ) : (
            <div
              data-testid="p-gap-invalid"
              className="flex items-start gap-1.5 rounded-md border border-dashed border-gray-200 px-2.5 py-2 text-[10px] leading-relaxed text-gray-500 dark:border-[#2b3139] dark:text-[#848e9c]"
            >
              <span className="mt-[1px] flex-none text-gray-400 dark:text-[#5e6673]">!</span>
              <span className="min-w-0">{invalidMessage}</span>
            </div>
          )}
        </div>

        {/* 输入区 */}
        <div className="divide-y divide-gray-100 dark:divide-[#2b3139]/60">
          <div className="flex h-[32px] items-center justify-between px-3">
            <span className="flex items-baseline gap-1.5 select-none">
              <span className="font-mono text-[12px] font-semibold leading-none" style={{ color: YELLOW }}>S</span>
              <span className="text-[10px] text-gray-500 dark:text-[#848e9c]">现价</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ backgroundColor: YELLOW }} />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ backgroundColor: YELLOW }} />
              </span>
              <span
                data-testid="p-gap-spot"
                className="font-mono text-[clamp(11px,4.8cqw,13px)] font-semibold tabular-nums"
                style={{ color: YELLOW }}
              >
                {hasPrice ? currentPrice.toFixed(pricePrecision) : '—'}
              </span>
            </span>
          </div>

          <GapField
            id="stop"
            symbol="K"
            label="止损"
            accent={RED}
            value={stopLoss}
            min={sliderBounds.min}
            max={sliderBounds.max}
            step={sliderBounds.step}
            disabled={!hasPrice}
            onChange={next => { setStopLoss(next); reanchor(); }}
          />

          <GapField
            id="target"
            symbol="T"
            label="目标"
            accent={GREEN}
            value={target}
            min={sliderBounds.min}
            max={sliderBounds.max}
            step={sliderBounds.step}
            disabled={!hasPrice}
            onChange={next => { setTarget(next); reanchor(); }}
          />

          {/* 概率组：P₁、P₂ 缩进并由左侧竖线归入 P 名下——一眼看出 P 是它们的乘积，
              而不是三个并列的独立字段。 */}
          <div className="px-3 pt-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="flex min-w-0 items-baseline gap-1 select-none">
                <span className="font-mono text-[11px] font-semibold leading-none" style={{ color: YELLOW }}>P</span>
                <span className="min-w-0 truncate whitespace-nowrap text-[9px] text-gray-500 dark:text-[#848e9c]">
                  主观胜率
                </span>
                <span className="whitespace-nowrap font-mono text-[8px] text-gray-400 dark:text-[#5e6673]">
                  = P₁×P₂
                </span>
              </span>
              {winRatePct == null ? (
                <span data-testid="p-gap-computed-p" className="flex-none font-mono text-[10px] text-gray-400 dark:text-[#5e6673]">
                  待填
                </span>
              ) : (
                <span
                  data-testid="p-gap-computed-p"
                  title="自动计算、只读：P = 结构存活概率 × 存活后突破 T 的条件概率"
                  className="flex-none font-mono text-[clamp(12px,5.2cqw,15px)] font-semibold leading-none tabular-nums"
                  style={{ color: YELLOW }}
                >
                  {winRatePct.toFixed(1)}%
                </span>
              )}
            </div>
          </div>

          <div className="ml-3 border-l border-gray-200 pb-1 dark:border-[#2b3139]">
            <GapField
              id="survival"
              symbol="P₁"
              label="结构存活"
              accent={YELLOW}
              value={survivalPct}
              min={0}
              max={100}
              step={0.5}
              suffix="%"
              onChange={next => setSurvivalPct(next == null ? null : clamp(next, 0, 100))}
              onCommit={reanchor}
            />
            <GapField
              id="breakout"
              symbol="P₂"
              label="存活后破 T"
              accent={YELLOW}
              value={breakoutPct}
              min={0}
              max={100}
              step={0.5}
              suffix="%"
              onChange={next => setBreakoutPct(next == null ? null : clamp(next, 0, 100))}
              onCommit={reanchor}
            />
          </div>

          {/* b_可落袋：此刻立即止盈能拿到几个 R —— 只与已持有的多单有关，与 T 无关。
              分母锚 K₀ 默认取该多单最早设定的止损（预期最大亏损所在位），可手动改。 */}
          <div className="flex h-[32px] items-center justify-between gap-2 px-3">
            <span className="flex min-w-0 items-baseline gap-1 select-none">
              <span className="font-mono text-[11px] font-semibold leading-none text-[#B080FF]">b</span>
              <span className="whitespace-nowrap text-[9px] text-gray-500 dark:text-[#848e9c]">可落袋</span>
              {longEntryPrice != null && (
                <span className="min-w-0 truncate text-[9px] text-gray-400 dark:text-[#5e6673]">
                  开仓 {longEntryPrice.toFixed(pricePrecision)}
                  {longPositionCount > 1 && ` · ${longPositionCount} 笔均价`}
                </span>
              )}
            </span>
            <span className="flex flex-none items-center gap-1.5">
              {longEntryPrice != null && (
                <label className="flex items-center gap-0.5" title="风险锚 K₀：默认取该多单最早设定的止损（它定义预期最大亏损）；可手动修改，清空即恢复默认。面板上的 K 滑条只做情景推演，不影响此锚。">
                  <span
                    className={`font-mono text-[9px] leading-none ${manualRiskK != null ? 'text-[#B080FF]' : 'text-gray-400 dark:text-[#5e6673]'}`}
                  >
                    K₀
                  </span>
                  <input
                    data-testid="p-gap-riskk-number"
                    type="number"
                    inputMode="decimal"
                    step={10 ** -pricePrecision}
                    placeholder="—"
                    value={effectiveRiskK == null ? '' : effectiveRiskK}
                    onChange={event => {
                      const next = Number.parseFloat(event.target.value);
                      setManualRiskK(Number.isFinite(next) ? next : null);
                    }}
                    className="h-[20px] w-[clamp(48px,20cqw,66px)] rounded border border-gray-200 bg-gray-50 px-1 text-right font-mono text-[9px] tabular-nums text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-[#B080FF] focus:bg-white dark:border-[#2b3139] dark:bg-[#161a1e] dark:text-[#EAECEF] dark:placeholder:text-[#5e6673] dark:focus:bg-[#12161a]"
                  />
                </label>
              )}
              {bankable == null ? (
                <span
                  data-testid="p-gap-bankable"
                  data-bankable-state="none"
                  className="whitespace-nowrap font-mono text-[10px] text-gray-400 dark:text-[#5e6673]"
                >
                  {longEntryPrice == null ? '当前无多单' : 'K₀ 需低于开仓价'}
                </span>
              ) : (
                <span
                  data-testid="p-gap-bankable"
                  data-bankable-state={bankable > 0 ? 'positive' : bankable < 0 ? 'negative' : 'flat'}
                  title="此刻立即止盈能落袋的 R 数 =（现价 − 多单开仓价）÷（开仓价 − K₀）"
                  className="whitespace-nowrap font-mono text-[clamp(11px,4.8cqw,13px)] font-semibold tabular-nums"
                  style={{ color: bankable > 0 ? GREEN : bankable < 0 ? RED : undefined }}
                >
                  {`${bankable > 0 ? '+' : ''}${bankable.toFixed(2)}R`}
                </span>
              )}
            </span>
          </div>

          {/* 战役整体胜率仅作参考对照——P 由上面两项相乘而来，不再从这里落种 */}
          {defaultWinRatePct != null && (
            <div
              data-testid="p-gap-winrate-source"
              className="mt-1 flex w-full items-center gap-1 border-t border-gray-100 px-3 pb-1 pt-1.5 text-left text-[9px] leading-none text-gray-400 dark:border-[#2b3139]/60 dark:text-[#5e6673]"
            >
              参考：本账号战役整体胜率 {defaultWinRatePct.toFixed(0)}%
              {winRateSampleCount > 0 && `（n=${winRateSampleCount}）`}
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
}
