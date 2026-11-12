import { formatUTC8 } from '@/lib/timeFormat';

interface FishQualityProgressProps {
  label: string;
  progressLabel: string;
  done: number;
  total: number;
  completed?: number;
  waitingUntil?: number;
  error?: boolean;
  hitCount?: { value: number; title: string; testId?: string };
  action?: { label: string; title: string; onClick: () => void };
  testId?: string;
}

export function FishQualityProgress({
  label, progressLabel, done, total, completed = done, waitingUntil, error, hitCount, action, testId,
}: FishQualityProgressProps) {
  const percent = total > 0 ? completed / total * 100 : 0;
  const waitingTitle = waitingUntil ? '等待至 ' + formatUTC8(waitingUntil) + '（UTC+8）后自动继续' : undefined;
  const status = <>
    <span aria-hidden className={'h-1.5 w-1.5 shrink-0 rounded-full ' + (error ? 'bg-destructive' : 'animate-pulse bg-primary')}/>
    <span>{label}</span>
    {total > 0 && <span className="font-mono tabular-nums">
      {done} / {total}{percent > 0 && <span> · {percent.toFixed(percent < 1 ? 2 : 1)}%</span>}
    </span>}
    {hitCount && <span className="font-mono tabular-nums text-emerald-600" data-testid={hitCount.testId} title={hitCount.title}>命中 {hitCount.value}</span>}
  </>;
  const statusClass = 'inline-flex flex-wrap items-center gap-2';
  return <div className="ml-1 inline-flex min-w-0 flex-wrap items-center gap-2 whitespace-nowrap text-[10px] text-muted-foreground" data-testid={testId}>
    <span role="status">
      {action
        ? <button type="button" className={statusClass + ' hover:text-foreground'} aria-label={action.label} title={waitingTitle ?? action.title} onClick={action.onClick}>{status}</button>
        : <span className={statusClass} title={waitingTitle}>{status}</span>}
    </span>
    {total > 0 && <span role="progressbar" aria-label={progressLabel} aria-valuemin={0} aria-valuemax={total} aria-valuenow={completed}
      aria-valuetext={completed === done ? '已完成 ' + done + ' / ' + total + '，' + percent.toFixed(2) + '%' : '已完成 ' + done + ' / ' + total + '，含当前标的扫描进度 ' + percent.toFixed(2) + '%'}
      className="h-1 w-20 shrink-0 overflow-hidden rounded bg-muted">
      <span className="block h-full bg-primary/60" style={{width: percent + '%'}}/>
    </span>}
  </div>;
}
