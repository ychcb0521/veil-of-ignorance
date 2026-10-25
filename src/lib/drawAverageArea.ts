import type { IndicatorDrawParams } from 'klinecharts';

export interface AverageAreaScale {
  center: number;
  lower?: number;
  upper?: number;
  range?: readonly [number, number] | null;
}
const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));
function referenceRadius(scale: AverageAreaScale, positive: boolean): number {
  const candidate = positive ? scale.upper : scale.lower;
  const reference = candidate != null && Number.isFinite(candidate) ? candidate : positive ? scale.range?.[1] : scale.range?.[0];
  const radius = reference == null ? 1 : Math.abs(reference - scale.center);
  return radius > 0 ? radius : 1;
}
const distanceFromCenter = (value: number, scale: AverageAreaScale) => Math.abs(value - scale.center) / referenceRadius(scale, value >= scale.center);
function sideColor(positive: boolean, distance: number, alpha?: number): string {
  const hue = positive ? [14, 203, 129] : [246, 70, 93];
  const excess = Math.max(0, distance - 1);
  const depth = 1 - 0.23 * excess / (1 + excess);
  return `rgba(${hue.map(channel => Math.round(channel * depth)).join(',')},${alpha ?? 0.94 + 0.06 * clamp(distance)})`;
}
/** Hue shows the side of the threshold; strength follows the saved data scale, independently of zoom. */
export function averageAreaColor(value: number, scale: AverageAreaScale, alpha?: number): string {
  if (!Number.isFinite(value)) return 'rgba(132,142,156,0.6)';
  if (value === scale.center) return `rgba(132,142,156,${alpha ?? 0.6})`;
  return sideColor(value > scale.center, distanceFromCenter(value, scale), alpha);
}

type Point = { x: number; y: number };
/** Vertical value colors keep the fill green above the threshold and red below it, including crossings. */
function valueGradient(args: IndicatorDrawParams, scale: AverageAreaScale, fill: boolean): CanvasGradient {
  const { ctx, yAxis, bounding: { height } } = args;
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  const centerY = yAxis.convertToPixel(scale.center);
  const positions = new Set([0, height]);
  // Reference-scale samples preserve the same shade at the same value after resizing or zooming.
  for (let i = 1; i < 32; i++) positions.add(height * i / 32);
  for (const positive of [true, false]) for (const distance of [.125, .25, .5, 1, 2, 4]) {
    const y = yAxis.convertToPixel(scale.center + (positive ? 1 : -1) * referenceRadius(scale, positive) * distance);
    if (Number.isFinite(y) && y > 0 && y < height) positions.add(y);
  }
  if (centerY >= 0 && centerY <= height) positions.add(centerY);
  for (const y of [...positions].sort((a, b) => a - b)) {
    const at = y / height;
    if (y === centerY) {
      // Two stops at the same location switch hue exactly at the threshold, without a gray band.
      gradient.addColorStop(at, sideColor(true, 0, fill ? 0.035 : 0.94));
      gradient.addColorStop(at, sideColor(false, 0, fill ? 0.035 : 0.94));
    } else {
      const value = yAxis.convertFromPixel(y);
      const alpha = fill ? 0.035 + 0.245 * clamp(distanceFromCenter(value, scale)) : undefined;
      gradient.addColorStop(at, averageAreaColor(value, scale, alpha));
    }
  }
  return gradient;
}

/** Fill only between the curve and its threshold, with missing readings left disconnected. */
export function drawAverageArea(args: IndicatorDrawParams, key: string, scale: AverageAreaScale): boolean {
  const { ctx, indicator, visibleRange, xAxis, yAxis, bounding } = args;
  if (!xAxis || !visibleRange || !bounding?.width || !bounding.height || !ctx.createLinearGradient || !yAxis.convertFromPixel) return false;
  const { width, height } = bounding, centerY = yAxis.convertToPixel(scale.center);
  if (!Number.isFinite(centerY)) return false;
  const runs: Point[][] = [];
  let run: Point[] = [];
  // Include neighbors beyond the viewport so scrolling never cuts a segment short.
  const from = Math.max(0, visibleRange.from - 1), to = Math.min(indicator.result.length, visibleRange.to + 1);
  for (let i = from; i < to; i++) {
    const value = indicator.result[i]?.[key];
    const x = xAxis.convertToPixel(i), y = typeof value === 'number' ? yAxis.convertToPixel(value) : NaN;
    if (!Number.isFinite(value) || !Number.isFinite(x) || !Number.isFinite(y)) {
      if (run.length) runs.push(run);
      run = [];
      continue;
    }
    run.push({ x, y });
  }
  if (run.length) runs.push(run);
  if (!runs.length) return true;

  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.clip();
  ctx.fillStyle = valueGradient(args, scale, true);
  ctx.beginPath();
  for (const segment of runs) {
    if (segment.length < 2) continue;
    ctx.moveTo(segment[0].x, centerY);
    for (const point of segment) ctx.lineTo(point.x, point.y);
    ctx.lineTo(segment.at(-1)!.x, centerY); ctx.closePath();
  }
  ctx.fill();
  ctx.setLineDash([]); ctx.strokeStyle = valueGradient(args, scale, false);
  ctx.lineWidth = height < 55 ? 1.8 : height < 110 ? 2.1 : 2.6;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath();
  for (const segment of runs) {
    ctx.moveTo(segment[0].x, segment[0].y);
    for (let i = 1; i < segment.length; i++) ctx.lineTo(segment[i].x, segment[i].y);
  }
  ctx.stroke(); ctx.restore();
  return true;
}
