import { useEffect, useState } from 'react';
import { useScreenedInstantPositions } from '@/contexts/FishQualityContext';
import type { useInstantPositionSettings } from '@/hooks/useInstantPositionSettings';
import { DEFAULT_INSTANT_POSITION, sizeInstantEntry, type InstantPositionSettings } from '@/lib/fish/instantPositionSettings';

type PositionControl = ReturnType<typeof useInstantPositionSettings>;
const inputStyle = 'block w-full rounded-md border bg-background px-3 py-2 font-mono text-sm tabular-nums';

function PositionEditor({ control, onApply }: { control: PositionControl; onApply?: (position: InstantPositionSettings) => void }) {
  const follow = useScreenedInstantPositions()?.usdtFollow;
  const quote = follow?.connected && follow.orderDesk ? follow.readDeskQuote : undefined;
  const [balance, setBalance] = useState<number>();
  const [balanceError, setBalanceError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    let busy = false;
    setBalance(undefined); setBalanceError('');
    const refresh = async () => {
      if (!quote || busy || abort.signal.aborted || document.hidden) return;
      busy = true;
      try {
        const available = Number((await quote('BTCUSDT', abort.signal)).available);
        if (!Number.isFinite(available) || available < 0) throw Error('余额无效');
        if (!abort.signal.aborted) { setBalance(available); setBalanceError(''); }
      } catch { if (!abort.signal.aborted) { setBalance(undefined); setBalanceError('余额读取失败，正在重试'); } }
      finally { busy = false; }
    };
    if (!quote) return;
    void refresh();
    const timer = window.setInterval(refresh, 15_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { abort.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [quote, follow?.owner]);
  const initial = control.settings ?? DEFAULT_INSTANT_POSITION;
  const [funds, setFunds] = useState(String(initial.availableUsdt));
  const [pct, setPct] = useState(String(initial.marginPct));
  const [leverage, setLeverage] = useState(String(initial.leverage));
  const [saving, setSaving] = useState(false);
  const [applyToSimulation, setApplyToSimulation] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const draft = { version: 1 as const, availableUsdt: Number(funds), marginPct: Number(pct), leverage: Number(leverage) };
  let size: ReturnType<typeof sizeInstantEntry> | undefined;
  try { size = sizeInstantEntry(draft); } catch { /* Keep incomplete numeric inputs editable. */ }
  const save = async () => {
    setError(''); setNotice('');
    try {
      sizeInstantEntry(draft);
      setSaving(true);
      await control.save(draft);
      if (applyToSimulation && onApply) onApply(draft);
      setNotice(applyToSimulation && onApply ? '仓位设置已保存。当前模拟方案已填入，保存方案后生效。' : '仓位设置已保存，下次入选时生效。');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败'); }
    finally { setSaving(false); }
  };
  return <fieldset disabled={saving} className="mt-3 space-y-3">
    <p className="text-muted-foreground">币安跟随每笔开仓前读取 U 本位账户的可用 USDT。模拟资金可单独设定。</p>
    <div className="grid gap-3 sm:grid-cols-3">
      <label>模拟可用资金（USDT）<input className={inputStyle} type="number" min="0" step="any" value={funds} onChange={e => { setFunds(e.target.value); setNotice(''); }}/></label>
      <label>首仓保证金比例（%）<input className={inputStyle} type="number" min="0" max="100" step="any" value={pct} onChange={e => { setPct(e.target.value); setNotice(''); }}/></label>
      <label>持仓杠杆（倍）<input className={inputStyle} type="number" min="1" max="125" step="1" value={leverage} onChange={e => { setLeverage(e.target.value); setNotice(''); }}/></label>
    </div>
    <div className="rounded-md bg-muted/50 p-3 tabular-nums">
      <p>币安实时可用资金　{balance != null ? balance + ' USDT' : quote ? balanceError || '正在读取…' : '未连接'}</p>
      {balance != null && size && <p>预计首仓保证金 {balance * (draft.marginPct / 100)} USDT · 首仓名义仓位 {balance * (draft.marginPct / 100) * draft.leverage} USDT</p>}
    </div>
    <p className="tabular-nums">模拟首仓保证金 {size?.marginUsdt ?? '—'} USDT · 首仓名义仓位 {size?.notional ?? '—'} USDT</p>
    {onApply && <label className="flex items-center gap-2"><input type="checkbox" checked={applyToSimulation} onChange={e => setApplyToSimulation(e.target.checked)}/>同时填入当前模拟方案</label>}
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="rounded border px-3 py-1.5" onClick={() => { setFunds(String(DEFAULT_INSTANT_POSITION.availableUsdt)); setNotice('模拟资金已重置，保存后生效。'); }}>重置模拟资金</button>
      {balance != null && balance > 0 && <button type="button" className="rounded border px-3 py-1.5" onClick={() => { setFunds(String(balance)); setNotice('已填入币安余额，保存后生效。'); }}>以币安余额重置模拟资金</button>}
      <button type="button" className="rounded bg-primary px-3 py-1.5 text-primary-foreground" onClick={() => void save()}>{saving ? '正在保存…' : '保存仓位设置'}</button>
    </div>
    {notice && <p role="status">{notice}</p>}{(error || control.issue) && <p role="alert" className="text-destructive">{error || control.issue}</p>}
  </fieldset>;
}

export function FishInstantPositionSettings({ control, onApply }: { control?: PositionControl; onApply?: (position: InstantPositionSettings) => void }) {
  const [open, setOpen] = useState(false);
  if (!control) return null;
  return <section className="rounded-lg border p-3 text-sm">
    <label className="inline-flex items-center gap-2 font-medium"><input type="checkbox" checked={open} onChange={event => setOpen(event.target.checked)}/>仓位设置</label>
    <span className="ml-3 text-xs text-muted-foreground">币安可用余额 × {control.settings?.marginPct ?? '—'}% · {control.settings?.leverage ?? '—'} 倍杠杆</span>
    {open && <PositionEditor control={control} onApply={onApply}/>}
  </section>;
}
