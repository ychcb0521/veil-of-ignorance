import { formatUTC8 } from '@/lib/timeFormat';

interface FishQualityProgressProps {
  label: string;
  progressLabel: string;
  done: number;
  total: number;
  completed?: number;
  waitingUntil?: number;
  detail?: string;
  error?: boolean;
  hitCount?: { value: number; title: string; testId?: string };
  action?: { label: string; title: string; onClick: () => void };
  testId?: string;
}

export function FishQualityProgress({
  label, progressLabel, done, total, completed = done, waitingUntil, detail, error, hitCount, action, testId,
}: FishQualityProgressProps) {
  const filled = Math.min(Math.max(0, completed), Math.max(0, total));
  const percent = total > 0 ? filled / total * 100 : 0;
  const waitingTitle = waitingUntil ? '行情限流，等待至 ' + formatUTC8(waitingUntil) + '（UTC+8）后自动继续' : undefined;
  const title = [waitingTitle, detail, action?.title].filter(Boolean).join(' · ') || undefined;
  const status = <>
    <span aria-hidden className={'h-1.5 w-1.5 shrink-0 rounded-full ' + (error ? 'bg-destructive' : 'animate-pulse bg-primary')}/>
    <span className="w-[5em] shrink-0 text-left">{label}</span>
    {total > 0 && <>
      <span className="w-[13ch] shrink-0 text-right font-mono tabular-nums">{done} / {total}</span>
      <span className="w-[7ch] shrink-0 text-right font-mono tabular-nums">{percent.toFixed(1)}%</span>
    </>}
  </>;
  const statusClass = 'inline-flex shrink-0 items-center gap-2';
  return <div className="ml-1 inline-flex min-w-0 flex-wrap items-center gap-2 whitespace-nowrap text-[10px] text-muted-foreground" data-testid={testId}>
    <span role="status">
      {action
        ? <button type="button" className={statusClass + ' hover:text-foreground'} aria-label={action.label} title={title} onClick={action.onClick}>{status}</button>
        : <span className={statusClass} title={title}>{status}</span>}
    </span>
    {total > 0 && <span role="progressbar" aria-label={progressLabel} aria-valuemin={0} aria-valuemax={total} aria-valuenow={filled}
      aria-valuetext={filled === done ? '已完成 ' + done + ' / ' + total + '，' + percent.toFixed(2) + '%' : '已完成 ' + done + ' / ' + total + '，含当前标的扫描进度 ' + percent.toFixed(2) + '%'}
      title={title} className="h-1 w-20 shrink-0 overflow-hidden rounded bg-muted">
      <span className="block h-full bg-primary/60" style={{width: percent + '%'}}/>
    </span>}
    {hitCount && <span className="font-mono tabular-nums text-emerald-600 dark:text-emerald-400" data-testid={hitCount.testId} title={hitCount.title}>命中 {hitCount.value}</span>}
  </div>;
}
