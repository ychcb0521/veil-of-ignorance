import { FISH_TURNOVER_FLOORS, type FishTurnoverFloor } from '@/lib/fish/shared';

export function FishTurnoverThresholds({ floors = FISH_TURNOVER_FLOORS }: { floors?: readonly FishTurnoverFloor[] }) {
  if (!floors.length) return <p className="text-muted-foreground">本轮成交额过滤已关闭。</p>;
  return (
    <>
      <ul aria-label="成交额门槛" className="divide-y divide-border/50 text-[11px]">
        {floors.map(({ hours, min }) => (
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
