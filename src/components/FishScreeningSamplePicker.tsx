import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { FishPreEntryLibrary } from './FishPreEntryMonitor';
import { ArchivedQualityBoard } from './FishQuality';
import type { FishQualityState } from '@/hooks/useFishQuality';
import { qualityDisplayRows, qualityEntryIdentity, type FishQualityStudy, type QualitySample } from '@/lib/fish/quality';
import { qualitySignalTime } from '@/lib/fish/qualityAdmissionTime';
import { screeningHitRateSamples } from '@/lib/fish/hitRate';
import type { LibraryDirectoryEdits } from '@/lib/fish/libraryDirectoryEdits';
import type { TradeSignal } from '@/lib/signalLibrary';

const archiveSignalKey = (row: QualitySample) =>
  `${qualityEntryIdentity(row.source, row.enteredAt)}|${qualitySignalTime(row.source)}`;

function ScreeningSampleBoard({ study, draft, setDraft, onJump, canJump }: {
  study: FishQualityStudy;
  draft: readonly string[];
  setDraft: Dispatch<SetStateAction<string[]>>;
  onJump?: (signal: TradeSignal) => void;
  canJump?: (signal: TradeSignal) => boolean;
}) {
  const recordsByRow = useMemo(() => {
    const bySignal = new Map<string, string[]>();
    for (const sample of study.samples) {
      const recordId = sample.source.preEntryMonitor?.recordId;
      if (!recordId) continue;
      const key = archiveSignalKey(sample);
      const ids = bySignal.get(key) ?? [];
      ids.push(recordId);
      bySignal.set(key, ids);
    }
    return new Map(qualityDisplayRows(study).map(row => [row.id, bySignal.get(archiveSignalKey(row)) ?? []]));
  }, [study]);
  const selected = useMemo(() => new Set(draft), [draft]);
  const rowIds = useMemo(() => [...recordsByRow].filter(([, ids]) => ids.some(id => selected.has(id))).map(([rowId]) => rowId),
    [recordsByRow, selected]);
  const onChange = useCallback((nextRowIds: readonly string[]) => {
    const nextRows = new Set(nextRowIds);
    setDraft(previous => {
      const next = new Set(previous);
      for (const [rowId, recordIds] of recordsByRow) {
        if (!nextRows.has(rowId)) recordIds.forEach(id => next.delete(id));
        else if (recordIds.length && !recordIds.some(id => next.has(id))) next.add(recordIds[0]);
      }
      return [...next];
    });
  }, [recordsByRow, setDraft]);
  return <ArchivedQualityBoard study={study} selection={{ rowIds, onChange }} onJump={onJump} canJump={canJump}/>;
}

export function FishScreeningSamplePicker({ state, edits, selectedIds, onSelect, onJump, canJump }: {
  state: FishQualityState;
  edits: LibraryDirectoryEdits;
  selectedIds: readonly string[];
  onSelect: (ids: readonly string[]) => void;
  onJump?: (signal: TradeSignal) => void;
  canJump?: (signal: TradeSignal) => boolean;
}) {
  const [draft, setDraft] = useState<string[]>([]);
  const records = state.preEntry?.library.records;
  const ready = state.preEntry?.ready;
  const sampleCount = useMemo(() => records ? screeningHitRateSamples(records, draft, edits).length : 0, [records, draft, edits]);
  return <FishPreEntryLibrary state={state} onJump={onJump}
    renderStudy={study => <ScreeningSampleBoard key={study.screeningRounds?.[0]?.id ?? study.startedAt}
      study={study} draft={draft} setDraft={setDraft} onJump={onJump} canJump={canJump}/>}
    samplePicker={{
      selected: draft,
      setSelected: setDraft,
      onOpenChange: open => { if (open) setDraft([...selectedIds]); },
      footer: close => <>
        <span className="pl-1 text-muted-foreground">已选 {sampleCount} 条测试样本</span>
        <div className="flex gap-2">
          <button type="button" onClick={close} className="rounded-md border border-border/60 px-3 py-1.5 hover:bg-muted">取消</button>
          <button type="button" disabled={!ready || (!sampleCount && !selectedIds.length)} onClick={() => { onSelect(sampleCount ? draft : []); close(); }}
            className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-40">
            {sampleCount || !selectedIds.length ? '使用所选样本' : '清空测试样本'}
          </button>
        </div>
      </>,
    }}/>;
}
