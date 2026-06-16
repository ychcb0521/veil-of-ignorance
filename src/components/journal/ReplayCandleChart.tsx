/**
 * Legacy SVG fallback and shared replay annotation types.
 * Active replay surfaces use ReplayKlineChart, which wraps the main klinecharts chart.
 */
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import type { KlineData } from '@/hooks/useBinanceData';

export interface ChartMarker {
  time: number;
  price: number;
  shape: 'triangle-up' | 'triangle-down' | 'circle' | 'square';
  color: string;
  label?: string;
}

export interface PriceLine {
  price: number;
  color: string;
  title?: string;
  dim?: boolean;
}

export interface TimeBoundPriceLine extends PriceLine {
  startTime: number;
  endTime: number;
  dashed?: boolean;
  endMarker?: 'x' | null;
}

export interface VerticalLine {
  time: number;
  color: string;
  width?: number;
  z?: number;
  /** Solid when false, dashed otherwise. Defaults to dashed for backward compat. */
  dashed?: boolean;
}

interface Props {
  klines: KlineData[];
  currentTime: number;
  intervalMs: number;
  markers?: ChartMarker[];
  priceLines?: PriceLine[];
  timeBoundPriceLines?: TimeBoundPriceLine[];
  verticalLines?: VerticalLine[];
  /** Anchor zoom around currentTime — number of candles visible */
  windowCandles?: number;
}

const CHART_PAD_TOP = 8;
const CHART_PAD_BOTTOM = 24;
const CHART_PAD_LEFT = 8;
const CHART_PAD_RIGHT = 64;

export function ReplayCandleChart({
  klines, currentTime, intervalMs,
  markers = [], priceLines = [], timeBoundPriceLines = [], verticalLines = [],
  windowCandles = 120,
}: Props) {
  const visible = useMemo(() => {
    if (klines.length === 0) return [];
    // window centred on currentTime
    const cursorIdx = (() => {
      let lo = 0, hi = klines.length - 1, ans = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (klines[mid].time <= currentTime) { ans = mid; lo = mid + 1; }
        else hi = mid - 1;
      }
      return ans === -1 ? 0 : ans;
    })();
    const half = Math.floor(windowCandles * 0.6);
    const start = Math.max(0, cursorIdx - half);
    const end = Math.min(klines.length, start + windowCandles);
    return klines.slice(start, end);
  }, [klines, currentTime, windowCandles]);

  const bounds = useMemo(() => {
    if (visible.length === 0) return { minP: 0, maxP: 1, minT: 0, maxT: 1 };
    let minP = Infinity, maxP = -Infinity;
    for (const k of visible) {
      if (k.low < minP) minP = k.low;
      if (k.high > maxP) maxP = k.high;
    }
    for (const pl of priceLines) {
      if (pl.price < minP) minP = pl.price;
      if (pl.price > maxP) maxP = pl.price;
    }
    for (const pl of timeBoundPriceLines) {
      if (pl.price < minP) minP = pl.price;
      if (pl.price > maxP) maxP = pl.price;
    }
    for (const m of markers) {
      if (m.price < minP) minP = m.price;
      if (m.price > maxP) maxP = m.price;
    }
    const pad = (maxP - minP) * 0.08 || 1;
    minP -= pad; maxP += pad;
    const minT = visible[0].time;
    const maxT = visible[visible.length - 1].time + intervalMs;
    return { minP, maxP, minT, maxT };
  }, [visible, priceLines, timeBoundPriceLines, markers, intervalMs]);

  // viewport in arbitrary user units; rendered with viewBox/preserveAspectRatio for responsiveness
  const W = 1000;
  const H = 500;
  const plotW = W - CHART_PAD_LEFT - CHART_PAD_RIGHT;
  const plotH = H - CHART_PAD_TOP - CHART_PAD_BOTTOM;

  const xForTime = (t: number) =>
    CHART_PAD_LEFT + ((t - bounds.minT) / (bounds.maxT - bounds.minT)) * plotW;
  const yForPrice = (p: number) =>
    CHART_PAD_TOP + (1 - (p - bounds.minP) / (bounds.maxP - bounds.minP)) * plotH;

  const candleW = Math.max(1.5, (plotW / Math.max(1, visible.length)) * 0.7);

  // Y-axis ticks (5)
  const yTicks = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i <= 4; i++) {
      out.push(bounds.minP + ((bounds.maxP - bounds.minP) * i) / 4);
    }
    return out;
  }, [bounds]);

  const cursorX = xForTime(currentTime);

  if (visible.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center text-muted-foreground text-xs">
        无 K 线数据
      </div>
    );
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-full block">
      {/* grid + y ticks */}
      {yTicks.map((p: number, i: number) => (
        <g key={i}>
          <line x1={CHART_PAD_LEFT} x2={W - CHART_PAD_RIGHT}
            y1={yForPrice(p)} y2={yForPrice(p)} stroke="#2B3139" strokeWidth={0.5} />
          <text x={W - CHART_PAD_RIGHT + 4} y={yForPrice(p) + 3}
            fontSize="10" fill="#848E9C" fontFamily="monospace">{p.toFixed(2)}</text>
        </g>
      ))}

      {/* price lines (SL/TP) */}
      {priceLines.map((pl, i) => {
        const y = yForPrice(pl.price);
        return (
          <g key={i} opacity={pl.dim ? 0.3 : 1}>
            <line x1={CHART_PAD_LEFT} x2={W - CHART_PAD_RIGHT} y1={y} y2={y}
              stroke={pl.color} strokeWidth={1} strokeDasharray="4 4" />
            {pl.title && (
              <text x={W - CHART_PAD_RIGHT + 4} y={y - 3}
                fontSize="9" fill={pl.color} fontFamily="monospace">{pl.title} {pl.price.toFixed(2)}</text>
            )}
          </g>
        );
      })}

      {/* bounded price lines */}
      {timeBoundPriceLines.map((pl, i) => {
        const clampedStart = Math.max(pl.startTime, bounds.minT);
        const clampedEnd = Math.min(pl.endTime, bounds.maxT);
        if (clampedEnd <= clampedStart) return null;
        const y = yForPrice(pl.price);
        const x1 = xForTime(clampedStart);
        const x2 = xForTime(clampedEnd);
        return (
          <g key={`tb-${i}`} opacity={pl.dim ? 0.3 : 1}>
            <line
              x1={x1}
              x2={x2}
              y1={y}
              y2={y}
              stroke={pl.color}
              strokeWidth={1}
              strokeDasharray={pl.dashed ? '4 4' : undefined}
            />
            {pl.title && (
              <text x={x1 + 4} y={y - 4} fontSize="9" fill={pl.color} fontFamily="monospace">{pl.title}</text>
            )}
            {pl.endMarker === 'x' && (
              <>
                <line x1={x2 - 4} y1={y - 4} x2={x2 + 4} y2={y + 4} stroke={pl.color} strokeWidth={1} />
                <line x1={x2 - 4} y1={y + 4} x2={x2 + 4} y2={y - 4} stroke={pl.color} strokeWidth={1} />
              </>
            )}
          </g>
        );
      })}

      {/* candles */}
      {visible.map((k: KlineData, i: number) => {
        const x = xForTime(k.time + intervalMs / 2);
        const isUp = k.close >= k.open;
        const color = isUp ? '#0ECB81' : '#F6465D';
        const bodyTop = yForPrice(Math.max(k.open, k.close));
        const bodyBot = yForPrice(Math.min(k.open, k.close));
        const wickTop = yForPrice(k.high);
        const wickBot = yForPrice(k.low);
        return (
          <g key={i}>
            <line x1={x} x2={x} y1={wickTop} y2={wickBot} stroke={color} strokeWidth={0.8} />
            <rect x={x - candleW / 2} y={bodyTop} width={candleW}
              height={Math.max(0.5, bodyBot - bodyTop)} fill={color} />
          </g>
        );
      })}

      {/* vertical lines (entry/exit/cursor) — render by z asc, cursor highest */}
      {[...verticalLines].sort((a, b) => (a.z ?? 0) - (b.z ?? 0)).map((v, i) => {
        if (v.time < bounds.minT || v.time > bounds.maxT) return null;
        const x = xForTime(v.time);
        return (
          <line key={i} x1={x} x2={x} y1={CHART_PAD_TOP} y2={H - CHART_PAD_BOTTOM}
            stroke={v.color} strokeWidth={v.width ?? 1}
            strokeDasharray={(v.dashed ?? true) ? '2 3' : undefined} />
        );
      })}

      {/* current cursor (always topmost) */}
      <line x1={cursorX} x2={cursorX} y1={CHART_PAD_TOP} y2={H - CHART_PAD_BOTTOM}
        stroke="rgba(240, 185, 11, 0.85)" strokeWidth={1.2} />

      {/* markers */}
      {markers.map((m, i) => {
        if (m.time < bounds.minT || m.time > bounds.maxT) return null;
        const x = xForTime(m.time);
        const y = yForPrice(m.price);
        let shape: ReactNode;
        switch (m.shape) {
          case 'triangle-up':
            shape = <polygon points={`${x},${y - 7} ${x - 5},${y + 3} ${x + 5},${y + 3}`} fill={m.color} />;
            break;
          case 'triangle-down':
            shape = <polygon points={`${x},${y + 7} ${x - 5},${y - 3} ${x + 5},${y - 3}`} fill={m.color} />;
            break;
          case 'square':
            shape = <rect x={x - 4} y={y - 4} width={8} height={8} fill={m.color} />;
            break;
          default:
            shape = <circle cx={x} cy={y} r={4} fill={m.color} />;
        }
        return (
          <g key={i}>
            {shape}
            {m.label && (
              <text x={x + 8} y={y + 3} fontSize="9" fill={m.color} fontFamily="monospace">{m.label}</text>
            )}
          </g>
        );
      })}

      {/* x-axis time labels — 5 ticks */}
      {Array.from({ length: 5 }).map((_, i) => {
        const t = bounds.minT + ((bounds.maxT - bounds.minT) * i) / 4;
        const d = new Date(t);
        const pad = (n: number) => String(n).padStart(2, '0');
        const txt = `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        const x = xForTime(t);
        return (
          <text key={i} x={x} y={H - 6} fontSize="9" fill="#848E9C"
            fontFamily="monospace" textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}>{txt}</text>
        );
      })}
    </svg>
  );
}
