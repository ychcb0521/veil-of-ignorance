/**
 * 路径主动权切面 · ex-post 谁握着方向盘。
 *
 * 录音稿的第一性原理：一笔对的交易从第一手就是盈利的，不该有浮亏；浮亏 = 主动权不在自己手里。
 * 终点指标（赢 / 亏、R 倍数）看不见这一层 —— 扛单赢和干净赢，终点都是赢，但扛单赢是变相马丁。
 *
 * 两段式（因为 K 线是实时拉取、没法对全部交易批量算 MAE）：
 *   1) 即时画像：只用成交记录就能定爆仓 / 失控亏 / 受控亏；赢先记「待验证」。
 *   2) 逐笔还原：点开某一笔时才拉那一段 K 线，用 deriveTradePath 把「待验证的赢」
 *      拆成干净赢 / 扛单赢，露出 MAE / MFE / 浸亏时长 / 主动权。
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, Gauge, Loader2 } from 'lucide-react';
import type { TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';
import type { LegTone } from '@/lib/structureLoop';
import { deriveTradePath, type NShape, type PathVerdict, type TradePathBar } from '@/lib/tradePath';
import {
  aggregateTradePathFacet,
  buildReplayRequest,
  type PathFacetItem,
  type ReplayRequest,
} from '@/lib/tradePathFacet';
import { useReplayKlines } from '@/hooks/useReplayKlines';

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

const VERDICT_META: Record<PathVerdict, { label: string; tone: LegTone; note: string }> = {
  clean_win: { label: '干净赢', tone: 'good', note: '几乎没浮亏，主动权一直在手' },
  dragged_win: { label: '扛单赢 · 变相马丁', tone: 'bad', note: '赢了，但靠扛过止损 / 大幅浮亏换来 —— 最危险的赢' },
  controlled_loss: { label: '受控亏', tone: 'warn', note: '按预案干净止损，主动权握住' },
  overrun_loss: { label: '失控亏', tone: 'bad', note: '止损被跑穿 / 浮亏失控，主动权交了出去' },
  flat: { label: '走平', tone: 'muted', note: '保本 / 数据不足以下结论' },
};

const NSHAPE_LABEL: Record<NShape, string> = {
  continuation: '续势',
  breakdown: '破位',
  chop: '反复',
};

function Metric({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/60 px-2.5 py-1.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`mt-0.5 font-mono text-[13px] leading-tight ${tone ?? 'text-foreground'}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** 按需还原：拉那一段 K 线 → deriveTradePath。req 由调用方保证非空。 */
function PathReplay({ req }: { req: ReplayRequest }) {
  const { klines, loading, error } = useReplayKlines(req.symbol, req.fromTime, req.toTime, req.interval);
  const readout = useMemo(() => {
    if (klines.length === 0) return null;
    const bars: TradePathBar[] = klines.map(k => ({ high: k.high, low: k.low, close: k.close }));
    return deriveTradePath({ ...req.input, bars });
  }, [klines, req]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-3 text-[11px] text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> 还原中 · 拉取 {req.interval} K 线…
      </div>
    );
  }
  if (error) {
    return <div className="px-3 py-3 text-[11px] text-[#F6465D]">K 线拉取失败：{error}（实时取自交易所，可稍后重试）</div>;
  }
  if (!readout) {
    return <div className="px-3 py-3 text-[11px] text-muted-foreground">这段时间无 K 线数据，无法还原路径。</div>;
  }

  const v = VERDICT_META[readout.verdict];
  return (
    <div className="space-y-2 px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded border px-1.5 py-0.5 text-[11px] ${TONE_CHIP[v.tone]}`}>{v.label}</span>
        <span className="text-[11px] text-muted-foreground">{v.note}</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4">
        <Metric
          label="最大浮亏 MAE"
          value={readout.maeR != null ? `${readout.maeR.toFixed(2)}R` : '—'}
          sub={readout.breachedStop ? '打穿过止损' : '未破止损'}
          tone={
            readout.maeR != null && readout.maeR > 1
              ? TONE_TEXT.bad
              : readout.maeR != null && readout.maeR <= 0.5
                ? TONE_TEXT.good
                : undefined
          }
        />
        <Metric label="最大浮盈 MFE" value={readout.mfeR != null ? `${readout.mfeR.toFixed(2)}R` : '—'} />
        <Metric
          label="浸亏时长"
          value={`${Math.round(readout.timeInLossPct * 100)}%`}
          sub="水下 K 线占比"
          tone={readout.timeInLossPct >= 0.7 ? TONE_TEXT.bad : undefined}
        />
        <Metric
          label="主动权"
          value={readout.initiative === 'held' ? '握住' : '交出'}
          tone={readout.initiative === 'held' ? TONE_TEXT.good : TONE_TEXT.bad}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
        <span>N 字 · {NSHAPE_LABEL[readout.nShape]}</span>
        <span>·</span>
        <span>
          {readout.resolution === 'confirmed' ? '先确认' : readout.resolution === 'falsified' ? '先证伪' : '未给答案'}
          {readout.barsToResolution != null ? ` · 第 ${readout.barsToResolution + 1} 根` : ''}
        </span>
        <span>·</span>
        <span>周期 {req.interval} · {klines.length} 根</span>
        {readout.maeR == null && <span className="text-[#D89B00]">· 无止损价，MAE 无法折算 R</span>}
      </div>
    </div>
  );
}

function PathRow({ item }: { item: PathFacetItem }) {
  const [open, setOpen] = useState(false);
  const { journal: j, record, proxy } = item;
  const req = useMemo(() => buildReplayRequest(j, record), [j, record]);
  const dateStr = new Date(record.closeTime || Date.parse(j.pre_simulated_time)).toLocaleDateString('zh-CN');

  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent/40"
      >
        <div className="flex min-w-0 items-center gap-2">
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${TONE_CHIP[proxy.tone]}`}>{proxy.label}</span>
          <span className="font-mono text-[12px] text-foreground">{j.symbol}</span>
          <span className="text-[11px] text-muted-foreground">{dateStr}</span>
          <span className="text-[11px] text-muted-foreground">{j.direction === 'short' ? '空' : '多'}</span>
          {proxy.exitBeyondStop === true && <span className="text-[10px] text-[#F6465D]">越止损</span>}
        </div>
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {proxy.needsReplay ? '点开验证主动权 ›' : '点开看路径 ›'}
        </span>
      </button>

      {open && (
        <div className="border-t border-border/60">
          <div className="flex items-center justify-between px-3 pt-2.5 text-[10px] text-muted-foreground">
            <span>{proxy.tone === 'good' || proxy.needsReplay ? '即时画像只是先验，K 线还原才是定论' : '即时画像'}</span>
            <Link to={`/journal/${j.id}`} className="hover:text-foreground hover:underline">
              去复盘这一笔 ›
            </Link>
          </div>
          {req ? (
            <PathReplay req={req} />
          ) : (
            <div className="px-3 py-3 text-[11px] text-muted-foreground">缺开 / 平仓时间，无法还原这条路径。</div>
          )}
        </div>
      )}
    </div>
  );
}

export function TradePathView({
  journals,
  records,
}: {
  journals: TradeJournal[];
  records: TradeRecord[];
}) {
  const facet = useMemo(() => aggregateTradePathFacet(journals, records), [journals, records]);

  if (facet.totalReviewed === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-10 text-center">
        <Gauge className="mx-auto mb-3 h-7 w-7 text-muted-foreground" />
        <div className="text-[13px] font-medium">还没有可还原路径的成交</div>
        <div className="mx-auto mt-1 max-w-md text-[12px] text-muted-foreground">
          完成真实成交单的复盘后，系统会用成交记录给出每笔的路径画像（爆仓 / 失控亏 / 受控亏 / 待验证的赢），
          再支持点开任一笔拉历史 K 线，把「赢」拆成干净赢与扛单赢。
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 头条：主动权 + 扛单赢藏身处 */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-1 flex items-center gap-2">
          <Gauge className="h-4 w-4 text-[#F0B90B]" />
          <h2 className="text-[13px] font-semibold">路径主动权 · 谁握着方向盘</h2>
          <span className="text-[11px] text-muted-foreground">· 共 {facet.totalReviewed} 笔已成交复盘</span>
        </div>
        <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
          一笔对的交易从第一手就是盈利的，不该有浮亏；浮亏 = 主动权不在自己手里。终点指标看不见「扛单赢」——
          胜率高却靠扛过止损 / 摊低成本换来的，是把赢做成了爆仓引擎。下面先用成交记录给即时画像，赢标「待验证」：
          点开任一笔拉那段 K 线，把它拆成干净赢 / 扛单赢。
        </p>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Metric
            label="待验证的赢"
            value={`${facet.unverifiedWinCount}`}
            sub="扛单赢的潜在藏身处"
            tone={facet.unverifiedWinCount > 0 ? TONE_TEXT.warn : undefined}
          />
          <Metric label="受控亏" value={`${facet.controlledLossCount}`} sub="按预案止损" />
          <Metric
            label="失控亏"
            value={`${facet.overrunCount}`}
            sub="平仓还在止损外"
            tone={facet.overrunCount > 0 ? TONE_TEXT.bad : undefined}
          />
          <Metric
            label="爆仓"
            value={`${facet.liquidatedCount}`}
            sub="主动权彻底丧失"
            tone={facet.liquidatedCount > 0 ? TONE_TEXT.bad : undefined}
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {facet.buckets
            .filter(b => b.count > 0)
            .map(b => (
              <span
                key={b.cls}
                className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${TONE_CHIP[b.tone]}`}
                title={b.hint}
              >
                {b.label} {b.count}
              </span>
            ))}
        </div>
      </div>

      <div className="text-[11px] text-muted-foreground">
        即时画像由成交记录直接判定；赢需点开用 K 线还原才能定论（干净赢 / 扛单赢）。最近在前。
      </div>
      <div className="space-y-2">
        {facet.items.map(it => (
          <PathRow key={it.journal.id} item={it} />
        ))}
      </div>
    </div>
  );
}
