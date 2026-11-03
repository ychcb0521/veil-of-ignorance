/**
 * 【用户要求】2026-11-03 旧模板复原：旧引擎方案的加仓设置按 10-31 的原始参数显示，不经过新版编辑器换算成箱体。
 * （新版编辑器打开旧方案会把每次加仓改写成 DBL-5 箱体，保存后就换了算法——这正是 11-03 重跑结果不同的原因。）
 */
import { FishQualityInfo } from '@/components/FishQualityModule';
import type { QualityGroup } from '@/lib/fish/quality';
import { LEGACY_ENGINE_COMMIT, LEGACY_ENGINE_LABEL, legacyAdditionRows } from '@/lib/fish/qualityLegacyEngine';

export function LegacyEngineNote() {
  return <div className="flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/[0.06] px-2 py-1.5 text-[11px]" data-testid="quality-legacy-engine-note">
    <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">{LEGACY_ENGINE_LABEL}</span>
    <span className="text-muted-foreground">只读 · 按 10-31 的引擎原样复算</span>
    <FishQualityInfo label="旧引擎说明">
      <p>这套方案来自 2026-11-01 之前的战役。那时的加仓规则与现在不同：</p>
      <ul className="list-disc space-y-0.5 pl-4">
        <li>加仓时机：自选指标达标，且现价 T ≥ 成本线 S＋n×ATR（入场距离）。</li>
        <li>止损 K＝T−m×ATR。</li>
        <li>涨幅门槛相对持仓均价。</li>
      </ul>
      <p>11-01 起改成箱体位置、删掉入场距离、涨幅门槛改为相对成本线 S，所以用现在的引擎重跑会得到完全不同的结果。</p>
      <p>这套方案固定用冻结的 10-31 引擎（提交 {LEGACY_ENGINE_COMMIT}）计算，与原战役逐位一致。除名称外不能修改；要试新规则，请另建方案。</p>
    </FishQualityInfo>
  </div>;
}

export function LegacyAdditionView({ plan }: { plan: QualityGroup }) {
  const a = plan.addition, rows = legacyAdditionRows(a);
  return <section className="space-y-2 rounded-lg border border-border/60 p-3" data-testid="quality-legacy-addition">
    <div className="flex items-center gap-1.5"><h4 className="text-xs font-medium">③ 加仓细节</h4><span className="text-[10px] text-muted-foreground">{LEGACY_ENGINE_LABEL}的设置</span></div>
    {!rows.length ? <p className="text-[11px] text-muted-foreground">未启用加仓</p> : <>
      <p className="text-[11px] text-muted-foreground">最多加仓 {a?.maxRounds ?? rows.length} 次 · 半仓镜像后按余仓平衡定量 · 碰到 K 卖出</p>
      <table className="w-full text-[11px] tabular-nums">
        <thead><tr className="text-left text-[10px] text-muted-foreground"><th className="py-0.5 pr-2 font-normal">次</th><th className="pr-2 font-normal">加仓条件</th><th className="pr-2 font-normal">入场距离</th><th className="pr-2 font-normal">止损 K</th><th className="font-normal">涨幅门槛</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.round} className="border-t border-border/40" data-testid={`quality-legacy-round-${r.round}`}>
          <td className="py-0.5 pr-2 text-muted-foreground">{r.round}</td>
          <td className="pr-2">{r.trigger}</td>
          <td className="pr-2 whitespace-nowrap">T ≥ S＋{r.entryBufferAtr} ATR</td>
          <td className="pr-2 whitespace-nowrap">K＝T−{r.supportOffsetAtr} ATR</td>
          <td className="whitespace-nowrap">{r.minGainPct == null ? '—' : `相对持仓均价 ≥ ${r.minGainPct}%`}</td>
        </tr>)}</tbody>
      </table>
    </>}
  </section>;
}
