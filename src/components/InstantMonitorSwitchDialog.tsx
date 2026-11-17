import { useState } from 'react';
import { useQualityTemplateNames } from '@/contexts/QualityTemplateNamesContext';
import { type InstantMonitorPlanChoice, INSTANT_TEMPLATE_MONITOR, type InstantMonitorSettings } from '@/lib/fish/instantMonitorSettings';
import { instantMonitorSwitchIssue } from '@/lib/fish/instantMonitorSwitch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { toast } from 'sonner';

export type InstantMonitorSwitchTarget = {
  symbol: string;
  current: Pick<InstantMonitorSettings, 'name' | 'templateId'> & Partial<InstantMonitorSettings>;
  live?: boolean;
  followed?: boolean;
  allowCurrent?: boolean;
  submit: (monitor: InstantMonitorSettings) => Promise<void>;
};

export function InstantMonitorSwitchDialog({ target, templates, close }: {
  target: InstantMonitorSwitchTarget;
  templates: readonly InstantMonitorPlanChoice[];
  close: () => void;
}) {
  const names = useQualityTemplateNames();
  const [id, setId] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const choices = templates.filter(template => (target.allowCurrent || template.id !== target.current.templateId) && !instantMonitorSwitchIssue(template));
  const selected = choices.find(template => template.id === id);
  const { current } = target;
  const currentName = (current.plan && names?.forMonitor(current.plan, current.templateId)?.name) ?? current.name;
  const submit = async () => {
    if (pending || !selected) return;
    setPending(true);
    setError('');
    try {
      await target.submit({ version: INSTANT_TEMPLATE_MONITOR, templateId: selected.id, name: selected.name, plan: selected.plan });
      toast.success(`${target.symbol} 已切换持仓监测方案`);
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '切换失败，请稍后再试');
    } finally { setPending(false); }
  };
  return <Dialog open onOpenChange={value => { if (!value && !pending) close(); }}>
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>切换持仓监测方案</DialogTitle>
        <DialogDescription>{target.symbol} · {target.followed ? '币安实盘 · 系统跟单' : target.live ? '币安实盘托管' : '即时交易模拟'}</DialogDescription>
      </DialogHeader>
      <div className="space-y-3 text-sm">
        <p>当前方案 <span className="font-medium">{currentName}</span></p>
        <label className="flex flex-col gap-1.5">新方案
          <select value={id} disabled={pending || !choices.length} onChange={event => { setId(event.target.value); setError(''); }}
            className="h-9 w-full rounded-md border bg-background px-2">
            <option value="">{choices.length ? '请选择已保存的模板' : '暂无可切换的模板'}</option>
            {choices.map(template => <option key={template.id} value={template.id}>{names?.forMonitor(template.plan, template.id)?.name ?? template.name}</option>)}
          </select>
        </label>
        <p className="text-xs text-muted-foreground">{target.followed
          ? '新方案从下一根完整的 1 分钟 K 线开始，以币安实际余仓数量和成本均价作为首仓，接续原加仓次数。'
          : '新方案从下一根完整的 1 分钟 K 线开始判断，并接续这笔持仓的已成交数量与加仓次数。'}</p>
        {error && <p role="alert" className="text-destructive">{error}</p>}
      </div>
      <DialogFooter>
        <button type="button" onClick={close} disabled={pending} className="rounded-md border px-3 py-1.5 text-sm">取消</button>
        <button type="button" onClick={() => void submit()} disabled={!selected || pending}
          className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50">{pending ? '核对中…' : '确认切换'}</button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
