import type { IndicatorDrawParams } from 'klinecharts';

export interface AverageAreaScale {
  center: number;
  lower?: number;
  upper?: number;
  range?: readonly [number, number] | null;
}
const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));

/** Continuous display colors, measured against reference values rather than zoom. */
export function averageAreaColor(value: number, scale: AverageAreaScale, alpha?: number): string {
  const delta = value - scale.center;
  const candidate = delta >= 0 ? scale.upper : scale.lower;
  const reference = candidate != null && Number.isFinite(candidate) ? candidate : delta >= 0 ? scale.range?.[1] : scale.range?.[0];
  const radius = reference == null ? 1 : Math.abs(reference - scale.center);
  const distance = Math.abs(delta) / (radius > 0 ? radius : 1);
  const amount = clamp(distance);
  const neutral = [132, 142, 156];
  const hue = delta >= 0 ? [14, 203, 129] : [246, 70, 93];
  const excess = Math.max(0, distance - 1);
  const depth = 1 - 0.23 * excess / (1 + excess);
  const rgb = neutral.map((channel, index) => Math.round((channel + (hue[index] - channel) * amount) * depth));
  return `rgba(${rgb.join(',')},${alpha ?? 0.6 + 0.4 * amount})`;
}

type Surface = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; width: number; height: number; ratio: number };
const surfaces = new WeakMap<object, Surface>();
type Point = { x: number; y: number; value: number };

/** One reusable masked surface per pane: no gradient allocation per candle. */
export function drawAverageArea(args: IndicatorDrawParams, key: string, scale: AverageAreaScale): boolean {
  const { ctx, indicator, visibleRange, xAxis, yAxis, bounding } = args;
  if (!xAxis || !visibleRange || !bounding?.width || !bounding.height || !ctx.createLinearGradient || !ctx.drawImage) return false;
  const { width, height } = bounding;
  const runs: Point[][] = [];
  let run: Point[] = [];
  const points: Point[] = [];
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
    const point = { x, y, value };
    run.push(point); points.push(point);
  }
  if (run.length) runs.push(run);
  if (!points.length) return true;

  // A single horizontal ramp ties the stroke and fill to the same actual values.
  // Sample long smooth stretches but always retain peaks and direction changes.
  const colors = ctx.createLinearGradient(0, 0, width, 0);
  const stride = Math.max(1, Math.ceil(points.length / 256));
  for (let i = 0; i < points.length; i++) {
    const previous = points[i - 1]?.value, current = points[i].value, next = points[i + 1]?.value;
    const turning = (current > previous && current >= next) || (current < previous && current <= next);
    const crossing = (current - scale.center) * (previous - scale.center) < 0;
    if (crossing) {
      const fraction = (scale.center - previous) / (current - previous);
      const x = points[i - 1].x + fraction * (points[i].x - points[i - 1].x);
      colors.addColorStop(clamp(x / width), averageAreaColor(scale.center, scale));
    }
    if (i % stride === 0 || turning || crossing) colors.addColorStop(clamp(points[i].x / width), averageAreaColor(current, scale));
  }
  const last = points.at(-1)!;
  colors.addColorStop(clamp(last.x / width), averageAreaColor(last.value, scale));

  const doc = ctx.canvas?.ownerDocument;
  const ratio = doc?.defaultView?.devicePixelRatio ?? 1;
  let surface = surfaces.get(indicator);
  if (!surface && doc) {
    const canvas = doc.createElement('canvas'), buffer = canvas.getContext('2d');
    if (buffer) { surface = { canvas, ctx: buffer, width: 0, height: 0, ratio: 0 }; surfaces.set(indicator, surface); }
  }
  if (surface) {
    const { canvas, ctx: buffer } = surface;
    if (surface.width !== width || surface.height !== height || surface.ratio !== ratio) {
      canvas.width = Math.ceil(width * ratio); canvas.height = Math.ceil(height * ratio);
      buffer.setTransform(ratio, 0, 0, ratio, 0, 0);
      surface.width = width; surface.height = height; surface.ratio = ratio;
    }
    buffer.clearRect(0, 0, width, height);
    buffer.globalCompositeOperation = 'source-over';
    buffer.fillStyle = colors;
    buffer.beginPath();
    for (const segment of runs) {
      if (segment.length < 2) continue;
      buffer.moveTo(segment[0].x, height);
      for (const point of segment) buffer.lineTo(point.x, point.y);
      buffer.lineTo(segment.at(-1)!.x, height); buffer.closePath();
    }
    buffer.fill();
    // Mask only the private area surface, keeping reference marks and other panes intact.
    const fade = buffer.createLinearGradient(0, 0, 0, height);
    fade.addColorStop(0, 'rgba(255,255,255,0.32)');
    fade.addColorStop(0.55, 'rgba(255,255,255,0.18)');
    fade.addColorStop(1, 'rgba(255,255,255,0)');
    buffer.globalCompositeOperation = 'destination-in';
    buffer.fillStyle = fade; buffer.fillRect(0, 0, width, height);
    buffer.globalCompositeOperation = 'source-over';
    ctx.drawImage(canvas, 0, 0, width, height);
  }

  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.clip();
  ctx.setLineDash([]); ctx.strokeStyle = colors;
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
