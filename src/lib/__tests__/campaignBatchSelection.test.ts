import { describe, expect, it } from 'vitest';
import { campaignZipFileName, numberedCampaignPngName, orderedCampaignExportTargets, retainCampaignSelection, toggleCampaignSelection } from '../campaignBatchSelection';
const a = { id: 'a', title: 'A' }, b = { id: 'b', title: 'B' }, c = { id: 'c', title: 'C' };
describe('batch campaign selection', () => {
  it('uses the current sort and appends retained out-of-metric selections once', () => {
    expect(orderedCampaignExportTargets(new Set(['a', 'b', 'c', 'other']), [b, a], [a, b, c])).toEqual([b, a, c]);
  });
  it('never exports selections outside the date/account scope', () => {
    expect(orderedCampaignExportTargets(new Set(['a', 'b']), [a, b], [b])).toEqual([b]);
  });
  it('does not mutate selected ids; unchanged scope retains identity', () => {
    const selected = new Set(['a']);
    expect(toggleCampaignSelection(selected, 'b')).toEqual(new Set(['a', 'b']));
    expect(toggleCampaignSelection(selected, 'a')).toEqual(new Set());
    expect(selected).toEqual(new Set(['a']));
    expect(retainCampaignSelection(selected, new Set(['a', 'b']))).toBe(selected);
    expect(retainCampaignSelection(selected, new Set(['b']))).toEqual(new Set());
  });
  it('numbers filenames in original selection order and removes archive paths', () => {
    expect(numberedCampaignPngName('战役.png', 1, 8)).toBe('002_战役.png');
    expect(numberedCampaignPngName('../A\\B.png', 0, 1234)).toBe('0001_.._A_B.png');
  });
  it('names the ZIP by the batch time and image count, adding the part number only when split', () => {
    const exportedAt = new Date(2026, 8, 24, 10, 7, 45).toISOString();
    expect(campaignZipFileName({ exportedAt, count: 12, part: 1, split: false })).toBe('交易战役_20260924-1007_12张.zip');
    expect(campaignZipFileName({ exportedAt, count: 40, part: 2, split: true })).toBe('交易战役_20260924-1007_第2包_40张.zip');
    expect(campaignZipFileName({ exportedAt: 'bad', count: 1, part: 1, split: false })).toBe('交易战役_未知时间_1张.zip');
  });
});
