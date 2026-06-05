/**
 * 结构成熟度 · 建模台。
 *
 * 和错题集同一份预测误差，换一个切面：不按「错误种类」切，按「结构（edge 源头）」切。
 * 每个结构显示它的预测-误差画像（校准 / Brier / R 兑现 / 误差趋势 / 主导误差），
 * 给出成熟度档位：混沌 → 成形中 → 成熟。误差低且稳的结构「毕业」成过滤器 ——
 * 这是「错误 → 拦截规则」负向回路的正向镜像：把建好的结构挑出来复用，去捕捉匹配标的。
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  Boxes,
  ChevronDown,
  ChevronRight,
  Filter,
  Minus,
} from 'lucide-react';
import type { TradeJournal } from '@/types/journal';
import {
  aggregateStructureMaturity,
  type MaturityTier,
  type StructureMaturity,
} from '@/lib/structureMaturity';
import { ERROR_FAMILY_META } from '@/lib/errorTypes';
import { EDGE_SOURCE_OPTIONS } from '@/lib/edgeSource';

const EDGE_DEF = new Map(EDGE_SOURCE_OPTIONS.map(o => [o.id, o]));

const TIER_META: Record<MaturityTier, { label: string; accent: string; chip: string }> = {
  mature: {
    label: '成熟 · 可作过滤器',
    accent: 'text-[#0ECB81]',
    chip: 'border-[#0ECB81]/30 bg-[#0ECB81]/10 text-[#0ECB81]',
  },
  forming: {
    label: '成形中',
    accent: 'text-[#D89B00]',
    chip: 'border-[#F0B90B]/30 bg-[#F0B90B]/10 text-[#D89B00]',
  },
  chaos: {
    label: '混沌',
    accent: 'text-muted-foreground',
    chip: 'border-border bg-muted text-muted-foreground',
  },
};

/** 误差趋势胶囊：下降=误差在收敛(绿)，上升=误差在发散(红)，持平(灰)；样本不足不渲染。 */
function ErrorTrendPill({ trend }: { trend: number | null }) {
  if (trend == null) return null;
  const pp = Math.round(trend * 100);
  if (pp < -2) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[11px] text-[#0ECB81]" title="误差比早期更小 —— 在收敛、在建模">
        <ArrowDown className="h-3 w-3" /> 收敛 {pp}pp
      </span>
    );
  }
  if (pp > 5) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[11px] text-[#F6465D]" title="误差比早期更大 —— 在发散">
        <ArrowUp className="h-3 w-3" /> 发散 +{pp}pp
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground" title="误差与早期持平">
      <Minus className="h-3 w-3" /> 持平
    </span>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/60 px-2.5 py-1.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`mt-0.5 font-mono text-[13px] leading-tight ${tone ?? 'text-foreground'}`}>{value}</div>
    </div>
  );
}

function brierTone(b: number | null): string {
  if (b == null) return 'text-muted-foreground';
  if (b <= 0.18) return 'text-[#0ECB81]';
  if (b <= 0.25) return 'text-[#D89B00]';
  return 'text-[#F6465D]';
}

function StructureCard({ s }: { s: StructureMaturity }) {
  const [open, setOpen] = useState(false);
  const tier = TIER_META[s.tier];
  const fam = s.dominantError ? ERROR_FAMILY_META[s.dominantError.family] : null;

  const winText =
    s.avgPredictedWinPct != null && s.actualWinRatePct != null
      ? `${s.avgPredictedWinPct.toFixed(0)}% → ${s.actualWinRatePct.toFixed(0)}%`
      : '—';
  const winTone =
    s.winGapPP == null
      ? undefined
      : s.winGapPP > 8
        ? 'text-[#F6465D]'
        : s.winGapPP < -8
          ? 'text-[#0ECB81]'
          : undefined;

  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/40"
      >
        <div className="flex min-w-0 items-center gap-2">
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate text-[13px] font-medium text-foreground">{s.label}</span>
          <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${tier.chip}`}>
            {s.tier === 'mature' && <Filter className="mr-0.5 inline h-2.5 w-2.5" />}
            {tier.label}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="font-mono text-[12px] text-muted-foreground">
            {s.trades} 笔
          </span>
          <ErrorTrendPill trend={s.errorTrend} />
        </div>
      </button>

      <div className="px-4 pb-3 pl-10">
        <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4">
          <Metric label="预测 → 实际胜率" value={winText} tone={winTone} />
          <Metric label="Brier（越低越准）" value={s.brier != null ? s.brier.toFixed(2) : '—'} tone={brierTone(s.brier)} />
          <Metric
            label="R 兑现缺口"
            value={s.rShortfall != null ? `${s.rShortfall >= 0 ? '+' : ''}${s.rShortfall.toFixed(1)}R` : '—'}
            tone={s.rShortfall != null && s.rShortfall > 0.5 ? 'text-[#F6465D]' : undefined}
          />
          <Metric label="校准样本" value={`${s.calibratedN}/${s.trades}`} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className={`text-[11px] ${tier.accent}`}>{s.tierReason}</span>
          {s.judgedDeaths > 0 && (
            <span
              className="inline-flex items-center gap-1.5 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px]"
              title="止 · 死法门：这个结构怎么死的。前门=按预案触发并止损；晚门=看见了却晚动；后门=死法不在预案内"
            >
              <span className="text-muted-foreground">止·死法</span>
              {s.deathFront > 0 && <span className="text-[#0ECB81]">前门 {s.deathFront}</span>}
              {s.deathLate > 0 && <span className="text-[#D89B00]">晚门 {s.deathLate}</span>}
              {s.deathBack > 0 && <span className="text-[#F6465D]">后门 {s.deathBack}</span>}
            </span>
          )}
          {s.dominantError && fam && (
            <span className="inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              最常栽：{fam.label} · {s.dominantError.title} ×{s.dominantError.count}
            </span>
          )}
        </div>
      </div>

      {open && (
        <div className="space-y-1.5 border-t border-border/60 px-4 py-2.5">
          <div className="text-[10px] text-muted-foreground">押注证据 · {s.journals.length} 笔（最近在前）</div>
          {s.journals.map(j => {
            const dateStr = new Date(j.pre_simulated_time).toLocaleDateString('zh-CN');
            return (
              <Link
                key={j.id}
                to={`/journal/${j.id}`}
                className="flex items-center gap-2 rounded-md border border-border/60 bg-background/60 px-3 py-1.5 text-[11px] hover:underline"
              >
                <span className="font-mono text-foreground">{j.symbol}</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">{dateStr}</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-foreground/80">
                  预测 {j.pre_calibration_win_pct != null ? `${Math.round(j.pre_calibration_win_pct)}%` : '—'}
                </span>
                <span className="text-muted-foreground">→</span>
                <span
                  className={
                    j.post_outcome === 'win'
                      ? 'text-[#0ECB81]'
                      : j.post_outcome === 'loss'
                        ? 'text-[#F6465D]'
                        : 'text-muted-foreground'
                  }
                >
                  {j.post_outcome === 'win' ? '赢' : j.post_outcome === 'loss' ? '亏' : '保本'}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 成熟结构作为「过滤器」：用 edge 现成的模型模板（等什么 / 好位置 / 坏位置）当捕捉清单。 */
function MaturedFilterCard({ s }: { s: StructureMaturity }) {
  const def = EDGE_DEF.get(s.edge);
  return (
    <div className="rounded-lg border border-[#0ECB81]/30 bg-[#0ECB81]/5 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Filter className="h-3.5 w-3.5 text-[#0ECB81]" />
          <span className="text-[12px] font-medium text-foreground">{s.label}</span>
        </div>
        <span className="font-mono text-[10px] text-[#0ECB81]">
          Brier {s.brier != null ? s.brier.toFixed(2) : '—'} · {s.trades} 笔
        </span>
      </div>
      {def && (
        <div className="mt-1.5 space-y-0.5 text-[10px] leading-relaxed text-muted-foreground">
          <div><span className="text-[#0ECB81]">等：</span>{def.waitForEntry}</div>
          <div><span className="text-[#0ECB81]">好位置：</span>{def.goodLocation}</div>
          <div><span className="text-[#F6465D]">不做：</span>{def.badLocation}</div>
        </div>
      )}
    </div>
  );
}

export function StructureMaturityView({ journals }: { journals: TradeJournal[] }) {
  const { structures, matured } = useMemo(() => aggregateStructureMaturity(journals), [journals]);

  if (structures.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-10 text-center">
        <Boxes className="mx-auto mb-3 h-7 w-7 text-muted-foreground" />
        <div className="text-[13px] font-medium">还没有可评估的结构</div>
        <div className="mx-auto mt-1 max-w-md text-[12px] text-muted-foreground">
          完成带 edge 源头的真实交易复盘后，系统会把「下单时的预测」与「实盘走出来的真实趋势」之间的误差，
          按结构归类。误差做多了，就能看清哪个结构已经建好、稳到可以当过滤器。
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 我的成熟结构（过滤器） */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-1 flex items-center gap-2">
          <Filter className="h-4 w-4 text-[#0ECB81]" />
          <h2 className="text-[13px] font-semibold">我的成熟结构 · 可作过滤器</h2>
          <span className="text-[11px] text-muted-foreground">· {matured.length} 个已毕业</span>
        </div>
        <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
          你押的是一个结构闭环（正 · 反 · 止），不是一个期望值。预测误差收敛到「低且稳」、且亏损是从「前门」走（按预案止损，不是死法不在预案内）的结构，才毕业到这里 —— 这是你从混沌里抽象出的、可复用的模型，用它去过滤、捕捉匹配的标的。
        </p>
        {matured.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground">
            还没有结构毕业。继续积累同一结构的样本，让它的预测误差收敛到低且稳（Brier ≤ 0.18、不再发散），并且真亏的时候是按预案止损（从前门走），而不是「死法不在预案内」。
          </div>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {matured.map(s => (
              <MaturedFilterCard key={s.edge} s={s} />
            ))}
          </div>
        )}
      </div>

      {/* 全部结构目录 */}
      <div className="text-[11px] text-muted-foreground">
        按成熟度排列 —— 成熟（可作过滤器）在前，混沌（还没建好）在后。点开任一结构看押注证据。
      </div>
      <div className="space-y-2.5">
        {structures.map(s => (
          <StructureCard key={s.edge} s={s} />
        ))}
      </div>
    </div>
  );
}
