import { Progress } from '@/components/ui/progress';
import type { DecisionAccuracyResult } from '@/lib/campaignAnalysis';

interface Props {
  result: DecisionAccuracyResult;
}

const verdictClass = (verdict: string) => {
  if (verdict.includes('精准') || verdict.includes('充裕') || verdict.includes('高效')) return 'bg-[#0ECB81]/15 text-[#0ECB81]';
  if (verdict.includes('小幅') || verdict.includes('险些') || verdict.includes('部分')) return 'bg-[#F0B90B]/15 text-[#F0B90B]';
  if (verdict.includes('过早')) return 'bg-[#F6465D]/10 text-[#F6465D]';
  if (verdict.includes('深度')) return 'bg-[#F6465D]/20 text-[#F6465D]';
  return 'bg-muted text-muted-foreground';
};

export function DecisionAccuracyPanel({ result }: Props) {
  const payoffRatioVerdict = result.profit_capture_ratio >= 85
    ? { text: '盈亏比充足', className: 'text-[#0ECB81]' }
    : result.profit_capture_ratio >= 60
      ? { text: '盈亏比一般', className: 'text-muted-foreground' }
      : { text: '盈亏比偏低', className: 'text-[#F6465D]' };

  return (
    <div className="bg-card border border-border rounded p-4 space-y-4">
      <section className="space-y-2">
        <div>
          <div className="text-[12px] font-medium">对冲位选择精度</div>
          <div className="text-[10px] text-muted-foreground">对冲触发后市场实际下探深度</div>
        </div>
        <div className="space-y-2">
          {result.hedge_precision.length === 0 ? (
            <div className="text-[11px] text-muted-foreground">数据不足</div>
          ) : result.hedge_precision.map(item => (
            <div key={item.leg_id} className="border border-border rounded p-2 text-[11px] space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="font-mono">{item.role}</div>
                <span className={`px-2 py-0.5 rounded text-[10px] ${verdictClass(item.verdict)}`}>{item.verdict}</span>
              </div>
              {item.was_triggered ? (
                <div className="font-mono text-muted-foreground">
                  触发价 {item.trigger_price.toFixed(4)} → 后续极值 {(item.market_extreme_after_trigger ?? 0).toFixed(4)} → 超出 {(item.excess_depth_pct ?? 0).toFixed(2)}%
                </div>
              ) : (
                <div className="font-mono text-muted-foreground">
                  触发价 {item.trigger_price.toFixed(4)} · {(item.closest_approach_pct ?? 0).toFixed(2)}% 距触发
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <div>
          <div className="text-[12px] font-medium">镜像止盈捕获率</div>
          <div className="text-[10px] text-muted-foreground">TP 触发后市场继续走了多远</div>
        </div>
        {result.mirror_tp_capture ? (
          <div className="border border-border rounded p-2 text-[11px] space-y-1">
            <div className="flex items-center justify-between gap-2">
              <div className="font-mono">TP {result.mirror_tp_capture.tp_price.toFixed(4)}</div>
              <span className={`px-2 py-0.5 rounded text-[10px] ${verdictClass(result.mirror_tp_capture.verdict)}`}>
                {result.mirror_tp_capture.verdict}
              </span>
            </div>
            {result.mirror_tp_capture.was_triggered ? (
              <div className="font-mono text-muted-foreground">
                TP 价 {result.mirror_tp_capture.tp_price.toFixed(4)} → 后续极值 {(result.mirror_tp_capture.market_extreme_after_trigger ?? 0).toFixed(4)} → 让利 {(result.mirror_tp_capture.foregone_profit_pct ?? 0).toFixed(2)}%
              </div>
            ) : (
              <div className="font-mono text-muted-foreground">
                未触发 · 最近距离 {(result.mirror_tp_capture.closest_approach_pct ?? 0).toFixed(2)}%
              </div>
            )}
          </div>
        ) : (
          <div className="text-[11px] text-muted-foreground">—</div>
        )}
      </section>

      <section className="space-y-2">
        <div>
          <div className="text-[12px] font-medium">盈亏比</div>
          <div className="text-[10px] text-muted-foreground">已实现盈亏 ÷ 最初预期最大亏损额</div>
        </div>
        <div className="font-mono text-[18px]">{result.profit_capture_ratio.toFixed(1)}%</div>
        <Progress value={result.profit_capture_ratio} className="h-2 bg-muted [&>div]:bg-[#F0B90B]" />
        <div className={`text-[11px] ${payoffRatioVerdict.className}`}>
          {payoffRatioVerdict.text}
          {result.profit_capture_ratio < 60 ? ' · 实际盈亏相对初始风险偏低' : ''}
        </div>
      </section>
    </div>
  );
}
