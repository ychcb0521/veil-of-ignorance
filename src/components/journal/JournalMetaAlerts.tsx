import { useState } from 'react';
import type { MetaAlertItem } from '@/lib/journalAggregations';

interface Props {
  alerts: MetaAlertItem[];
}

const STYLES: Record<MetaAlertItem['level'], string> = {
  red: 'bg-[#F6465D]/10 border-[#F6465D]/30 text-[#F6465D]',
  yellow: 'bg-[#F0B90B]/10 border-[#F0B90B]/30 text-[#F0B90B]',
  gray: 'bg-muted/40 border-border text-muted-foreground',
};

export function JournalMetaAlerts({ alerts }: Props) {
  const [showAll, setShowAll] = useState(false);
  if (alerts.length === 0) return null;
  const shown = showAll ? alerts : alerts.slice(0, 3);
  return (
    <div className="space-y-1.5 mb-3">
      {shown.map((a, i) => (
        <div key={i} className={`border rounded px-3 py-1.5 text-[11px] ${STYLES[a.level]}`}>
          {a.message}
        </div>
      ))}
      {alerts.length > 3 && (
        <button onClick={() => setShowAll(v => !v)}
          className="text-[11px] text-muted-foreground hover:text-foreground">
          {showAll ? '收起' : `展开更多 (${alerts.length - 3})`}
        </button>
      )}
    </div>
  );
}
