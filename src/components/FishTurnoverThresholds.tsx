import { FISH_TURNOVER_FLOORS } from '@/lib/fish/shared';

export function FishTurnoverThresholds() {
  return (
    <>
      <ul aria-label="成交额门槛" className="divide-y divide-border/50 text-[11px]">
        {FISH_TURNOVER_FLOORS.map(({ hours, min }) => (
          <li key={hours} className="flex items-center justify-between gap-3 py-1.5">
            <span className="text-muted-foreground">{hours} 小时成交额</span>
            <span className="whitespace-nowrap font-medium tabular-nums text-foreground">≥ {(min / 10_000).toLocaleString('zh-CN')} 万 USDT</span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] leading-relaxed text-muted-foreground">捕捞截止前、信号起点前各检查一次，每次三条都要达标。</p>
    </>
  );
}
