import { expect, it } from 'vitest';
import { collapseQualityTableRows, qualityTableMembers, qualityTableRange } from '@/lib/fish/qualityTableRows';
import type { QualitySample } from '@/lib/fish/quality';
const row = (id: string, patch: Partial<QualitySample> = {}): QualitySample => ({ id, signalId: id, detectorId: id, groups: [id], enteredAt: 100, basis: 'capture', importedAt: 100, source: { id, symbol: 'AAAUSDT', timeMs: 50, timeLabel: '', fallbackZone: '' }, ...patch });
it('merges matching symbol/time even across different entries or library sources without changing saved records', () => {
  const rows = [row('a'), row('b', { enteredAt: 200 }), row('lib', { origin: 'library', groups: [], detectorId: undefined })];
  const before = structuredClone(rows), merged = collapseQualityTableRows(rows);
  expect(merged).toHaveLength(1); expect(merged[0].groups).toEqual(['a', 'b']);
  expect(qualityTableMembers(merged[0])).toEqual(rows); expect(rows).toEqual(before);
  expect(collapseQualityTableRows(rows).map(r => r.id)).toEqual(merged.map(r => r.id));
});
it('keeps different timestamps, exchanges and markets separate and preserves sorted member order', () => {
  const a=row('a'), b=row('b',{source:{...a.source,timeMs:51}}), c=row('c',{source:{...a.source,exchange:'bybit'}}), d=row('d',{source:{...a.source,market:'us_stock'}});
  const rows=[b,a,c,d,row('e')], merged=collapseQualityTableRows(rows);
  expect(merged).toHaveLength(4);expect(merged.flatMap(qualityTableMembers).map(r=>r.id)).toEqual(['b','a','e','c','d']);
});
it('shows equal values once, ranges for different outcomes and a missing mark for incomplete results', () => {
  const format=(v:number)=>`${v.toFixed(2)}%`;
  expect(qualityTableRange([0,0],format)).toBe('0.00%');
  expect(qualityTableRange([10,-5,1],format)).toBe('-5.00%～10.00%');
  for(const values of [[],[0,null],[0,undefined],[NaN,1]])expect(qualityTableRange(values,format)).toBe('—');
});
