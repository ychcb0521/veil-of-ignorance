/**
 * 错题集核心视图：快照预测 vs 实际结果 的误差。
 * 顶部一行系统性校准误差；下面按误差从大到小列出每笔交易的「预测 | 实际」对照。
 */
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Crosshair, Eye, Target } from 'lucide-react';
import type { OddsStructure, TradeJournal } from '@/types/journal';
import {
  analyzeTrades,
  summarizeCalibration,
  type TradeErrorAnalysis,
} from '@/lib/predictionError';

const ODDS_LABEL: Partial<Record<OddsStructure, string>> = {
  r1_easy: 'R1 · 轻松到手',
  r2_supported: 'R2 · 有支撑',
  r3_open: 'R3 · 开放空间',
  odds_insufficient: '赔率不足',
  target_unclear: '目标不清',
};

function outcomeText(o: TradeJournal['post_outcome']): { label: string; tone: string } {
  switch (o) {
    case 'win':
      return { label: '盈利', tone: 'text-[#0ECB81]' };
    case 'loss':
      return { label: '亏损', tone: 'text-[#F6465D]' };
    case 'breakeven':
      return { label: '持平', tone: 'text-muted-foreground' };
    default:
      return { label: '—', tone: 'text-muted-foreground' };
  }
}

function fmtR(r: number | null): string {
  if (r == null) return '—';
  return `${r >= 0 ? '+' : ''}${r.toFixed(1)}R`;
}
function fmtUsdt(v: number | null): string {
  if (v == null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(0)} USDT`;
}

function StatBlock({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`mt-0.5 font-mono text-[18px] leading-tight ${tone ?? 'text-foreground'}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** 误差小标签。 */
function ErrorChip({ tone, children }: { tone: 'red' | 'yellow' | 'gray'; children: React.ReactNode }) {
  const cls =
    tone === 'red'
      ? 'border-[#F6465D]/30 bg-[#F6465D]/10 text-[#F6465D]'
      : tone === 'yellow'
        ? 'border-[#F0B90B]/30 bg-[#F0B90B]/10 text-[#D89B00]'
        : 'border-border bg-muted text-muted-foreground';
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] ${cls}`}>
      {children}
    </span>
  );
}

function TradeErrorCard({
  a,
  onAddBlindSpot,
}: {
  a: TradeErrorAnalysis;
  onAddBlindSpot: (title: string) => void;
}) {
  const j = a.journal;
  const oc = outcomeText(j.post_outcome);
  const dateStr = new Date(j.pre_simulated_time).toLocaleDateString('zh-CN');
  const blindTitle = `${j.symbol} · ${dateStr}：死法不在预案内`;

  const hasError =
    a.overconfident ||
    (a.rShortfall != null && a.rShortfall > 0.5) ||
    a.falsificationLate ||
    a.blindSpotCandidate ||
    a.luckyBadDecision;

  return (
    <div className="rounded-xl border border-border bg-card">
      {/* 头部 */}
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
        <Link to={`/journal/${j.id}`} className="flex items-center gap-2 text-[12px] font-medium hover:underline">
          <span className="font-mono">{j.symbol}</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">{dateStr}</span>
        </Link>
        <div className="flex items-center gap-2">
          <span className={`text-[12px] font-medium ${oc.tone}`}>{oc.label}</span>
          <span className={`font-mono text-[12px] ${a.actualR != null && a.actualR < 0 ? 'text-[#F6465D]' : 'text-foreground'}`}>
            {fmtR(a.actualR)}
          </span>
        </div>
      </div>

      {/* 预测 | 实际 对照 */}
      <div className="grid grid-cols-2 divide-x divide-border/60">
        <div className="px-4 py-3 space-y-2">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            <Crosshair className="h-3 w-3" /> 你的预测（快照）
          </div>
          <div className="text-[12px]">
            预测胜率{' '}
            <span className="font-mono text-foreground">
              {a.predictedWinPct != null ? `${a.predictedWinPct.toFixed(0)}%` : '旧版快照·无'}
            </span>
          </div>
          <div className="text-[12px]">
            目标{' '}
            <span className="text-foreground">
              {j.pre_odds_structure ? ODDS_LABEL[j.pre_odds_structure] ?? '—' : '—'}
            </span>
          </div>
          {j.pre_thesis_why_right && (
            <div className="text-[11px] text-foreground/80">
              <span className="text-muted-foreground">论点：</span>
              <span className="line-clamp-2">{j.pre_thesis_why_right}</span>
            </div>
          )}
          {j.pre_premortem_failure_reason && (
            <div className="text-[11px] text-foreground/80">
              <span className="text-muted-foreground">预想失败：</span>
              <span className="line-clamp-2">{j.pre_premortem_failure_reason}</span>
            </div>
          )}
        </div>

        <div className="px-4 py-3 space-y-2">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            <Target className="h-3 w-3" /> 实际结果
          </div>
          <div className="text-[12px]">
            实际{' '}
            <span className={`font-mono ${oc.tone}`}>{oc.label}</span>
            <span className="text-muted-foreground"> · </span>
            <span className="font-mono text-foreground">{fmtUsdt(a.actualPnl)}</span>
          </div>
          {j.post_decision_quality && (
            <div className="text-[12px]">
              决策质量{' '}
              <span
                className={
                  j.post_decision_quality === 'good'
                    ? 'text-[#0ECB81]'
                    : j.post_decision_quality === 'bad'
                      ? 'text-[#F6465D]'
                      : 'text-[#D89B00]'
                }
              >
                {j.post_decision_quality === 'good' ? '好决策' : j.post_decision_quality === 'bad' ? '坏决策' : '一般'}
              </span>
            </div>
          )}
          {j.exit_falsification_status && (
            <div className="text-[11px] text-foreground/80">
              <span className="text-muted-foreground">证伪信号：</span>
              {j.exit_falsification_status === 'triggered_reacted'
                ? '触发并及时反应'
                : j.exit_falsification_status === 'triggered_late'
                  ? '触发但反应晚了'
                  : '从未触发'}
            </div>
          )}
          {j.post_reflection && (
            <div className="text-[11px] text-foreground/80">
              <span className="text-muted-foreground">复盘：</span>
              <span className="line-clamp-2">{j.post_reflection}</span>
            </div>
          )}
        </div>
      </div>

      {/* 误差高亮 */}
      {hasError && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 px-4 py-2.5">
          <span className="text-[10px] text-muted-foreground">误差</span>
          {a.overconfident && (
            <ErrorChip tone="red">
              过度自信：预测 {a.predictedWinPct?.toFixed(0)}% 却亏损
            </ErrorChip>
          )}
          {a.rShortfall != null && a.rShortfall > 0.5 && (
            <ErrorChip tone="yellow">
              R 缺口 {a.rShortfall.toFixed(1)}R：目标 {a.predictedTargetR} → 实际 {fmtR(a.actualR)}
            </ErrorChip>
          )}
          {a.falsificationLate && <ErrorChip tone="red">证伪晚反应：看见了却没动手</ErrorChip>}
          {a.luckyBadDecision && <ErrorChip tone="yellow">危险幸运：坏决策却赢，别学这次</ErrorChip>}
          {a.blindSpotCandidate && (
            <button
              onClick={() => onAddBlindSpot(blindTitle)}
              className="inline-flex items-center gap-1 rounded border border-[#F6465D]/30 bg-[#F6465D]/10 px-2 py-0.5 text-[11px] text-[#F6465D] hover:bg-[#F6465D]/20"
            >
              <AlertTriangle className="h-3 w-3" /> 盲区：死法不在预案内 · 加入盲区
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function PredictionErrorView({
  journals,
  onAddBlindSpot,
}: {
  journals: TradeJournal[];
  onAddBlindSpot: (title: string) => void;
}) {
  const analyses = analyzeTrades(journals);
  const s = summarizeCalibration(analyses);

  if (analyses.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-10 text-center">
        <Eye className="mx-auto mb-3 h-7 w-7 text-muted-foreground" />
        <div className="text-[13px] font-medium">还没有可对照的误差</div>
        <div className="mx-auto mt-1 max-w-md text-[12px] text-muted-foreground">
          完成一笔交易的复盘后，这里会出现「你当时怎么预测」与「最后实际怎样」的逐笔对照。
          看见误差，是消除它的第一步。
        </div>
      </div>
    );
  }

  const gap = s.overconfidenceGapPP;
  const gapTone = gap == null ? 'text-foreground' : gap > 8 ? 'text-[#F6465D]' : gap < -8 ? 'text-[#0ECB81]' : 'text-[#D89B00]';

  return (
    <div className="space-y-4">
      {/* 系统性校准误差 */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Crosshair className="h-4 w-4 text-[#F0B90B]" />
          <h2 className="text-[13px] font-semibold">系统性校准误差</h2>
          <span className="text-[11px] text-muted-foreground">· 共 {s.reviewedCount} 笔已复盘</span>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <StatBlock
            label="过度自信缺口"
            value={gap != null ? `${gap >= 0 ? '+' : ''}${gap.toFixed(0)}pp` : '—'}
            sub={
              s.avgPredictedWinPct != null && s.actualWinRatePct != null
                ? `预测 ${s.avgPredictedWinPct.toFixed(0)}% → 实际 ${s.actualWinRatePct.toFixed(0)}%`
                : '样本不足'
            }
            tone={gapTone}
          />
          <StatBlock
            label="预测 R → 实际 R"
            value={
              s.avgPredictedTargetR != null && s.avgActualR != null
                ? `${s.avgPredictedTargetR.toFixed(1)} → ${s.avgActualR.toFixed(1)}`
                : '—'
            }
            sub="自己定的目标 vs 真实兑现"
          />
          <StatBlock
            label="证伪纪律"
            value={s.falsificationOnTimeRatePct != null ? `${s.falsificationOnTimeRatePct.toFixed(0)}%` : '—'}
            sub="信号触发后按时反应"
            tone={s.falsificationOnTimeRatePct != null && s.falsificationOnTimeRatePct < 60 ? 'text-[#F6465D]' : undefined}
          />
          <StatBlock
            label="盲区 / 危险幸运"
            value={`${s.blindSpotCount} / ${s.luckyBadCount}`}
            sub="没预想到的 / 坏决策却赢"
            tone={s.blindSpotCount > 0 ? 'text-[#F6465D]' : undefined}
          />
        </div>
      </div>

      {/* 逐笔对照（误差大的在前） */}
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <ArrowRight className="h-3.5 w-3.5" />
        按误差从大到小排列 —— 最该先消除的错误排在最前
      </div>
      <div className="space-y-3">
        {analyses.map(a => (
          <TradeErrorCard key={a.journal.id} a={a} onAddBlindSpot={onAddBlindSpot} />
        ))}
      </div>
    </div>
  );
}
