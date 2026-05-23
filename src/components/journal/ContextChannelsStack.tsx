import { useEffect, useMemo, useState } from 'react';
import { useReplay } from '@/contexts/ReplayContext';
import { MENTAL_STATE_LABELS, type TradeJournal } from '@/types/journal';
import { CounterfactualPanel } from './CounterfactualPanel';
import { useReplayKlines } from '@/hooks/useReplayKlines';

interface ChannelProps {
  num: string;
  title: string;
  highlight?: boolean;
  children: React.ReactNode;
  rightHint?: React.ReactNode;
}

function ChannelPanel({ num, title, highlight, children, rightHint }: ChannelProps) {
  return (
    <div className={`bg-[#181A20] border border-[#2B3139] rounded flex-1 min-h-0 overflow-y-auto transition-all ${highlight ? 'ring-1 ring-[#0ECB81]' : ''}`}>
      <div className="px-3 py-2 border-b border-[#2B3139] flex items-center gap-2 sticky top-0 bg-[#181A20] z-10">
        <span className="w-5 h-5 rounded-full bg-[#2B3139] text-[10px] font-mono flex items-center justify-center">{num}</span>
        <span className="text-[12px] font-medium">{title}</span>
        <div className="flex-1" />
        {rightHint && <span className="text-[10px] text-muted-foreground">{rightHint}</span>}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function mentalColor(s: number) {
  if (s <= 2) return 'text-[#F6465D]';
  if (s === 3) return 'text-muted-foreground';
  return 'text-[#0ECB81]';
}
function pnlColor(v: number) {
  return v > 0 ? 'text-[#0ECB81]' : v < 0 ? 'text-[#F6465D]' : 'text-muted-foreground';
}

interface HistoricalContext {
  allJournals: TradeJournal[];
  onJournalUpdated?: (updated: TradeJournal) => void;
}

export function ContextChannelsStack({ allJournals, onJournalUpdated }: HistoricalContext) {
  const { journal, tStart, tEnd } = useReplay();
  const [currentJournal, setCurrentJournal] = useState<TradeJournal>(journal);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  useEffect(() => { setCurrentJournal(journal); }, [journal]);

  const { klines } = useReplayKlines(journal.symbol, tStart - 6 * 3600_000, tEnd + 2 * 3600_000, '1m');

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-hidden">
      <DecisionChannel />
      <StateChannel allJournals={allJournals} />
      <RiskChannel />
      <CounterfactualChannel
        journal={currentJournal}
        klines={klines}
        selectedBranchId={selectedBranchId}
        onSelectBranch={setSelectedBranchId}
        onBranchesChanged={(u) => { setCurrentJournal(u); onJournalUpdated?.(u); }}
      />
    </div>
  );
}



function DecisionChannel() {
  const { journal, replayTime, tEntry } = useReplay();
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (Math.abs(replayTime - tEntry) < 30_000 && replayTime >= tEntry) {
      setPulse(true);
      const t = window.setTimeout(() => setPulse(false), 2000);
      return () => window.clearTimeout(t);
    }
  }, [replayTime, tEntry]);

  return (
    <ChannelPanel num="②" title="决策" highlight={pulse}
      rightHint={replayTime >= tEntry ? '已发生' : '尚未发生'}>
      <div className="space-y-3 text-[12px]">
        <div className="border-l-2 border-[#F0B90B] pl-3 text-foreground">
          {journal.pre_entry_reason || <span className="text-muted-foreground italic">无</span>}
        </div>
        <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
          <Cell label="计划止损" value={journal.pre_planned_stop_loss?.toFixed(2) ?? '—'} />
          <Cell label="计划止盈" value={journal.pre_planned_take_profit?.toFixed(2) ?? '—'} />
          <Cell label="仓位" value={journal.pre_position_size?.toFixed(4) ?? '—'} />
          <Cell label="计划最大亏损" value={journal.pre_max_loss_usdt != null ? `${journal.pre_max_loss_usdt.toFixed(2)} USDT` : '—'} />
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground mb-1">Checklist</div>
          <div className="space-y-1">
            {(journal.pre_checklist_items ?? []).map(it => (
              <div key={it.id} className="flex items-center gap-2 text-[11px]">
                <span className={it.checked ? 'text-[#0ECB81]' : 'text-muted-foreground'}>
                  {it.checked ? '✓' : '—'}
                </span>
                <span className={it.checked ? 'text-foreground' : 'text-muted-foreground'}>{it.label}</span>
                {it.required && <span className="text-[9px] text-[#F0B90B]">必填</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </ChannelPanel>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-[12px] text-foreground tabular-nums">{value}</div>
    </div>
  );
}

function StateChannel({ allJournals }: { allJournals: TradeJournal[] }) {
  const { journal } = useReplay();
  const hour = new Date(journal.pre_simulated_time).getHours();

  const stats = useMemo(() => {
    const closed = allJournals.filter(j => j.post_r_multiple != null);
    const sameHour = closed.filter(j => new Date(j.pre_simulated_time).getHours() === hour);
    const lowMental = closed.filter(j => (j.pre_mental_state ?? 5) <= 2);
    const sameSymbol = closed.filter(j => j.symbol === journal.symbol);
    const avg = (arr: TradeJournal[]) =>
      arr.length ? arr.reduce((a, j) => a + (j.post_r_multiple ?? 0), 0) / arr.length : 0;
    const winRate = sameSymbol.length
      ? sameSymbol.filter(j => j.post_outcome === 'win').length / sameSymbol.length
      : 0;
    return {
      sameHourAvgR: avg(sameHour),
      lowMentalAvgR: avg(lowMental),
      symbolWinRate: winRate,
      lowMentalCount: lowMental.length,
    };
  }, [allJournals, hour, journal.symbol]);

  const mState = journal.pre_mental_state;

  return (
    <ChannelPanel num="③" title="状态">
      <div className="space-y-3">
        <div className="flex items-end gap-3">
          <div className={`text-[28px] font-mono leading-none ${mentalColor(mState)}`}>{mState}</div>
          <div className="text-[12px] text-foreground pb-1">{MENTAL_STATE_LABELS[mState]}</div>
        </div>
        {journal.pre_mental_trigger && (
          <div className="text-[11px] text-muted-foreground italic">
            触发：{journal.pre_mental_trigger}
          </div>
        )}
        <div className="grid grid-cols-3 gap-2 font-mono text-[11px]">
          <Cell label={`${String(hour).padStart(2, '0')}时段历史R̄`} value={stats.sameHourAvgR.toFixed(2)} />
          <Cell label="心态≤2 历史R̄" value={stats.lowMentalAvgR.toFixed(2)} />
          <Cell label={`${journal.symbol} 胜率`} value={`${(stats.symbolWinRate * 100).toFixed(0)}%`} />
        </div>
        {mState <= 2 && stats.lowMentalCount > 0 && (
          <div className="bg-[#F6465D]/10 text-[#F6465D] text-[11px] rounded p-2">
            你在心态 ≤2 时的历史平均 R = {stats.lowMentalAvgR.toFixed(2)}。这是你的"非 alpha 状态"。
          </div>
        )}
      </div>
    </ChannelPanel>
  );
}

function RiskChannel() {
  const { journal, tradeRecord } = useReplay();

  const actualLoss = useMemo(() => {
    const pnl = journal.post_realized_pnl ?? tradeRecord?.pnl ?? 0;
    return pnl < 0 ? Math.abs(pnl) : 0;
  }, [journal.post_realized_pnl, tradeRecord]);

  const planned = journal.pre_max_loss_usdt ?? 0;
  const slTriggered = useMemo(() => {
    if (!tradeRecord || journal.pre_planned_stop_loss == null) return false;
    const sl = journal.pre_planned_stop_loss;
    const exit = tradeRecord.exitPrice;
    if (journal.direction === 'long') return exit <= sl;
    if (journal.direction === 'short') return exit >= sl;
    return false;
  }, [tradeRecord, journal]);

  const riskFailed = planned > 0 && actualLoss > planned;
  const diffPct = planned > 0 ? ((actualLoss - planned) / planned) * 100 : 0;

  return (
    <ChannelPanel num="④" title="风险认识与管理">
      <div className="space-y-3 text-[12px]">
        <div>
          <div className="text-[11px] text-muted-foreground mb-1">你当时认识到的风险：</div>
          <div className="italic text-foreground">
            {journal.pre_risk_awareness || <span className="text-muted-foreground">无</span>}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground mb-1">你当时打算如何管理风险：</div>
          <div className="text-foreground">
            {journal.pre_risk_management || <span className="text-muted-foreground">无</span>}
          </div>
        </div>
        {tradeRecord && (
          <div className={`rounded p-2 ${riskFailed ? 'ring-1 ring-[#F6465D]' : 'bg-[#0B0E11]'}`}>
            <div className="text-[11px] text-muted-foreground mb-1">事后对照</div>
            <div className="grid grid-cols-2 gap-1 font-mono text-[11px]">
              <span className="text-muted-foreground">止损触发</span>
              <span className={slTriggered ? 'text-[#F6465D]' : 'text-foreground'}>{slTriggered ? '是' : '否'}</span>
              <span className="text-muted-foreground">实际亏损</span>
              <span className={pnlColor(-actualLoss)}>
                {actualLoss.toFixed(2)} / {planned.toFixed(2)} ({diffPct >= 0 ? '+' : ''}{diffPct.toFixed(0)}%)
              </span>
              <span className="text-muted-foreground">实际 R</span>
              <span className={pnlColor(journal.post_r_multiple ?? 0)}>
                {journal.post_r_multiple != null ? journal.post_r_multiple.toFixed(2) : '—'}
              </span>
            </div>
            {riskFailed && (
              <div className="mt-2 text-[11px] text-[#F6465D] font-medium">⚠ 风险管理失效</div>
            )}
          </div>
        )}
      </div>
    </ChannelPanel>
  );
}

interface CounterfactualChannelProps {
  journal: TradeJournal;
  klines: KlineData[];
  selectedBranchId: string | null;
  onSelectBranch: (id: string | null) => void;
  onBranchesChanged: (updated: TradeJournal) => void;
}

function CounterfactualChannel({ journal, klines, selectedBranchId, onSelectBranch, onBranchesChanged }: CounterfactualChannelProps) {
  const { assignments, patterns } = useReplay();

  const tags = useMemo(() => {
    const out: { id: string; name: string }[] = [];
    for (const a of assignments) {
      const p = patterns.get(a.pattern_id);
      if (p) out.push({ id: p.id, name: p.pattern_name });
    }
    return out;
  }, [assignments, patterns]);

  return (
    <ChannelPanel num="⑤" title="反事实">
      <div className="space-y-3 text-[12px]">
        {journal.post_correct_action && (
          <div className="border-l-2 border-[#0ECB81] pl-3 text-foreground">
            {journal.post_correct_action}
          </div>
        )}

        <CounterfactualPanel
          journal={journal}
          klines={klines}
          selectedBranchId={selectedBranchId}
          onSelectBranch={onSelectBranch}
          onBranchesChanged={onBranchesChanged}
        />

        {tags.length > 0 && (
          <div>
            <div className="text-[11px] text-muted-foreground mb-1">错误标签</div>
            <div className="flex flex-wrap gap-1">
              {tags.map(t => (
                <span key={t.id} className="bg-[#2B3139] rounded-full px-2 py-0.5 text-[10px]">{t.name}</span>
              ))}
            </div>
          </div>
        )}

        {journal.post_reflection && (
          <div>
            <div className="text-[11px] text-muted-foreground mb-1">复盘</div>
            <div className="border-l-2 border-[#5b8def] pl-3 text-[11px] text-foreground">
              {journal.post_reflection}
            </div>
          </div>
        )}
      </div>
    </ChannelPanel>
  );
}

