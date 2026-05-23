/**
 * 反事实分支面板（批次 6 激活）
 * 表单 + 已保存分支列表 + 真实 vs 反事实对比表
 */
import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { useReplay } from '@/contexts/ReplayContext';
import { runCounterfactual } from '@/lib/counterfactualEngine';
import { appendCounterfactualBranch, deleteCounterfactualBranch } from '@/lib/journalApi';
import type {
  CounterfactualBranch,
  CounterfactualBranchParams,
  TradeJournal,
} from '@/types/journal';
import type { KlineData } from '@/hooks/useBinanceData';

interface Props {
  journal: TradeJournal;
  klines: KlineData[];
  selectedBranchId: string | null;
  onSelectBranch: (id: string | null) => void;
  onBranchesChanged: (updated: TradeJournal) => void;
}

function pnlColor(v: number) {
  return v > 0 ? 'text-[#0ECB81]' : v < 0 ? 'text-[#F6465D]' : 'text-muted-foreground';
}

export function CounterfactualPanel({ journal, klines, selectedBranchId, onSelectBranch, onBranchesChanged }: Props) {
  const { tradeRecord } = useReplay();
  const branches: CounterfactualBranch[] = journal.counterfactual_branches ?? [];

  const [label, setLabel] = useState('');
  const [entryPrice, setEntryPrice] = useState(journal.pre_entry_price?.toString() ?? '');
  const [sl, setSl] = useState(journal.pre_planned_stop_loss?.toString() ?? '');
  const [tp1, setTp1] = useState(journal.pre_planned_take_profit?.toString() ?? '');
  const [tp1Pct, setTp1Pct] = useState('100');
  const [tp2, setTp2] = useState('');
  const [tp2Pct, setTp2Pct] = useState('0');
  const [tp3, setTp3] = useState('');
  const [tp3Pct, setTp3Pct] = useState('0');
  const [posSize, setPosSize] = useState(journal.pre_position_size?.toString() ?? '');
  const [offsetMin, setOffsetMin] = useState(0);
  const [noEntry, setNoEntry] = useState(false);
  const [running, setRunning] = useState(false);

  const selected = useMemo(
    () => branches.find(b => b.id === selectedBranchId) ?? null,
    [branches, selectedBranchId],
  );

  const canRun = label.trim().length > 0 && label.trim().length <= 20 && !running &&
    (noEntry || (parseFloat(entryPrice) > 0 && parseFloat(posSize) > 0));

  const handleRun = async () => {
    if (!canRun) return;
    setRunning(true);
    try {
      const baseEntry = new Date(journal.pre_simulated_time).getTime() + offsetMin * 60_000;
      const tps = [
        { price: parseFloat(tp1), size_pct: parseFloat(tp1Pct) || 0 },
        { price: parseFloat(tp2), size_pct: parseFloat(tp2Pct) || 0 },
        { price: parseFloat(tp3), size_pct: parseFloat(tp3Pct) || 0 },
      ].filter(t => t.price > 0 && t.size_pct > 0);
      const params: CounterfactualBranchParams = {
        direction: noEntry ? 'no_entry' : journal.direction,
        entry_price: noEntry ? null : parseFloat(entryPrice),
        stop_loss: noEntry ? null : (parseFloat(sl) || null),
        take_profits: noEntry ? [] : tps,
        position_size_usdt: parseFloat(posSize) || 0,
        leverage: journal.leverage ?? 1,
        entry_time: new Date(baseEntry).toISOString(),
        max_hold_minutes: 24 * 60,
      };
      const result = runCounterfactual(klines, params);
      const updated = await appendCounterfactualBranch(journal.id, { label: label.trim(), params, result });
      onBranchesChanged(updated);
      const newest = (updated.counterfactual_branches ?? []).slice(-1)[0];
      if (newest) onSelectBranch(newest.id);
      toast.success(`反事实运行完成：${result.exit_reason}, P&L ${result.realized_pnl_usdt.toFixed(2)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const updated = await deleteCounterfactualBranch(journal.id, id);
      onBranchesChanged(updated);
      if (selectedBranchId === id) onSelectBranch(null);
      toast.message('已删除该分支');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  // Comparison values
  const actualEntry = journal.pre_entry_price;
  const actualSl = journal.pre_planned_stop_loss;
  const actualExit = tradeRecord?.exitPrice ?? null;
  const actualPnl = journal.post_realized_pnl ?? tradeRecord?.pnl ?? 0;
  const actualR = journal.post_r_multiple ?? null;
  const actualDuration = tradeRecord
    ? Math.round((tradeRecord.closeTime - new Date(journal.pre_simulated_time).getTime()) / 60_000)
    : null;

  const inputCls = 'h-8 px-2 bg-background border border-border rounded text-[11px] font-mono text-foreground w-full';

  return (
    <div className="space-y-3">
      <div className="rounded border border-border p-2 space-y-2">
        <div className="text-[11px] text-muted-foreground">运行反事实分支</div>

        <div>
          <div className="text-[10px] text-muted-foreground mb-1">分支标签 *（≤20 字符）</div>
          <input value={label} onChange={e => setLabel(e.target.value.slice(0, 20))}
            placeholder="例如：止损更宽 / 仓位减半 / 不开仓"
            className={inputCls} />
        </div>

        <div className="flex items-center justify-between gap-2 bg-background rounded px-2 py-1.5">
          <Label className="text-[11px]">改为不开仓</Label>
          <Switch checked={noEntry} onCheckedChange={setNoEntry} />
        </div>

        <div className={`grid grid-cols-2 gap-2 ${noEntry ? 'opacity-40 pointer-events-none' : ''}`}>
          <Field label="入场价">
            <input className={inputCls} type="number" value={entryPrice} onChange={e => setEntryPrice(e.target.value)} />
          </Field>
          <Field label="止损价">
            <input className={inputCls} type="number" value={sl} onChange={e => setSl(e.target.value)} />
          </Field>
          <Field label="TP1 价"><input className={inputCls} type="number" value={tp1} onChange={e => setTp1(e.target.value)} /></Field>
          <Field label="TP1 %"><input className={inputCls} type="number" value={tp1Pct} onChange={e => setTp1Pct(e.target.value)} /></Field>
          <Field label="TP2 价"><input className={inputCls} type="number" value={tp2} onChange={e => setTp2(e.target.value)} /></Field>
          <Field label="TP2 %"><input className={inputCls} type="number" value={tp2Pct} onChange={e => setTp2Pct(e.target.value)} /></Field>
          <Field label="TP3 价"><input className={inputCls} type="number" value={tp3} onChange={e => setTp3(e.target.value)} /></Field>
          <Field label="TP3 %"><input className={inputCls} type="number" value={tp3Pct} onChange={e => setTp3Pct(e.target.value)} /></Field>
          <Field label="仓位 USDT">
            <input className={inputCls} type="number" value={posSize} onChange={e => setPosSize(e.target.value)} />
          </Field>
          <Field label={`时间偏移 ${offsetMin >= 0 ? '+' : ''}${offsetMin} 分钟`}>
            <Slider min={-60} max={120} step={1} value={[offsetMin]} onValueChange={v => setOffsetMin(v[0])} />
          </Field>
        </div>

        <Button
          onClick={handleRun}
          disabled={!canRun}
          className="w-full h-8 text-[12px] bg-[#F0B90B] hover:bg-[#F0B90B]/90 text-black disabled:opacity-40"
        >
          {running ? '运行中...' : '运行反事实'}
        </Button>
      </div>

      {branches.length > 0 && (
        <div>
          <div className="text-[11px] text-muted-foreground mb-1">已保存分支</div>
          <div className="flex flex-wrap gap-1.5">
            {branches.map(b => {
              const r = b.result.r_multiple;
              const dot = b.result.exit_reason === 'no_entry' ? '#848E9C'
                : b.result.realized_pnl_usdt > 0 ? '#0ECB81' : '#F6465D';
              const active = b.id === selectedBranchId;
              return (
                <div
                  key={b.id}
                  className={`bg-muted rounded px-2 py-1 text-[11px] flex items-center gap-2 cursor-pointer
                    ${active ? 'ring-1 ring-[#B080FF]' : 'hover:bg-[#363c45]'}`}
                  onClick={() => onSelectBranch(active ? null : b.id)}
                  onContextMenu={e => { e.preventDefault(); if (confirm(`删除分支「${b.label}」？`)) handleDelete(b.id); }}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: dot }} />
                  <span className="text-foreground">{b.label}</span>
                  <span className={`font-mono ${pnlColor(r)}`}>R̄ {r.toFixed(2)}</span>
                  <button onClick={e => { e.stopPropagation(); handleDelete(b.id); }}
                    className="text-muted-foreground hover:text-[#F6465D]">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {selected && (
        <div className="rounded border border-[#B080FF]/40 p-2">
          <div className="text-[11px] text-[#B080FF] mb-1.5">真实 vs 反事实 · {selected.label}</div>
          <table className="w-full font-mono text-[11px]">
            <thead className="text-muted-foreground">
              <tr><th className="text-left">字段</th><th className="text-right">真实</th><th className="text-right">反事实</th><th className="text-right">差额</th></tr>
            </thead>
            <tbody className="text-foreground">
              <tr><td>入场价</td><td className="text-right">{actualEntry?.toFixed(2) ?? '—'}</td><td className="text-right">{selected.params.entry_price?.toFixed(2) ?? '—'}</td><td>—</td></tr>
              <tr><td>止损价</td><td className="text-right">{actualSl?.toFixed(2) ?? '—'}</td><td className="text-right">{selected.params.stop_loss?.toFixed(2) ?? '—'}</td><td>—</td></tr>
              <tr><td>出场原因</td><td className="text-right">{tradeRecord ? 'closed' : '—'}</td><td className="text-right">{selected.result.exit_reason}</td><td>—</td></tr>
              <tr>
                <td>P&amp;L</td>
                <td className={`text-right ${pnlColor(actualPnl)}`}>{actualPnl.toFixed(2)}</td>
                <td className={`text-right ${pnlColor(selected.result.realized_pnl_usdt)}`}>{selected.result.realized_pnl_usdt.toFixed(2)}</td>
                <td className={`text-right ${pnlColor(selected.result.realized_pnl_usdt - actualPnl)}`}>
                  {(selected.result.realized_pnl_usdt - actualPnl >= 0 ? '+' : '')}
                  {(selected.result.realized_pnl_usdt - actualPnl).toFixed(2)}
                </td>
              </tr>
              <tr>
                <td>R̄</td>
                <td className={`text-right ${pnlColor(actualR ?? 0)}`}>{actualR != null ? actualR.toFixed(2) : '—'}</td>
                <td className={`text-right ${pnlColor(selected.result.r_multiple)}`}>{selected.result.r_multiple.toFixed(2)}</td>
                <td className={`text-right ${pnlColor((selected.result.r_multiple - (actualR ?? 0)))}`}>
                  {actualR != null ? (selected.result.r_multiple - actualR).toFixed(2) : '—'}
                </td>
              </tr>
              <tr><td>持仓</td><td className="text-right">{actualDuration != null ? actualDuration + 'm' : '—'}</td><td className="text-right">{selected.result.hold_duration_minutes}m</td><td>—</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground mb-1">{label}</div>
      {children}
    </div>
  );
}
