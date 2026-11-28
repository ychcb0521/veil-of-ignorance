import { describe, expect, it } from 'vitest';
import { readSignalBackup } from '../SignalLibraryBackup';
import { createEntryPeriodSignal } from '@/lib/entryPeriodSignals';

const entry = {...createEntryPeriodSignal('黄金 OTC', '2025-06-24', '进1')!, quality: 4};
const turing = {id:'sample', symbol:'TURING:ABC', timeMs:60000, timeLabel:'1970-01-01 08:01', fallbackZone:'', quality:5, turingReplaySample:true};
const file = (library: string, signals: unknown[]) => JSON.stringify({format:'veil-signal-library', version:1, library, signals});

describe('信号库备份', () => {
  it('保留市场细分、评分和回放标记', () => {
    expect(readSignalBackup(file('entry-period', [entry]), 'entry-period')).toEqual([entry]);
    expect(readSignalBackup(file('turing', [turing]), 'turing')).toEqual([turing]);
  });
  it('拒绝错库以及包含无效记录的整个文件', () => {
    expect(() => readSignalBackup(file('turing', [turing]), 'entry-period')).toThrow();
    expect(() => readSignalBackup(file('entry-period', [entry, turing]), 'entry-period')).toThrow();
  });
});
