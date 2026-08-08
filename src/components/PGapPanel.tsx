/**
 * P_gap —— 优势边际仪表（独立模块）。
 *
 * 只做一件事：把「主观胜率 P」减去「市场免费给的基线胜率 P₀」的差额实时显示出来。
 * S 随行情跳动，K / T / P 由用户拖动；任一输入变动立即重算。读数即全部功能：
 * 不落库、不记历史、不做校准统计、不给仓位建议。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { computeAdvantageGap } from '@/lib/advantageGap';

interface Props {
  /** 现价 S，来自盘面实时数据，只读。 */
  currentPrice: number;
  pricePrecision: number;
  /** 默认完整显示；折叠后只留表头与一行读数。 */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onClose?: () => void;
}

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

/** 一行输入：左侧符号 + 名称，右侧数字框，下方滑块。三行等距，读数与手柄对齐。 */
function GapField({
  id, symbol, label, accent, value, min, max, step,
  disabled = false, suffix, placeholder = '—', onChange, onCommit,
}: FieldProps) {
  return (
    <div className="px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={`p-gap-${id}-number`} className="flex items-baseline gap-1.5 select-none">
          <span className="font-mono text-[12px] font-semibold leading-none" style={{ color: accent }}>{symbol}</span>
          <span className="text-[10px] text-gray-500 dark:text-[#848e9c]">{label}</span>
        </label>
        <div className="flex items-center gap-1">
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
            className="h-[26px] w-[92px] rounded border border-gray-200 bg-gray-50 px-2 text-right font-mono text-[11px] tabular-nums text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-[#fcd535] focus:bg-white disabled:opacity-40 dark:border-[#2b3139] dark:bg-[#161a1e] dark:text-[#EAECEF] dark:placeholder:text-[#5e6673] dark:focus:bg-[#12161a]"
          />
          {suffix && <span className="w-3 text-[10px] text-gray-500 dark:text-[#848e9c]">{suffix}</span>}
        </div>
      </div>
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
        className="mt-2 h-[3px] w-full cursor-pointer appearance-none rounded-full bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-[#2b3139]"
      />
    </div>
  );
}

export function PGapPanel({
  currentPrice,
  pricePrecision,
  collapsed = false,
  onToggleCollapsed,
  onClose,
}: Props) {
  const hasPrice = Number.isFinite(currentPrice) && currentPrice > 0;
  // K / T 用现价两侧的对称括号作起手，滑块才有落点；P 严格无默认值。
  const [stopLoss, setStopLoss] = useState<number | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [winRatePct, setWinRatePct] = useState<number | null>(null);
  const seededRef = useRef(false);

  useEffect(() => {
    if (seededRef.current || !hasPrice) return;
    seededRef.current = true;
    setStopLoss(Number((currentPrice * 0.98).toFixed(pricePrecision)));
    setTarget(Number((currentPrice * 1.02).toFixed(pricePrecision)));
  }, [currentPrice, hasPrice, pricePrecision]);

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
  const [anchorGap, setAnchorGap] = useState<number | null>(null);
  const reanchor = () => {
    setAnchorGap(result.valid && result.gap != null && result.gap > 0 ? result.gap : null);
  };

  const sliderBounds = useMemo(() => {
    if (!hasPrice) return { min: 0, max: 1, step: 1 };
    const min = currentPrice * (1 - SLIDER_SPAN);
    const max = currentPrice * (1 + SLIDER_SPAN);
    return { min, max, step: Math.max((max - min) / 400, 10 ** -pricePrecision) };
  }, [currentPrice, hasPrice, pricePrecision]);

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
      className="flex h-full min-h-0 flex-col overflow-hidden bg-white dark:bg-[#1e2329] select-none"
    >
      {/* 模块表头 */}
      <div className="group flex-none flex items-center justify-between gap-2 pl-3 pr-2 h-9 border-b border-gray-200 dark:border-[#2b3139]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="relative flex h-full items-center whitespace-nowrap font-mono text-[12px] font-semibold text-gray-900 dark:text-[#EAECEF]">
            P_gap
          </span>
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
        {/* 读数区 —— 模块的主角，给足留白与字号层级 */}
        <div className="px-3 pt-3 pb-3 border-b border-gray-200 dark:border-[#2b3139]">
          {result.valid ? (
            <>
              <div className="flex items-end justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[10px] leading-none text-gray-500 dark:text-[#848e9c]">
                    基线概率 P<sub className="text-[8px]">0</sub>
                  </div>
                  <div className="mt-1.5 text-[9px] leading-relaxed text-gray-400 dark:text-[#5e6673]">
                    市场免费给你的胜率，P 必须高于它
                  </div>
                </div>
                <div
                  data-testid="p-gap-baseline"
                  className="flex-none font-mono text-[22px] font-semibold leading-none tabular-nums text-gray-900 dark:text-[#EAECEF]"
                >
                  {(result.baseline * 100).toFixed(1)}%
                </div>
              </div>

              <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 dark:border-[#2b3139] dark:bg-[#161a1e]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-gray-500 dark:text-[#848e9c]">优势边际 gap</span>
                  {gap == null ? (
                    <span data-testid="p-gap-value" className="font-mono text-[11px] text-gray-400 dark:text-[#5e6673]">
                      请给出主观胜率 P
                    </span>
                  ) : (
                    <span
                      data-testid="p-gap-value"
                      data-gap-sign={positive ? 'positive' : 'non-positive'}
                      className="font-mono text-[17px] font-semibold leading-none tabular-nums"
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
                  className="mt-2 h-[5px] w-full overflow-hidden rounded-full bg-gray-200 dark:bg-[#2b3139]"
                >
                  <div
                    className="h-full rounded-full transition-[width] duration-300 ease-out"
                    style={{
                      width: `${positive ? remainingFraction * 100 : 100}%`,
                      backgroundColor: positive ? GREEN : RED,
                    }}
                  />
                </div>
                {positive && (
                  <div className="mt-1.5 text-[9px] leading-none text-gray-400 dark:text-[#5e6673]">
                    满格为锚定时的优势，随价格推进向零收缩
                  </div>
                )}
              </div>
            </>
          ) : (
            <div
              data-testid="p-gap-invalid"
              className="flex min-h-[92px] items-center justify-center rounded-md border border-dashed border-gray-200 px-3 text-center text-[11px] leading-relaxed text-gray-500 dark:border-[#2b3139] dark:text-[#848e9c]"
            >
              {invalidMessage}
            </div>
          )}
        </div>

        {/* 输入区 */}
        <div className="divide-y divide-gray-100 dark:divide-[#2b3139]/60">
          <div className="flex items-center justify-between px-3 h-[38px]">
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
                className="font-mono text-[13px] font-semibold tabular-nums"
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

          <GapField
            id="winrate"
            symbol="P"
            label="主观胜率"
            accent={YELLOW}
            value={winRatePct}
            min={0}
            max={100}
            step={0.5}
            suffix="%"
            onChange={next => setWinRatePct(next == null ? null : clamp(next, 0, 100))}
            onCommit={reanchor}
          />
        </div>
      </div>
      )}
    </div>
  );
}
