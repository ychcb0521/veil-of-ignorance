import { useMemo, useState } from 'react';
import type { StateSegment } from '@/lib/campaignAnalysis';
import type { CampaignCounterfactualStateSegment } from '@/types/journal';

const SEGMENT_STYLES: Record<StateSegment['state'], string> = {
  state_0_setup: 'bg-[#848E9C]/30',
  state_1_lockin: 'bg-[#0ECB81]/20',
  state_2_rolling: 'bg-[#F0B90B]/20',
  state_3_exit: 'bg-[#F6465D]/20',
};

const SECONDARY_SEGMENT_STYLES: Record<string, string> = {
  state_0_setup: 'bg-[#B080FF]/15',
  state_1_lockin: 'bg-[#B080FF]/22',
  state_2_rolling: 'bg-[#B080FF]/30',
  state_3_exit: 'bg-[#B080FF]/18',
};

interface Props {
  segments: StateSegment[];
  secondarySegments?: CampaignCounterfactualStateSegment[];
  secondaryLabel?: string;
  onJumpTo?: (timestampMs: number) => void;
}

export function StateMachineTimeline({
  segments,
  secondarySegments = [],
  secondaryLabel,
  onJumpTo,
}: Props) {
  const [hovered, setHovered] = useState<StateSegment | null>(null);

  const totalMs = useMemo(() => {
    if (segments.length === 0) return 1;
    return new Date(segments[segments.length - 1].end_time).getTime() - new Date(segments[0].start_time).getTime();
  }, [segments]);

  const baseStart = segments[0] ? new Date(segments[0].start_time).getTime() : 0;

  return (
    <div className={`bg-card border border-border rounded overflow-hidden relative ${secondarySegments.length > 0 ? 'h-24' : 'h-16'}`}>
      <div className={`absolute inset-x-0 top-0 flex ${secondarySegments.length > 0 ? 'h-9' : 'h-10'}`}>
        {segments.map(segment => {
          const startMs = new Date(segment.start_time).getTime();
          const endMs = new Date(segment.end_time).getTime();
          const widthPct = ((endMs - startMs) / totalMs) * 100;
          return (
            <button
              key={`${segment.state}-${segment.start_time}`}
              type="button"
              onMouseEnter={() => setHovered(segment)}
              onMouseLeave={() => setHovered((prev: StateSegment | null) => (prev === segment ? null : prev))}
              onClick={() => onJumpTo?.(startMs)}
              className={`relative h-full transition-opacity hover:opacity-90 ${SEGMENT_STYLES[segment.state]}`}
              style={{ width: `${widthPct}%` }}
              title={`${segment.state_label} · ${segment.start_time} → ${segment.end_time}`}
            >
              <div className="absolute left-0 top-0 bottom-0 w-px bg-border/70" />
            </button>
          );
        })}
      </div>

      {secondarySegments.length > 0 && (
        <div className="absolute inset-x-0 top-10 h-7 flex border-t border-border/70">
          {secondarySegments.map(segment => {
            const startMs = new Date(segment.start_time).getTime();
            const endMs = new Date(segment.end_time).getTime();
            const widthPct = ((endMs - startMs) / totalMs) * 100;
            return (
              <button
                key={`${segment.state}-${segment.start_time}-secondary`}
                type="button"
                onClick={() => onJumpTo?.(startMs)}
                className={`relative h-full transition-opacity hover:opacity-90 ${SECONDARY_SEGMENT_STYLES[segment.state] ?? 'bg-[#B080FF]/18'}`}
                style={{ width: `${widthPct}%` }}
                title={`${segment.state_label} · ${segment.start_time} → ${segment.end_time}`}
              >
                <div className="absolute left-0 top-0 bottom-0 w-px bg-border/60" />
              </button>
            );
          })}
        </div>
      )}

      {segments.map(segment => {
        if (!segment.triggering_event) return null;
        const triggerMs = new Date(segment.triggering_event.timestamp).getTime();
        const leftPct = ((triggerMs - baseStart) / totalMs) * 100;
        const label = segment.triggering_event.event_type === 'mirror_tp_triggered'
          ? 'TP 触发'
          : segment.triggering_event.event_type === 'hedge_triggered'
            ? '对冲触发'
            : segment.triggering_event.event_type === 'main_fully_closed'
              ? '主仓全平'
              : '状态切换';
        return (
          <button
            key={segment.triggering_event.id}
            type="button"
            onClick={() => onJumpTo?.(triggerMs)}
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 bg-card border border-border text-[10px] px-1.5 py-0.5 rounded hover:bg-accent"
            style={{ left: `${leftPct}%` }}
          >
            {label}
          </button>
        );
      })}

      <div className={`absolute inset-x-0 text-center text-[10px] text-muted-foreground ${secondarySegments.length > 0 ? 'bottom-0.5' : 'bottom-1'}`}>
        {secondarySegments.length > 0
          ? `上轨=实际轨迹 · 下轨=${secondaryLabel ?? '反事实轨迹'}（紫色）`
          : '灰=完整结构 · 绿=已锁定不亏 · 黄=滚动跟随 · 红=已退场'}
      </div>

      {hovered && (
        <div className="absolute right-2 top-2 text-[10px] px-2 py-1 rounded bg-background/90 border border-border text-muted-foreground">
          {hovered.state_label} · {hovered.start_time.slice(5, 16).replace('T', ' ')} → {hovered.end_time.slice(5, 16).replace('T', ' ')}
        </div>
      )}
    </div>
  );
}
