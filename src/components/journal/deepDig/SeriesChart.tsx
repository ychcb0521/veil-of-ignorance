/**
 * Deep dig 描述统计 · 时间序列曲线：各组在进场前后每个时点的平均（实验组、对照组带 ±1 标准误阴影）。
 * 【用户要求】2026-10-17「描述统计那里能够画出各组的时间序列曲线（组内数据在时间序列上的平均），比如 V 的时间序列曲线，
 * 并且这个变量可以让我来选择（默认为当前的核心变量）」。
 * 变量从公式里选，默认公式最后一句；删掉的行不算；悬停看每组在那个时点的值。
 * 【用户要求】2026-10-17「时间序列图这里的组别可以选取和删减」：「组别」一行逐组勾选，选择记在本机（按特征值）。
 * 【用户要求】2026-10-18「手动滑动进场这条竖线，选取不同时刻的对应数据」：一条可拖动的橘黄竖线（默认在进场），
 * 在图里按下拖动、拖顶上的小标签，或聚焦后用 ← / → 一格一格移；上面的分组表、点阵图、逐场数据跟着按那一刻的值统计。
 * 进场处的橘黄虚线留着作参照。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { groupLabel, type DeepDigData, type DeepDigRowGroup } from '@/lib/deepDig/analysis';
import { formatSeriesOffset, groupCurves, type DeepDigSeries, type GroupCurve } from '@/lib/deepDig/series';

const H = 220;
const PAD = { left: 44, right: 64, top: 22, bottom: 22 };
const HOUR = 3_600_000;
/** 组的颜色与描述统计其他地方一致；随机时点用虚线，颜色之外再区分一层。 */
const LINE: Record<DeepDigRowGroup, string> = {
  positive: 'text-[#0B9F66] dark:text-[#0ECB81]',
  control: 'text-[#F6465D]',
  other: 'text-foreground/45',
  background: 'text-[#848E9C]',
};
const BAND = new Set<DeepDigRowGroup>(['positive', 'control']);
const finite = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
const HIDDEN_KEY = (featureId: string) => `veil.deepDig.seriesHidden:${featureId}`;
const ALL_GROUPS: readonly DeepDigRowGroup[] = ['positive', 'control', 'other', 'background'];
function readHidden(featureId: string): ReadonlySet<DeepDigRowGroup> {
  try {
    const raw = JSON.parse(localStorage.getItem(HIDDEN_KEY(featureId)) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((g): g is DeepDigRowGroup => ALL_GROUPS.includes(g)) : []);
  } catch {
    return new Set();
  }
}
function writeHidden(featureId: string, hidden: ReadonlySet<DeepDigRowGroup>) {
  try { localStorage.setItem(HIDDEN_KEY(featureId), JSON.stringify([...hidden])); } catch { /* 记不住只是下次要重选 */ }
}

function niceTicks(lo: number, hi: number, count = 4): number[] {
  const span = hi - lo || Math.abs(hi) || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}
const fmtTick = (v: number, step: number) => (step >= 1 ? v.toFixed(0) : v.toFixed(Math.min(4, Math.ceil(-Math.log10(step)))));
const fmtHours = formatSeriesOffset;

export function SeriesChart({ data, series, variable, onVariable, at = 0, onAt }: {
  /** 去掉删除行之后的数据。 */
  data: DeepDigData;
  series: DeepDigSeries | null;
  /** 选的变量；null = 公式最后一句。 */
  variable: string | null;
  onVariable: (name: string | null) => void;
  /** 选中的时刻（相对进场，毫秒）；0 = 进场。 */
  at?: number;
  onAt?: (offsetMs: number) => void;
}) {
  const def = data.definition;
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  const [hidden, setHiddenState] = useState<ReadonlySet<DeepDigRowGroup>>(() => readHidden(def.id));
  const setHidden = (next: ReadonlySet<DeepDigRowGroup>) => { setHiddenState(next); writeHidden(def.id, next); };
  const toggle = (g: DeepDigRowGroup) => { const n = new Set(hidden); if (n.has(g)) n.delete(g); else n.add(g); setHidden(n); };
  const [table, setTable] = useState(false);
  const hitRef = useRef<SVGRectElement>(null);
  const dragging = useRef(false);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.min(720, Math.floor(e.contentRect.width)))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const name = series ? (variable && series.names.includes(variable) ? variable : series.result) : null;
  const curves = useMemo(() => (series && name ? groupCurves(data.rows, series, name) : []), [data.rows, series, name]);

  if (!series) {
    return <div className="text-[11.5px] text-muted-foreground" data-testid="deep-dig-series-empty">这份数据还没有时间序列曲线：重新运行描述统计后显示（曲线存在本机）。</div>;
  }
  const isResult = name === series.result;
  const scale = def.scale;
  const unitText = `${scale !== 1 ? `× ${scale}` : ''}${isResult && def.unit ? `${scale !== 1 ? ' · ' : ''}${def.unit}` : ''}`;
  const shown = curves.filter(c => !hidden.has(c.group) && c.n > 0);
  const visible = curves.filter(c => !hidden.has(c.group));
  const offsets = series.offsets;
  const P = offsets.length;

  // 纵轴：可见各组的平均（实验 / 对照含阴影），按显示倍数
  const ys: number[] = [];
  for (const c of shown) c.mean.forEach((m, k) => {
    if (!finite(m)) return;
    const se = BAND.has(c.group) && finite(c.se[k]) ? c.se[k]! : 0;
    ys.push((m - se) * scale, (m + se) * scale);
  });
  let lo = ys.length ? Math.min(...ys) : -1;
  let hi = ys.length ? Math.max(...ys) : 1;
  if (lo === hi) { lo -= 1; hi += 1; }
  const ticks = niceTicks(lo, hi);
  lo = Math.min(lo, ticks[0]);
  hi = Math.max(hi, ticks.at(-1)!);
  const tickStep = ticks.length > 1 ? ticks[1] - ticks[0] : 1;
  const innerW = width - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (k: number) => PAD.left + (P > 1 ? (k / (P - 1)) * innerW : innerW / 2);
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * innerH;
  const zeroK = offsets.indexOf(0);
  // 窄屏刻度少一半，不挤
  const xTickEvery = Math.max(1, Math.round(P / (innerW < 360 ? 4 : 8)));
  const xTicks = offsets.map((o, k) => ({ o, k })).filter(({ o, k }) => o === 0 || (k % xTickEvery === 0 && Math.abs(k - zeroK) >= xTickEvery / 2) || k === P - 1);

  const path = (c: GroupCurve, f: (k: number) => number | null) => {
    let d = '';
    let pen = false;
    for (let k = 0; k < P; k++) {
      const v = f(k);
      if (!finite(v)) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${x(k).toFixed(1)},${y(v * scale).toFixed(1)}`;
      pen = true;
    }
    return d;
  };
  const band = (c: GroupCurve) => {
    const ks = c.mean.map((m, k) => k).filter(k => finite(c.mean[k]) && finite(c.se[k]));
    if (ks.length < 2) return '';
    const up = ks.map(k => `${x(k).toFixed(1)},${y((c.mean[k]! + c.se[k]!) * scale).toFixed(1)}`);
    const down = ks.slice().reverse().map(k => `${x(k).toFixed(1)},${y((c.mean[k]! - c.se[k]!) * scale).toFixed(1)}`);
    return `M${up.join('L')}L${down.join('L')}Z`;
  };
  // 右端的组名：按末端高度排开，不重叠
  const ends = shown
    .map(c => { const k = c.mean.map((m, i) => i).filter(i => finite(c.mean[i])).at(-1); return k == null ? null : { g: c.group, y: y(c.mean[k]! * scale) }; })
    .filter((e): e is { g: DeepDigRowGroup; y: number } => !!e)
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 12) ends[i].y = ends[i - 1].y + 12;
  // 排到图底以下的往上收，不压横轴刻度
  const bottom = PAD.top + innerH;
  for (let i = ends.length - 1; i >= 0; i--) {
    const limit = i === ends.length - 1 ? bottom : ends[i + 1].y - 12;
    if (ends[i].y > limit) ends[i].y = limit;
  }

  const kAt = (clientX: number) => {
    if (!Number.isFinite(clientX)) return null;
    const rect = hitRef.current?.getBoundingClientRect();
    if (!rect || !(rect.width > 0)) return null;
    const px = ((clientX - rect.left) / rect.width) * innerW;
    return Math.max(0, Math.min(P - 1, Math.round((px / innerW) * (P - 1))));
  };
  const onMove = (e: React.MouseEvent<SVGRectElement>) => setHover(kAt(e.clientX));
  // 选中的时刻：拖动竖线（图里按下或拖顶上的标签）、← / → 一格一格移
  const atK = offsets.indexOf(at);
  const selK = atK >= 0 ? atK : zeroK;
  const pick = (k: number | null) => { if (k != null && onAt && offsets[k] !== at) onAt(offsets[k]); };
  const startDrag = (e: React.PointerEvent<SVGElement>) => {
    if (!onAt || (e.button != null && e.button !== 0)) return; // 只认左键 / 触摸
    dragging.current = true;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 不支持捕获时拖出图外就停 */ }
    pick(kAt(e.clientX));
  };
  const onDrag = (e: React.PointerEvent<SVGElement>) => { if (dragging.current) { const k = kAt(e.clientX); setHover(k); pick(k); } };
  const endDrag = () => { dragging.current = false; };
  const onKey = (e: React.KeyboardEvent) => {
    const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (e.key === 'Home') { e.preventDefault(); pick(zeroK); return; }
    if (!step) return;
    e.preventDefault();
    pick(Math.max(0, Math.min(P - 1, selK + step)));
  };
  const selLabel = fmtHours(offsets[selK] ?? 0);
  const pillW = Math.max(30, selLabel.length * 7 + 14);
  const pillX = Math.max(PAD.left - pillW / 2, Math.min(PAD.left + innerW - pillW / 2, x(selK) - pillW / 2));
  const hk = hover;
  const tableKs = offsets.map((o, k) => ({ o, k })).filter(({ o }) => o % (6 * HOUR) === 0 || o === offsets[0] || o === offsets[P - 1]);

  return (
    <div className="max-w-[720px] space-y-2 text-[11.5px]" data-testid="deep-dig-series">
      <div className="flex gap-1.5">
        <span className="w-[32px] shrink-0 pt-[5px] leading-none text-muted-foreground">变量</span>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5" role="radiogroup" aria-label="曲线变量">
          {series.names.map(n => {
            const active = n === name;
            return (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={active}
                data-testid={`deep-dig-series-var-${n}`}
                onClick={() => onVariable(n === series.result ? null : n)}
                className={cn('inline-flex h-6 items-center gap-1 rounded-full border px-2 font-mono transition-colors',
                  active ? 'border-foreground/25 bg-card font-medium text-foreground' : 'border-border/70 text-muted-foreground hover:text-foreground')}
              >
                {active && <Check className="h-3 w-3" />}{n}
                {n === series.result && <span className="font-sans text-[10.5px] font-normal text-muted-foreground">结果</span>}
              </button>
            );
          })}
          <span className="text-[11px] text-muted-foreground" data-testid="deep-dig-series-unit">{name}{isResult ? '（公式最后一句）' : ''}{unitText ? ` ${unitText}` : ''}</span>
        </div>
      </div>

      <div className="flex gap-1.5" data-testid="deep-dig-series-legend">
        <span className="w-[32px] shrink-0 pt-[5px] leading-none text-muted-foreground">组别</span>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5" role="group" aria-label="曲线组别">
          {curves.map(c => {
            const on = !hidden.has(c.group);
            return (
              <button
                key={c.group}
                type="button"
                role="checkbox"
                aria-checked={on}
                title={on ? '点一下从图里去掉' : '点一下加回图里'}
                onClick={() => toggle(c.group)}
                data-testid={`deep-dig-series-legend-${c.group}`}
                className={cn('inline-flex h-6 items-center gap-1.5 rounded-full border px-2 transition-colors',
                  on ? 'border-foreground/25 bg-card text-foreground' : 'border-dashed border-border/70 text-muted-foreground/70 hover:text-foreground')}
              >
                {on ? <Check className="h-3 w-3" /> : null}
                <svg width="14" height="6" aria-hidden="true" className={cn(LINE[c.group], !on && 'opacity-40')}>
                  <line x1="1" y1="3" x2="13" y2="3" stroke="currentColor" strokeWidth="2" strokeDasharray={c.group === 'background' ? '3 2' : undefined} strokeLinecap="round" />
                </svg>
                {groupLabel(c.group, def.source)}<span className="font-mono tabular-nums text-muted-foreground">{c.n}</span>
              </button>
            );
          })}
          {hidden.size > 0 && (
            <button type="button" onClick={() => setHidden(new Set())} className="text-[11px] text-muted-foreground hover:text-foreground" data-testid="deep-dig-series-groups-all">全部显示</button>
          )}
          <button type="button" onClick={() => setTable(t => !t)} className="text-[11px] text-muted-foreground hover:text-foreground" data-testid="deep-dig-series-table-toggle">
            {table ? '看曲线' : '看数字'}
          </button>
          {onAt && at !== 0 && (
            <button type="button" onClick={() => onAt(0)} className="text-[11px] text-[#C27C0E] hover:text-foreground dark:text-[#F59E0B]" data-testid="deep-dig-series-at-reset">回到进场</button>
          )}
        </div>
      </div>

      <div ref={boxRef} className="relative w-full">
        {visible.length === 0 ? (
          <div className="py-6 text-[11.5px] text-muted-foreground" data-testid="deep-dig-series-none">没有选组：在上面「组别」里点一组加回来。</div>
        ) : table ? (
          <div className="overflow-x-auto">
            <table className="text-[11px]" data-testid="deep-dig-series-table">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="py-1 pr-3 text-left font-normal">组</th>
                  {tableKs.map(({ o }) => <th key={o} className="whitespace-nowrap py-1 pr-3 text-right font-normal">{fmtHours(o)}</th>)}
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {visible.map(c => (
                  <tr key={c.group} className="border-t border-border/40">
                    <td className={cn('whitespace-nowrap py-1 pr-3 font-sans', LINE[c.group])}>{groupLabel(c.group, def.source)}</td>
                    {tableKs.map(({ k }) => <td key={k} className="py-1 pr-3 text-right">{finite(c.mean[k]) ? (c.mean[k]! * scale).toFixed(2) : '—'}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <>
            <svg width={width} height={H} role="img" aria-label={`各组 ${name} 在进场前后的平均`} className="block max-w-full overflow-visible" data-testid="deep-dig-series-chart">
              {ticks.map(t => (
                <g key={t}>
                  <line x1={PAD.left} x2={PAD.left + innerW} y1={y(t)} y2={y(t)} className={t === 0 ? 'stroke-foreground/30' : 'stroke-border/60'} strokeWidth={1} />
                  <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground font-mono text-[10px]">{fmtTick(t, tickStep)}</text>
                </g>
              ))}
              {xTicks.map(({ o, k }) => (
                <text key={o} x={x(k)} y={H - 6} textAnchor={k === P - 1 ? 'end' : 'middle'} className={cn('font-mono text-[10px]', o === 0 ? 'fill-[#C27C0E] dark:fill-[#F59E0B]' : 'fill-muted-foreground')}>{fmtHours(o)}</text>
              ))}
              {zeroK >= 0 && <line x1={x(zeroK)} x2={x(zeroK)} y1={PAD.top} y2={PAD.top + innerH} strokeDasharray="3 3" className="stroke-[#F59E0B]" strokeWidth={1} />}
              {shown.filter(c => BAND.has(c.group)).map(c => <path key={`b-${c.group}`} d={band(c)} className={LINE[c.group]} fill="currentColor" fillOpacity={0.12} stroke="none" />)}
              {shown.map(c => (
                <path key={c.group} d={path(c, k => c.mean[k])} className={LINE[c.group]} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
                  strokeDasharray={c.group === 'background' ? '4 3' : undefined} data-testid={`deep-dig-series-line-${c.group}`} />
              ))}
              {ends.map(e => (
                <text key={e.g} x={PAD.left + innerW + 6} y={e.y} dy="0.32em" className="fill-foreground/80 text-[10.5px]">{groupLabel(e.g, def.source)}</text>
              ))}
              {onAt && selK >= 0 && (
                <g data-testid="deep-dig-series-at">
                  <line x1={x(selK)} x2={x(selK)} y1={PAD.top} y2={PAD.top + innerH} className="stroke-[#F59E0B]" strokeWidth={1.5} pointerEvents="none" />
                  <g
                    role="slider"
                    tabIndex={0}
                    aria-label="选取时刻（拖动或按 ← →，Home 回到进场）"
                    aria-valuemin={offsets[0] / HOUR}
                    aria-valuemax={offsets[P - 1] / HOUR}
                    aria-valuenow={(offsets[selK] ?? 0) / HOUR}
                    aria-valuetext={selLabel}
                    data-testid="deep-dig-series-at-handle"
                    onKeyDown={onKey}
                    onPointerDown={startDrag}
                    onPointerMove={onDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    className="cursor-ew-resize outline-none [&:focus-visible>rect]:stroke-foreground"
                    style={{ touchAction: 'none' }}
                  >
                    <rect x={pillX} y={3} width={pillW} height={16} rx={8} className="fill-[#F59E0B]" stroke="transparent" strokeWidth={1.5} />
                    <text x={pillX + pillW / 2} y={11} dy="0.35em" textAnchor="middle" className="pointer-events-none select-none fill-white font-mono text-[10px] font-medium">{selLabel}</text>
                  </g>
                </g>
              )}
              {hk != null && (
                <g pointerEvents="none">
                  <line x1={x(hk)} x2={x(hk)} y1={PAD.top} y2={PAD.top + innerH} className="stroke-foreground/40" strokeWidth={1} />
                  {shown.map(c => finite(c.mean[hk]) && (
                    <circle key={c.group} cx={x(hk)} cy={y(c.mean[hk]! * scale)} r={4} className={cn(LINE[c.group], 'stroke-card')} fill="currentColor" strokeWidth={2} />
                  ))}
                </g>
              )}
              <rect
                ref={hitRef} x={PAD.left} y={PAD.top} width={innerW} height={innerH} fill="transparent"
                onMouseMove={onMove} onMouseLeave={() => { if (!dragging.current) setHover(null); }}
                onPointerDown={startDrag} onPointerMove={onDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
                className={onAt ? 'cursor-ew-resize' : undefined}
                style={onAt ? { touchAction: 'pan-y' } : undefined}
                data-testid="deep-dig-series-hit"
              />
            </svg>
            {hk != null && (
              <div
                className="pointer-events-none absolute top-1 z-10 min-w-[140px] rounded-md border border-border bg-card px-2 py-1.5 text-[11px] shadow-sm"
                style={x(hk) > width / 2 ? { right: width - x(hk) + 10 } : { left: x(hk) + 10 }}
                data-testid="deep-dig-series-tooltip"
              >
                <div className="mb-0.5 text-muted-foreground">{fmtHours(offsets[hk])}{offsets[hk] !== 0 ? (offsets[hk] < 0 ? '（进场前）' : '（进场后）') : ''}</div>
                {shown.map(c => (
                  <div key={c.group} className="flex items-center justify-between gap-3">
                    <span className={LINE[c.group]}>{groupLabel(c.group, def.source)}</span>
                    <span className="font-mono tabular-nums text-foreground">{finite(c.mean[hk]) ? (c.mean[hk]! * scale).toFixed(2) : '—'}<span className="ml-1 text-muted-foreground">n {c.count[hk]}</span></span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        每个时点取那一刻之前最后一根已收盘 K 线上的值，再按组平均；阴影 = 平均 ± 1 个标准误。{onAt ? '拖动橘黄竖线（或点图里任一处）选时刻，上面的分组表跟着换成那一刻的值。' : ''}进场后的部分只作描述，特征值与检验只用进场前的数据。
      </p>
    </div>
  );
}
