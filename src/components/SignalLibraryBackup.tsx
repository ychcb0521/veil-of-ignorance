import { useEffect, useRef } from 'react';
import { toast } from '@/lib/notificationCenter';
import { isTuringCupSymbol } from '@/lib/turingCupSymbol';
import type { TradeSignal } from '@/lib/signalLibrary';
import { formatUTC8 } from '@/lib/timeFormat';

export function downloadLibraryJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name + '-' + formatUTC8(Date.now()).replace(/\D/g, '').slice(0, 14) + '.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Library = 'entry-period' | 'turing';
export function readSignalBackup(text: string, library: Library): TradeSignal[] {
  const data = JSON.parse(text);
  if (data?.format !== 'veil-signal-library' || data.version !== 1 || data.library !== library ||
      !Array.isArray(data.signals)) throw Error('文件与当前信号库或备份版本不匹配');
  for (const row of data.signals) {
    if (!row || typeof row.id !== 'string' || !row.id || typeof row.symbol !== 'string' || !row.symbol ||
        !Number.isSafeInteger(row.timeMs) || typeof row.timeLabel !== 'string' || typeof row.fallbackZone !== 'string')
      throw Error('备份包含无效信号');
    if (library === 'turing' ? !isTuringCupSymbol(row.symbol) :
      !['进1', '进1(逼近)'].includes(row.entryPeriod?.mark) ||
      !['crypto','us','cn','unknown','indicator','commodity'].includes(row.entryPeriod?.market) ||
      (row.entryPeriod.endTimeMs !== undefined && !Number.isSafeInteger(row.entryPeriod.endTimeMs)))
      throw Error('备份中的信号类型无效');
  }
  return data.signals;
}

export function SignalLibraryBackup({ library, name, signals, disabled, onImport }: {
  library: Library; name: string; signals: TradeSignal[]; disabled: boolean; onImport: (rows: TradeSignal[]) => void;
}) {
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  return <>
    <label className="relative cursor-pointer whitespace-nowrap text-[10px] text-muted-foreground hover:text-primary">
      导入信号备份
      <input type="file" aria-label={'导入' + name + '备份'} accept=".json,application/json" disabled={disabled} className="sr-only"
        onChange={async event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (!file) return;
          try {
            const rows = readSignalBackup(await file.text(), library);
            if (active.current) { onImport(rows); toast.success('已合并信号备份'); }
          } catch (error) { if (active.current) toast.error((error as Error).message); }
        }}/>
    </label>
    <button type="button" disabled={disabled || !signals.length} className="whitespace-nowrap text-[10px] text-muted-foreground hover:text-primary disabled:opacity-50"
      onClick={() => downloadLibraryJson(name, {format:'veil-signal-library', version:1, library, signals})}>导出信号备份</button>
  </>;
}
