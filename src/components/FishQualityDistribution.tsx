import { qualityHistogram, type QualityDistributionMetric, type QualityDistributionSeries } from '@/lib/fish/qualityDistribution';

const fmt = (n: number | null) => n == null ? '—' : `${n > 0 ? '+' : ''}${Number(n.toFixed(2))}%`;
export function FishQualityDistribution({ series, metric, onMetricChange }: { series: QualityDistributionSeries[]; metric: QualityDistributionMetric; onMetricChange: (metric: QualityDistributionMetric) => void }) {
  const data = qualityHistogram(series);
  const left = 35, top = 15, width = 430, height = 135, bottom = top + height;
  return <div data-testid="quality-distribution-chart" className="space-y-2 border-b border-border/40 pb-2">
    <div className="flex flex-wrap items-center justify-between gap-2 text-[10.5px]"><span className="font-medium">{metric === 'returnPct' ? '收益率分布' : '最大涨幅分布'}</span><select aria-label="分布图指标" className="h-6 rounded bg-muted/60 px-1.5 text-muted-foreground" value={metric} onChange={e => onMetricChange(e.target.value as QualityDistributionMetric)}><option value="returnPct">收益率</option><option value="peakPct">最大涨幅</option></select></div>
    {!data ? <p className="py-3 text-center text-[10px] text-muted-foreground">暂无共同有效结果。已设置的卖出方案使用同一批样本；缺数据和待评估不计为 0。</p> : <div className="grid gap-2 md:grid-cols-2">{data.plots.map(plot => {
      const x = (v: number) => left + (v - data.min) / (data.max - data.min) * width;
      const y = (n: number) => bottom - (plot.n ? n / plot.n / data.top : 0) * height;
      const points = plot.bins.map((n, i) => [x(data.min + (i + .5) * data.step), y(n)]);
      const path = points.length ? `M ${left} ${bottom} L ${points[0].join(' ')} ` + points.slice(1).map(p => `L ${p.join(' ')}`).join(' ') + ` L ${left + width} ${bottom}` : '';
      return <figure key={plot.id} className="min-w-0 rounded border border-border/50 bg-background/60 px-2 pt-2" data-testid="quality-histogram">
        <figcaption className="flex flex-wrap items-center justify-between gap-1 text-[10px]"><span className="font-medium">{plot.label}</span><span className="font-mono text-muted-foreground">{plot.n} 条 · 均值 {fmt(plot.mean)} · 中位数 {fmt(plot.median)}</span></figcaption>
        <svg viewBox="0 0 490 180" className="w-full" role="img" aria-label={`${plot.label} ${metric === 'returnPct' ? '收益率' : '最大涨幅'}分布，${plot.n}条有效样本`}>
          <title>实际样本直方图与频率曲线，不假定正态分布。横轴：涨跌幅%；纵轴：样本占比。</title>
          {[0, .5, 1].map(fraction => <g key={fraction}><line x1={left} x2={left + width} y1={bottom - fraction * height} y2={bottom - fraction * height} className="stroke-border" strokeDasharray={fraction ? '3 4' : undefined}/><text x={left - 5} y={bottom - fraction * height + 3} textAnchor="end" className="fill-muted-foreground text-[8px]">{Math.round(data.top * fraction * 100)}%</text></g>)}
          {plot.bins.map((n, i) => <rect key={i} x={x(data.min + i * data.step) + 1} y={y(n)} width={Math.max(1, width / data.count - 2)} height={bottom - y(n)} className="fill-primary/25"><title>{fmt(data.min + i * data.step)}～{fmt(data.min + (i + 1) * data.step)}：{n} 条（{plot.n ? (n / plot.n * 100).toFixed(1) : 0}%）</title></rect>)}
          {data.min < 0 && data.max > 0 && <line x1={x(0)} x2={x(0)} y1={top} y2={bottom} className="stroke-muted-foreground/50" strokeDasharray="3 3"/>}
          <path d={path} fill="none" className="stroke-primary" strokeWidth="1.7" strokeLinejoin="round"/>
          {plot.mean != null && <line x1={x(plot.mean)} x2={x(plot.mean)} y1={top} y2={bottom} className="stroke-foreground/40" strokeDasharray="2 3"><title>均值 {fmt(plot.mean)}</title></line>}
          {[data.min, (data.min + data.max) / 2, data.max].map(value => <text key={value} x={x(value)} y={bottom + 16} textAnchor="middle" className="fill-muted-foreground text-[8px]">{fmt(value)}</text>)}
        </svg>
      </figure>;
    })}</div>}
    <p className="text-[9px] text-muted-foreground">横轴为涨跌幅，纵轴为样本占比；各图使用相同区间。折线连接实际频数，不假定收益服从正态分布。</p>
  </div>;
}
