import { useQualityCampaignRepair } from '@/hooks/useQualityCampaignRepair';

export function QualityCampaignRepairControl({ owner }: { owner?: string }) {
  const repair = useQualityCampaignRepair(owner), batch = repair.batch;
  const failed = Object.keys(batch?.failures ?? {}).length, verified = batch?.completedKeys.length ?? 0;
  return <section className="mb-3 rounded border border-border bg-card px-3 py-2 text-[11px] space-y-1.5" data-testid="quality-campaign-repair">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <button type="button" disabled={!owner || repair.running} onClick={() => void repair.start()} className="rounded border border-primary/40 px-2 py-1 font-medium text-primary disabled:opacity-50">
        {repair.running ? '正在纠错' : batch && batch.state !== 'complete' ? '继续纠错' : failed ? '重试未通过项' : '一键纠错已有战役'}
      </button>
      {repair.running && <button type="button" onClick={repair.pause} className="text-muted-foreground hover:text-foreground">暂停纠错</button>}
      {batch && <span role="status">{repair.running ? '核验中' : batch.state !== 'complete' ? '未完成，可继续' : '核验完成'} {verified + failed} / {batch.targetKeys.length} · 已纠正 {batch.changedKeys.length} · 核验未变 {verified - batch.changedKeys.length} · 未通过 {failed}{repair.symbol ? ` · ${repair.symbol}` : ''}</span>}
    </div>
    <p className="text-muted-foreground">按当前账号公式重算全部已有比较战役，保留各自买入时点、卖出门槛和观察时长。旧值保留追溯，旧链接转到纠正结果；待核验和未通过项暂不计入统计。离开页面会暂停，可继续。</p>
    {repair.error && <p role="alert" className="text-destructive">{repair.error}</p>}
    {!!failed && <details><summary className="cursor-pointer text-destructive">查看未通过原因</summary><ul className="mt-1 space-y-1">{Object.entries(batch!.failures).map(([key,message]) => <li key={key}>{key}：{message}</li>)}</ul></details>}
  </section>;
}
