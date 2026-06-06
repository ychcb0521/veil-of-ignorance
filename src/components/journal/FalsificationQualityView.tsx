/**
 * 证伪质量切面 · ex-ante 病根。
 *
 * 和错题集 / 结构成熟度同一份已复盘交易，换一个切面：按「开仓那刻的证伪质量」切，
 * 不按错误种类、也不按结构源头。每笔在下单瞬间就被折算成富集 / 稀薄 / 贫瘠三档，
 * 这个视图看每一档后来「怎么死的」——
 *   贫瘠档（开仓即无明确证伪点）的亏损，是否果然过度集中在「后门」(死法不在预案内)。
 * 录音稿的因果：后门死法不是平仓时的运气，是开仓时证伪贫瘠的必然产物。
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, DoorOpen, ShieldQuestion } from 'lucide-react';
import type { TradeJournal } from '@/types/journal';
import type { LegTone } from '@/lib/structureLoop';
import {
  aggregateFalsificationFacet,
  type FalsificationGradeBucket,
} from '@/lib/falsificationFacet';

const TONE_TEXT: Record<LegTone, string> = {
  good: 'text-[#0ECB81]',
  warn: 'text-[#D89B00]',
  bad: 'text-[#F6465D]',
  muted: 'text-muted-foreground',
};
const TONE_CHIP: Record<LegTone, string> = {
  good: 'border-[#0ECB81]/30 bg-[#0ECB81]/10 text-[#0ECB81]',
  warn: 'border-[#F0B90B]/30 bg-[#F0B90B]/10 text-[#D89B00]',
  bad: 'border-[#F6465D]/30 bg-[#F6465D]/10 text-[#F6465D]',
  muted: 'border-border bg-muted text-muted-foreground',
};

const pct = (r: number | null): string => (r == null ? '—' : `${Math.round(r * 100)}%`);

function Metric({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/60 px-2.5 py-1.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`mt-0.5 font-mono text-[13px] leading-tight ${tone ?? 'text-foreground'}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** 这一笔是不是「后门死」：亏损且证伪信号从未触发。 */
function isBackDoorLoss(j: TradeJournal): boolean {
  return j.post_outcome === 'loss' && j.exit_falsification_status === 'not_triggered';
}

function GradeCard({ b }: { b: FalsificationGradeBucket }) {
  const [open, setOpen] = useState(false);
  const backDoorTone = b.backDoorRate == null ? 'text-muted-foreground' : b.backDoorRate >= 0.5 ? TONE_TEXT.bad : b.backDoorRate > 0 ? TONE_TEXT.warn : TONE_TEXT.good;

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
          <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${TONE_CHIP[b.tone]}`}>{b.label}</span>
          <span className="truncate text-[12px] text-muted-foreground">{b.hint}</span>
        </div>
        <span className="shrink-0 font-mono text-[12px] text-muted-foreground">{b.count} 笔</span>
      </button>

      <div className="px-4 pb-3 pl-10">
        <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4">
          <Metric label="赢 / 亏 / 保本" value={`${b.winCount} / ${b.lossCount} / ${b.breakevenCount}`} />
          <Metric
            label="后门死率"
            value={pct(b.backDoorRate)}
            sub={b.lossCount > 0 ? `${b.backDoorLossCount}/${b.lossCount} 笔亏损走后门` : '无亏损'}
            tone={backDoorTone}
          />
          <Metric
            label="平均 R"
            value={b.avgR != null ? `${b.avgR >= 0 ? '+' : ''}${b.avgR.toFixed(2)}` : '—'}
            tone={b.avgR != null ? (b.avgR >= 0 ? TONE_TEXT.good : TONE_TEXT.bad) : undefined}
          />
          <Metric label="占比" value={b.count > 0 ? '点开看证据' : '本档为空'} />
        </div>
      </div>

      {open && b.count > 0 && (
        <div className="space-y-1.5 border-t border-border/60 px-4 py-2.5">
          <div className="text-[10px] text-muted-foreground">该档交易 · {b.journals.length} 笔（最近在前）</div>
          {b.journals.map(j => {
            const dateStr = new Date(j.pre_simulated_time).toLocaleDateString('zh-CN');
            const backDoor = isBackDoorLoss(j);
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
                <span
                  className={
                    j.post_outcome === 'win'
                      ? TONE_TEXT.good
                      : j.post_outcome === 'loss'
                        ? TONE_TEXT.bad
                        : 'text-muted-foreground'
                  }
                >
                  {j.post_outcome === 'win' ? '赢' : j.post_outcome === 'loss' ? '亏' : '保本'}
                </span>
                {backDoor && (
                  <span className="ml-auto inline-flex items-center gap-1 rounded border border-[#F6465D]/30 bg-[#F6465D]/10 px-1.5 py-0.5 text-[10px] text-[#F6465D]">
                    <DoorOpen className="h-3 w-3" /> 后门死
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function FalsificationQualityView({ journals }: { journals: TradeJournal[] }) {
  const facet = useMemo(() => aggregateFalsificationFacet(journals), [journals]);

  if (facet.totalReviewed === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-10 text-center">
        <ShieldQuestion className="mx-auto mb-3 h-7 w-7 text-muted-foreground" />
        <div className="text-[13px] font-medium">还没有可评估证伪质量的交易</div>
        <div className="mx-auto mt-1 max-w-md text-[12px] text-muted-foreground">
          完成带「止损质量 / 可证伪信号」的真实交易复盘后，系统会把每笔开仓那刻的证伪质量折算成
          富集 / 稀薄 / 贫瘠三档，再看哪一档后来更容易「走后门」死。
        </div>
      </div>
    );
  }

  const poor = facet.poorBackDoorRate;
  const rich = facet.richBackDoorRate;
  const confirms = poor != null && (rich == null || poor > rich);

  return (
    <div className="space-y-4">
      {/* 头条：ex-ante 病根 → 后门死法 */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-1 flex items-center gap-2">
          <ShieldQuestion className="h-4 w-4 text-[#F0B90B]" />
          <h2 className="text-[13px] font-semibold">证伪质量 · 开仓即定的病根</h2>
          <span className="text-[11px] text-muted-foreground">· 共 {facet.totalReviewed} 笔已复盘</span>
        </div>
        <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
          顺势 / 逆势的不对称不在胜率，在「证伪结构」：证伪富集 = 错了近、清晰、便宜；证伪贫瘠 = 没有明确证伪点，
          只能靠移动止损续命。所以「怎么死的」开仓时就已埋好 —— 后门死法（死法不在预案内）是证伪贫瘠的必然产物。
          下面对比各档的后门死率，验证这条因果。
        </p>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          <Metric
            label="贫瘠档后门死率"
            value={pct(poor)}
            sub="开仓即无明确证伪点"
            tone={poor != null && poor >= 0.5 ? TONE_TEXT.bad : undefined}
          />
          <Metric label="富集档后门死率" value={pct(rich)} sub="对照：有结构止损 + 信号" tone={rich != null && rich <= 0.2 ? TONE_TEXT.good : undefined} />
          <div className="col-span-2 flex items-center rounded-lg border border-border/60 bg-background/60 px-2.5 py-1.5 md:col-span-1">
            <span className={`text-[11px] leading-snug ${confirms ? TONE_TEXT.bad : 'text-muted-foreground'}`}>
              {poor == null
                ? '贫瘠档暂无亏损样本，结论待积累'
                : confirms
                  ? '贫瘠档后门死率更高 —— 证伪贫瘠确实在制造后门死法'
                  : '暂未见贫瘠档后门死率更高，继续积累样本'}
            </span>
          </div>
        </div>
      </div>

      {/* 三档目录 */}
      <div className="text-[11px] text-muted-foreground">
        富集 → 稀薄 → 贫瘠 固定顺序。点开任一档看该档交易，红标「后门死」= 死法不在预案内。
      </div>
      <div className="space-y-2.5">
        {facet.buckets.map(b => (
          <GradeCard key={b.grade} b={b} />
        ))}
      </div>
    </div>
  );
}
