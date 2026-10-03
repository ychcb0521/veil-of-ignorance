import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readChartViewState, saveChartViewState } from '../chartViewState';

beforeEach(() => sessionStorage.clear());

describe('chartViewState', () => {
  it('merges independent view fields, including zero scroll, and isolates owner/history/view', () => {
    saveChartViewState('alice:entry:distribution', { scrollLeft: 0, expandedOverflowId: 'campaign-1' });
    saveChartViewState('alice:entry:distribution', { guideOpen: true });
    expect(readChartViewState('alice:entry:distribution')).toEqual({ scrollLeft: 0, expandedOverflowId: 'campaign-1', guideOpen: true });
    expect(readChartViewState('alice:another-entry:distribution').scrollLeft).toBeUndefined();
    expect(readChartViewState('alice:entry:time').scrollLeft).toBeUndefined();
    expect(readChartViewState('bob:entry:distribution').scrollLeft).toBeUndefined();
  });

  it.each(['not json', 'null', '{"scrollLeft":-1}', '{"scrollLeft":"80"}'])('ignores invalid saved view %s', value => {
    sessionStorage.setItem('campaign-chart-view-v1:invalid', value);
    expect(readChartViewState('invalid').scrollLeft).toBeUndefined();
  });

  it('treats storage as optional', () => {
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    try {
      expect(readChartViewState('key')).toEqual({});
      expect(() => saveChartViewState('key', { scrollLeft: 100 })).not.toThrow();
    } finally {
      read.mockRestore();
      write.mockRestore();
    }
  });
});
