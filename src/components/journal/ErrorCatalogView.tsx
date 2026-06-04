/**
 * 错题集核心视图 · 错误类型目录。
 *
 * 不再按「一笔一笔的交易」排列，而是按「错误类型」：
 *   顶部一张体检表（系统性校准误差）；下面每张卡片是一类错误，
 *   显示频率 / 趋势 / 代价，点开才露出命中的交易当证据。
 *   你看的是「我这一类错犯了多少、在变好还是变坏」，而不是逐笔流水。
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Crosshair,
  Eye,
  Minus,
} from 'lucide-react';
import type { TradeJournal } from '@/types/journal';
import { analyzeTrades, summarizeCalibration } from '@/lib/predictionError';
import {
  aggregateErrorTypes,
  ERROR_FAMILY_META,
  type ErrorTypeAggregate,
} from '@/lib/errorTypes';

function StatBlock({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`mt-0.5 font-mono text-[18px] leading-tight ${tone ?? 'text-foreground'}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** 趋势胶囊：上升=错误变多(红)，下降=错误变少(绿)，持平(灰)；样本不足不渲染。 */
function TrendPill({ trend }: { trend: number | null }) {
  if (trend == null) return null;
  const pp = Math.round(trend * 100);
  if (pp > 5) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[11px] text-[#F6465D]" title="比早期更频繁 —— 在变差">
        <ArrowUp className="h-3 w-3" /> +{pp}pp
      </span>
    );
  }
  if (pp < -5) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[11px] text-[#0ECB81]" title="比早期更少 —— 在变好">
        <ArrowDown className="h-3 w-3" /> {pp}pp
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground" title="与早期持平">
      <Minus className="h-3 w-3" /> 持平
    </span>
  );
}

/** 代价标签：代价即损害，统一以红色显示绝对值。 */
function CostTag({ value, unit }: { value: number; unit: 'R' | 'pp' | 'USDT' }) {
  const mag = Math.abs(value);
  const text = unit === 'USDT' ? `${mag.toFixed(0)} USDT` : `${mag.toFixed(1)}${unit}`;
  return (
    <span className="inline-flex items-center rounded border border-[#F6465D]/30 bg-[#F6465D]/10 px-1.5 py-0.5 text-[10px] text-[#F6465D]">
      代价 ≈ {text}
    </span>
  );
}

function ErrorTypeCard({
  t,
  maxImpact,
  onAddBlindSpot,
}: {
  t: ErrorTypeAggregate;
  maxImpact: number;
  onAddBlindSpot: (title: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const fam = ERROR_FAMILY_META[t.family];
  const ratePct = t.rate != null ? Math.round(t.rate * 100) : null;
  const barPct = Math.max(6, Math.round((t.impactScore / maxImpact) * 100));

  return (
    <div className="rounded-xl border border-border bg-card">
      {/* 头部（整行可点开） */}
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
          <span className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {fam.label}
          </span>
          <span className="truncate text-[13px] font-medium text-foreground">{t.title}</span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="font-mono text-[12px] text-foreground">
            {t.count}
            <span className="text-muted-foreground">/{t.applicable}</span>
            {ratePct != null && <span className="text-muted-foreground"> · {ratePct}%</span>}
          </span>
          <TrendPill trend={t.trend} />
        </div>
      </button>

      {/* 定义 + 代价 + 影响条 */}
      <div className="px-4 pb-3 pl-10">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-muted-foreground">{t.definition}</span>
          {t.totalCost != null && t.costUnit && <CostTag value={t.totalCost} unit={t.costUnit} />}
        </div>
        <div className="mt-2 h-1 w-full overflow-hidden rounded bg-muted">
          <div className="h-full rounded bg-foreground/30" style={{ width: `${barPct}%` }} />
        </div>
      </div>

      {/* 证据：命中的交易（最近在前） */}
      {open && (
        <div className="space-y-1.5 border-t border-border/60 px-4 py-2.5">
          <div className="text-[10px] text-muted-foreground">证据 · {t.count} 笔（最近在前）</div>
          {t.instances.map(inst => {
            const j = inst.journal;
            const dateStr = new Date(j.pre_simulated_time).toLocaleDateString('zh-CN');
            return (
              <div
                key={j.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/60 px-3 py-1.5"
              >
                <Link
                  to={`/journal/${j.id}`}
                  className="flex min-w-0 items-center gap-2 text-[11px] hover:underline"
                >
                  <span className="font-mono text-foreground">{j.symbol}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">{dateStr}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="truncate text-foreground/80">{inst.detail}</span>
                </Link>
                {t.blindSpotSource && (
                  <button
                    onClick={() => onAddBlindSpot(`${j.symbol} · ${dateStr}：死法不在预案内`)}
                    className="inline-flex shrink-0 items-center gap-1 rounded border border-[#F6465D]/30 bg-[#F6465D]/10 px-2 py-0.5 text-[10px] text-[#F6465D] hover:bg-[#F6465D]/20"
                  >
                    <AlertTriangle className="h-3 w-3" /> 加入盲区
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ErrorCatalogView({
  journals,
  onAddBlindSpot,
}: {
  journals: TradeJournal[];
  onAddBlindSpot: (title: string) => void;
}) {
  const types = useMemo(() => aggregateErrorTypes(journals), [journals]);
  const summary = useMemo(() => summarizeCalibration(analyzeTrades(journals)), [journals]);

  if (summary.reviewedCount === 0 && types.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-10 text-center">
        <Eye className="mx-auto mb-3 h-7 w-7 text-muted-foreground" />
        <div className="text-[13px] font-medium">还没有可归类的错误</div>
        <div className="mx-auto mt-1 max-w-md text-[12px] text-muted-foreground">
          完成一笔交易的复盘后，系统会把「快照里的预测」与「最终结果」之间的误差，
          按错误类型归到这里。看见错误的类型，是消除它的第一步。
        </div>
      </div>
    );
  }

  const gap = summary.overconfidenceGapPP;
  const gapTone =
    gap == null ? 'text-foreground' : gap > 8 ? 'text-[#F6465D]' : gap < -8 ? 'text-[#0ECB81]' : 'text-[#D89B00]';
  const maxImpact = types.length ? types[0].impactScore : 1;

  return (
    <div className="space-y-4">
      {/* 体检表：系统性校准误差 */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Crosshair className="h-4 w-4 text-[#F0B90B]" />
          <h2 className="text-[13px] font-semibold">体检表 · 系统性校准误差</h2>
          <span className="text-[11px] text-muted-foreground">· 共 {summary.reviewedCount} 笔已复盘</span>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <StatBlock
            label="过度自信缺口"
            value={gap != null ? `${gap >= 0 ? '+' : ''}${gap.toFixed(0)}pp` : '—'}
            sub={
              summary.avgPredictedWinPct != null && summary.actualWinRatePct != null
                ? `预测 ${summary.avgPredictedWinPct.toFixed(0)}% → 实际 ${summary.actualWinRatePct.toFixed(0)}%`
                : '样本不足'
            }
            tone={gapTone}
          />
          <StatBlock
            label="预测 R → 实际 R"
            value={
              summary.avgPredictedTargetR != null && summary.avgActualR != null
                ? `${summary.avgPredictedTargetR.toFixed(1)} → ${summary.avgActualR.toFixed(1)}`
                : '—'
            }
            sub="自己定的目标 vs 真实兑现"
          />
          <StatBlock
            label="证伪纪律"
            value={summary.falsificationOnTimeRatePct != null ? `${summary.falsificationOnTimeRatePct.toFixed(0)}%` : '—'}
            sub="信号触发后按时反应"
            tone={
              summary.falsificationOnTimeRatePct != null && summary.falsificationOnTimeRatePct < 60
                ? 'text-[#F6465D]'
                : undefined
            }
          />
          <StatBlock
            label="盲区 / 危险幸运"
            value={`${summary.blindSpotCount} / ${summary.luckyBadCount}`}
            sub="没预想到的 / 坏决策却赢"
            tone={summary.blindSpotCount > 0 ? 'text-[#F6465D]' : undefined}
          />
        </div>
      </div>

      {/* 错误类型目录 */}
      {types.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-[12px] text-muted-foreground">
          已复盘的交易里暂未归出可分类的错误类型 —— 继续记录与复盘，错误会自动归到这里。
        </div>
      ) : (
        <>
          <div className="text-[11px] text-muted-foreground">
            按影响从大到小排列 —— 最该先消除的错误类型排在最前。点开任一类型看具体证据。
          </div>
          <div className="space-y-2.5">
            {types.map(t => (
              <ErrorTypeCard key={t.id} t={t} maxImpact={maxImpact} onAddBlindSpot={onAddBlindSpot} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
