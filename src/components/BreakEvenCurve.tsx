/**
 * 盈亏平衡胜率曲线 —— P = 1 ÷ (1 + b)。
 *
 * 这条曲线回答：赔率 b 之下，不亏不赚最低需要多高的胜率。它随 b 增大急速下降——
 * b 从 1 到 2，要求就从 50% 掉到 33%；这正是「找赔率」比「提高胜率」更省力的原因。
 *
 * 与 P_gap 面板是同一件事的两种画法：把 b =（T−S）÷（S−K）代入即得
 * 1/(1+b) = (S−K)/(T−K) = P₀，所以曲线上当前 b 对应的点，纵坐标就是面板的基线概率。
 * 拖动滑条即是在问「如果把目标放远 / 止损收紧到某个赔率，门槛会降到多少」。
 */
import { useMemo, useState } from 'react';
import { breakEvenWinRate } from '@/lib/advantageGap';

interface Props {
  /** 当前盘面推出的动态赔率，作为滑条起点。 */
  currentPayoffRatio: number;
  /** 主观胜率（0–1）；给出后画出你与门槛的差额。 */
  winRate?: number | null;
  maxOdds?: number;
}

const W = 300;
const H = 150;
const PAD = { top: 8, right: 10, bottom: 20, left: 30 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

const GREEN = '#0ECB81';
const RED = '#F6465D';
const BLUE = '#2B7FFF';

function clamp(v: number, lo: number, hi: number) {
  return Math.min(Math.max(v, lo), hi);
}

export function BreakEvenCurve({ currentPayoffRatio, winRate = null, maxOdds = 20 }: Props) {
  const initial = Number.isFinite(currentPayoffRatio)
    ? clamp(Number(currentPayoffRatio.toFixed(2)), 0, maxOdds)
    : 1;
  const [odds, setOdds] = useState(initial);

  const x = (b: number) => PAD.left + (clamp(b, 0, maxOdds) / maxOdds) * PLOT_W;
  const y = (p: number) => PAD.top + (1 - clamp(p, 0, 1)) * PLOT_H;

  // 曲线在 b 小处最陡，按等距采样即可（120 段足够平滑）
  const { linePath, areaPath } = useMemo(() => {
    const pts: string[] = [];
    const steps = 120;
    for (let i = 0; i <= steps; i++) {
      const b = (i / steps) * maxOdds;
      pts.push(`${x(b).toFixed(2)},${y(1 / (1 + b)).toFixed(2)}`);
    }
    return {
      linePath: `M ${pts.join(' L ')}`,
      areaPath: `M ${pts.join(' L ')} L ${x(maxOdds).toFixed(2)},${y(0).toFixed(2)} L ${x(0).toFixed(2)},${y(0).toFixed(2)} Z`,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxOdds]);

  const be = breakEvenWinRate(odds) ?? 1;
  const edge = winRate == null ? null : winRate - be;

  return (
    <div data-testid="break-even-curve">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="盈亏平衡胜率曲线">
        {/* 网格与纵轴刻度 */}
        {[0, 0.2, 0.4, 0.6, 0.8, 1].map(p => (
          <g key={p}>
            <line
              x1={PAD.left} x2={W - PAD.right} y1={y(p)} y2={y(p)}
              className="stroke-gray-200 dark:stroke-[#2b3139]" strokeWidth={0.6}
            />
            <text
              x={PAD.left - 4} y={y(p) + 2.5} textAnchor="end"
              className="fill-gray-400 dark:fill-[#5e6673]" style={{ fontSize: 6 }}
            >
              {p * 100}%
            </text>
          </g>
        ))}
        {/* 横轴刻度 */}
        {Array.from({ length: 6 }, (_, i) => (i / 5) * maxOdds).map(b => (
          <text
            key={b} x={x(b)} y={H - 6} textAnchor="middle"
            className="fill-gray-400 dark:fill-[#5e6673]" style={{ fontSize: 6 }}
          >
            {Number.isInteger(b) ? b : b.toFixed(0)}
          </text>
        ))}

        <path d={areaPath} fill={BLUE} opacity={0.1} />
        <path d={linePath} fill="none" stroke={BLUE} strokeWidth={1.4} />

        {/* 当前赔率的十字定位 */}
        <line
          x1={x(odds)} x2={x(odds)} y1={PAD.top} y2={y(0)}
          stroke={BLUE} strokeWidth={0.7} strokeDasharray="3 2" opacity={0.65}
        />
        <line
          x1={PAD.left} x2={x(odds)} y1={y(be)} y2={y(be)}
          stroke={BLUE} strokeWidth={0.7} strokeDasharray="3 2" opacity={0.65}
        />
        <circle cx={x(odds)} cy={y(be)} r={2.8} fill={BLUE} />

        {/* 主观胜率横线：在门槛之上为绿、之下为红 */}
        {winRate != null && (
          <>
            <line
              x1={PAD.left} x2={W - PAD.right} y1={y(winRate)} y2={y(winRate)}
              stroke={(edge ?? 0) > 0 ? GREEN : RED} strokeWidth={0.9} strokeDasharray="4 2"
            />
            <text
              x={W - PAD.right} y={y(winRate) - 3} textAnchor="end"
              fill={(edge ?? 0) > 0 ? GREEN : RED} style={{ fontSize: 6 }}
            >
              P {(winRate * 100).toFixed(0)}%
            </text>
          </>
        )}
      </svg>

      {/* 滑条 */}
      <div className="mt-1 flex items-center gap-2">
        <span className="w-8 flex-none text-[9px] text-gray-500 dark:text-[#848e9c]">赔率 b</span>
        <input
          data-testid="break-even-odds-slider"
          type="range"
          aria-label="赔率 b 滑块"
          min={0}
          max={maxOdds}
          step={0.1}
          value={odds}
          onChange={e => setOdds(Number.parseFloat(e.target.value))}
          style={{ accentColor: BLUE }}
          className="h-[3px] min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-gray-200 dark:bg-[#2b3139]"
        />
        <span
          data-testid="break-even-odds-value"
          className="w-9 flex-none text-right font-mono text-[10px] tabular-nums text-gray-900 dark:text-[#EAECEF]"
        >
          {odds.toFixed(1)}
        </span>
      </div>

      {/* 读数 */}
      <div className="mt-2 grid grid-cols-3 gap-1 border-t border-gray-100 pt-2 text-center dark:border-[#2b3139]">
        <div>
          <div className="text-[8px] uppercase tracking-wide text-gray-400 dark:text-[#5e6673]">赔率</div>
          <div className="font-mono text-[11px] font-semibold tabular-nums text-gray-900 dark:text-[#EAECEF]">
            {odds.toFixed(2)}
          </div>
        </div>
        <div>
          <div className="text-[8px] uppercase tracking-wide text-gray-400 dark:text-[#5e6673]">平衡胜率</div>
          <div
            data-testid="break-even-rate"
            className="font-mono text-[11px] font-semibold tabular-nums text-gray-900 dark:text-[#EAECEF]"
          >
            {(be * 100).toFixed(1)}%
          </div>
        </div>
        <div>
          <div className="text-[8px] uppercase tracking-wide text-gray-400 dark:text-[#5e6673]">你的优势</div>
          <div
            data-testid="break-even-edge"
            className="font-mono text-[11px] font-semibold tabular-nums"
            style={{ color: edge == null ? undefined : edge > 0 ? GREEN : RED }}
          >
            {edge == null ? '—' : `${edge > 0 ? '+' : ''}${(edge * 100).toFixed(1)}%`}
          </div>
        </div>
      </div>
    </div>
  );
}
