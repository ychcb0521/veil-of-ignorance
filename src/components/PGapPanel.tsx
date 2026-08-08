/**
 * P_gap —— 优势边际仪表。
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
}

/** 滑块围绕现价展开的半幅：±12% 足够覆盖常规止损/目标，又不至于精度过粗。 */
const SLIDER_SPAN = 0.12;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function formatSignedPercent(fraction: number, digits = 1) {
  const percent = fraction * 100;
  const normalized = Math.abs(percent) < 0.05 ? 0 : percent;
  return `${normalized > 0 ? '+' : ''}${normalized.toFixed(digits)}%`;
}

type PriceFieldProps = {
  id: string;
  label: string;
  hint: string;
  value: number | null;
  min: number;
  max: number;
  step: number;
  precision: number;
  accent: string;
  disabled: boolean;
  onChange: (next: number) => void;
};

function PriceField({
  id, label, hint, value, min, max, step, precision, accent, disabled, onChange,
}: PriceFieldProps) {
  return (
    <div className="px-3 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={`${id}-number`} className="flex items-baseline gap-1.5">
          <span className="text-[11px] font-medium" style={{ color: accent }}>{label}</span>
          <span className="text-[9px] text-gray-500 dark:text-[#848e9c]">{hint}</span>
        </label>
        <input
          id={`${id}-number`}
          data-testid={`p-gap-${id}-number`}
          type="number"
          inputMode="decimal"
          step={step}
          disabled={disabled}
          value={value == null ? '' : value}
          onChange={event => {
            const next = Number.parseFloat(event.target.value);
            if (Number.isFinite(next)) onChange(next);
          }}
          className="h-6 w-24 rounded border border-gray-200 bg-white px-1.5 text-right font-mono text-[10px] tabular-nums text-gray-900 outline-none transition-colors focus:border-[#fcd535] disabled:opacity-40 dark:border-[#2b3139] dark:bg-[#161a1e] dark:text-[#EAECEF]"
        />
      </div>
      <input
        id={`${id}-slider`}
        data-testid={`p-gap-${id}-slider`}
        type="range"
        aria-label={`${label} 滑块`}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={value == null ? min : clamp(value, min, max)}
        onChange={event => onChange(Number.parseFloat(event.target.value))}
        className="mt-1 h-1 w-full cursor-pointer appearance-none rounded bg-gray-200 accent-current disabled:opacity-40 dark:bg-[#2b3139]"
        style={{ color: accent }}
      />
    </div>
  );
}

export function PGapPanel({ currentPrice, pricePrecision }: Props) {
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

  // 满格 = 提交 P 那一刻的初始 gap；随后 S 推高基线，条向零收缩，
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
  const remainingFraction = anchorGap != null && anchorGap > 0 && gap != null
    ? clamp(gap / anchorGap, 0, 1)
    : gap != null && gap > 0 ? 1 : 0;

  const invalidMessage = result.valid
    ? null
    : result.reason === 'incomplete'
      ? hasPrice ? '请填写止损 K 与目标 T' : '等待行情数据...'
      : result.reason === 'degenerate'
        ? '目标 T 与止损 K 相同，基线概率无意义'
        : '方向不成立：多头需 K < S < T，空头需 T < S < K';

  return (
    <div
      data-testid="p-gap-panel"
      className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-[#2b3139] scrollbar-track-transparent"
    >
      {/* 读数区 */}
      <div className="px-3 pt-2.5 pb-2 border-b border-gray-200 dark:border-[#2b3139]/60">
        {result.valid ? (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[10px] text-gray-500 dark:text-[#848e9c]">基线概率 P₀</span>
              <span
                data-testid="p-gap-baseline"
                className="font-mono text-[15px] font-semibold tabular-nums text-gray-900 dark:text-[#EAECEF]"
              >
                {(result.baseline * 100).toFixed(1)}%
              </span>
            </div>
            <div className="mt-0.5 text-[9px] leading-relaxed text-gray-500 dark:text-[#848e9c]">
              市场免费给你的胜率，P 必须高于它
            </div>

            <div className="mt-2 flex items-baseline justify-between gap-2">
              <span className="text-[10px] text-gray-500 dark:text-[#848e9c]">优势边际 gap</span>
              {gap == null ? (
                <span data-testid="p-gap-value" className="font-mono text-[12px] text-gray-500 dark:text-[#848e9c]">
                  请给出主观胜率 P
                </span>
              ) : (
                <span
                  data-testid="p-gap-value"
                  data-gap-sign={gap > 0 ? 'positive' : 'non-positive'}
                  className={`font-mono text-[15px] font-semibold tabular-nums ${gap > 0 ? 'text-trading-green' : 'text-trading-red'}`}
                >
                  {gap > 0 ? `优势边际 ${formatSignedPercent(gap)}` : '优势已耗尽'}
                </span>
              )}
            </div>

            {/* 优势条：满格为锚定时的 gap，随基线抬高向零收缩 */}
            <div
              data-testid="p-gap-bar"
              data-remaining={remainingFraction.toFixed(4)}
              className="mt-1.5 h-1 w-full overflow-hidden rounded bg-gray-200 dark:bg-[#2b3139]"
            >
              <div
                className={`h-full rounded transition-[width] duration-200 ${gap != null && gap > 0 ? 'bg-trading-green' : 'bg-trading-red'}`}
                style={{ width: `${gap != null && gap > 0 ? remainingFraction * 100 : 100}%` }}
              />
            </div>
          </>
        ) : (
          <div
            data-testid="p-gap-invalid"
            className="py-3 text-center text-[11px] leading-relaxed text-gray-500 dark:text-[#848e9c]"
          >
            {invalidMessage}
          </div>
        )}
      </div>

      {/* 输入区 */}
      <div className="divide-y divide-gray-200 dark:divide-[#2b3139]/60">
        <div className="flex items-center justify-between px-3 py-1.5">
          <span className="flex items-baseline gap-1.5">
            <span className="text-[11px] font-medium text-gray-900 dark:text-[#EAECEF]">S</span>
            <span className="text-[9px] text-gray-500 dark:text-[#848e9c]">现价 · 实时</span>
          </span>
          <span
            data-testid="p-gap-spot"
            className="font-mono text-[11px] font-medium tabular-nums text-[#fcd535]"
          >
            {hasPrice ? currentPrice.toFixed(pricePrecision) : '—'}
          </span>
        </div>

        <PriceField
          id="stop"
          label="K"
          hint="止损"
          value={stopLoss}
          min={sliderBounds.min}
          max={sliderBounds.max}
          step={sliderBounds.step}
          precision={pricePrecision}
          accent="#F6465D"
          disabled={!hasPrice}
          onChange={next => { setStopLoss(next); reanchor(); }}
        />

        <PriceField
          id="target"
          label="T"
          hint="目标"
          value={target}
          min={sliderBounds.min}
          max={sliderBounds.max}
          step={sliderBounds.step}
          precision={pricePrecision}
          accent="#0ECB81"
          disabled={!hasPrice}
          onChange={next => { setTarget(next); reanchor(); }}
        />

        <div className="px-3 py-1.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="p-gap-winrate-number" className="flex items-baseline gap-1.5">
              <span className="text-[11px] font-medium text-gray-900 dark:text-[#EAECEF]">P</span>
              <span className="text-[9px] text-gray-500 dark:text-[#848e9c]">主观胜率</span>
            </label>
            <div className="flex items-center gap-1">
              <input
                id="p-gap-winrate-number"
                data-testid="p-gap-winrate-number"
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step={0.5}
                placeholder="—"
                value={winRatePct == null ? '' : winRatePct}
                onChange={event => {
                  const raw = Number.parseFloat(event.target.value);
                  setWinRatePct(Number.isFinite(raw) ? clamp(raw, 0, 100) : null);
                }}
                onBlur={reanchor}
                className="h-6 w-20 rounded border border-gray-200 bg-white px-1.5 text-right font-mono text-[10px] tabular-nums text-gray-900 outline-none transition-colors focus:border-[#fcd535] dark:border-[#2b3139] dark:bg-[#161a1e] dark:text-[#EAECEF]"
              />
              <span className="text-[9px] text-gray-500 dark:text-[#848e9c]">%</span>
            </div>
          </div>
          <input
            data-testid="p-gap-winrate-slider"
            type="range"
            aria-label="主观胜率 P 滑块"
            min={0}
            max={100}
            step={0.5}
            value={winRatePct ?? 0}
            onChange={event => setWinRatePct(Number.parseFloat(event.target.value))}
            onPointerUp={reanchor}
            onKeyUp={reanchor}
            className="mt-1 h-1 w-full cursor-pointer appearance-none rounded bg-gray-200 text-[#fcd535] accent-current dark:bg-[#2b3139]"
          />
        </div>
      </div>
    </div>
  );
}
