import {DBL5_GUARD_DEFAULTS,DBL5_GUARD_VERSION,type Dbl5GuardConfig} from '@/lib/dbl5m';

/** Read-only explanation of advanceGuard; never part of the editable feature formula or its identity. */
export function Dbl5GuardDefinition({config={}}:{config?:Dbl5GuardConfig}) {
  const defaults=DBL5_GUARD_DEFAULTS;
  const a=config.guard_trend_atr??defaults.guard_trend_atr,b=config.guard_range_atr??defaults.guard_range_atr;
  const closes=config.guard_range_closes??defaults.guard_range_closes;
  const formula=[
    'D、U = 本次新确认箱体的下轨、上轨；D前、U前 = 前一个所选箱体边界',
    'G前 = 原防守线；F = 当前震荡区保留的最低箱底；δ = 标的最小价格单位',
    '向下取整价(x) = δ × floor(x / δ)',
    '',
    'TR = max(H − L, |H − C前|, |L − C前|)；没有前收盘时 TR = H − L',
    `ATR(${defaults.atr_period})：前 ${defaults.atr_period} 个有效 TR 逐步取均值；此后 ATR = (${defaults.atr_period-1} × ATR前 + TR) / ${defaults.atr_period}`,
    '',
    '重叠距离 O = min(U, U前) − max(D, D前)',
    `上涨判定：D > D前，且 O ≤ ${defaults.overlap} × min(U − D, U前 − D前)`,
    `上涨期：G = max(G前, 向下取整价(D − ${a} × ATR))`,
    `首次建线：按震荡期，F = D，G = 向下取整价(F − ${b} × ATR)`,
    `从上涨转震荡：F = min(D前, D)，G = 向下取整价(F − ${b} × ATR)`,
    `已在震荡期：仅新箱底 D < F 时，令 F = D，G = 向下取整价(F − ${b} × ATR)；否则保留原线`,
  ].join('\n');
  return <section className="max-w-[960px] space-y-2 rounded-md border border-border/60 bg-muted/20 p-3 text-[11.5px] leading-relaxed" data-testid="dbl5-guard-definition">
    <div className="flex flex-wrap items-baseline gap-2"><h3 className="text-[13px] font-medium">防守线</h3><span className="font-mono text-[10.5px] text-muted-foreground">{DBL5_GUARD_VERSION}</span></div>
    <p><strong>定义：</strong>叠在已确认 DBL-5 箱体上的价格参考线，用 ATR 为箱底留出冗余，并区分上涨与震荡。上涨期画蓝色实线，同一上涨段只升不降；震荡期画蓝色虚线，区间内的小箱体不会把线抬高。首个可用箱体按震荡期建线。</p>
    <p><strong>当前参数：</strong>已收盘 5 分钟 K 线；ATR({defaults.atr_period})；上涨冗余 a＝{a}，震荡冗余 b＝{b}；上涨期 {defaults.guard_trend_closes} 根、震荡期连续 {closes} 根收盘严格低于原线才确认跌破。</p>
    <details open><summary className="cursor-pointer font-medium">防守线公式</summary><pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded bg-muted/60 p-2.5 font-mono text-[11px] leading-relaxed" data-testid="dbl5-guard-formula">{formula}</pre></details>
    <p><strong>更新：</strong>ATR 至少有 {defaults.atr_period} 根有效样本，且出现新确认的所选箱体事件时，才按上式建线或更新；ATR 每根计算，已有线不会仅因 ATR 变化而移动。价格按标的 tick 向下取整，结果不足一个 tick 时清空。</p>
    <p><strong>跌破与重建：</strong>影线越线或收盘恰好等于线不算跌破；收盘回到原线或上方，连续计数归零。箱体自身被影线破坏或到期，不会单独清掉已有防守线。每根已收盘 K 线先检查旧线是否跌破，再处理新箱体，所以同根出现新箱体时可以重新建线。数据缺口或非法行情会断开防守线；ATR 累计状态按原实现保留，前收盘衔接重置。</p>
    <p className="text-muted-foreground">以上是现有原生防守线的定义与计算说明，纳入生成图片。交易方案中的 K 触价、卖出确认和加仓定量，仍按该方案已保存的执行口径运行。</p>
  </section>;
}
