import { describe, expect, it } from 'vitest';

import {
  classifyStructureResult,
  recoveryGainPct,
  recoveryAsymmetryRatio,
  STRUCTURE_RESULT_QUADRANTS,
} from '../structureResult';

describe('classifyStructureResult', () => {
  it('good decision + win → 实力兑现 (deserved_win, not danger)', () => {
    expect(classifyStructureResult('good', 'win')).toBe('deserved_win');
    expect(STRUCTURE_RESULT_QUADRANTS.deserved_win.isDanger).toBe(false);
  });

  it('good decision + loss → 正确的亏损 (correct_loss)', () => {
    expect(classifyStructureResult('good', 'loss')).toBe('correct_loss');
  });

  it('bad decision + win → 危险盈利 (dangerous_win, the danger cell)', () => {
    expect(classifyStructureResult('bad', 'win')).toBe('dangerous_win');
    expect(STRUCTURE_RESULT_QUADRANTS.dangerous_win.isDanger).toBe(true);
  });

  it('bad decision + loss → 应得的亏损 (deserved_loss)', () => {
    expect(classifyStructureResult('bad', 'loss')).toBe('deserved_loss');
  });

  it('mixed decision quality has no clean quadrant', () => {
    expect(classifyStructureResult('mixed', 'win')).toBeNull();
    expect(classifyStructureResult('mixed', 'loss')).toBeNull();
  });

  it('breakeven / no_entry / null have no quadrant', () => {
    expect(classifyStructureResult('good', 'breakeven')).toBeNull();
    expect(classifyStructureResult('good', 'no_entry')).toBeNull();
    expect(classifyStructureResult('good', null)).toBeNull();
    expect(classifyStructureResult(null, 'win')).toBeNull();
  });

  it('exactly one quadrant is flagged as danger', () => {
    const dangerCells = Object.values(STRUCTURE_RESULT_QUADRANTS).filter((q) => q.isDanger);
    expect(dangerCells).toHaveLength(1);
    expect(dangerCells[0].id).toBe('dangerous_win');
  });
});

describe('recoveryGainPct', () => {
  it('is symmetric-ish for tiny losses but always >= loss', () => {
    expect(recoveryGainPct(1)).toBeCloseTo(1.0101, 3);
    expect(recoveryGainPct(10)).toBeCloseTo(11.1111, 3);
  });

  it('captures the classic asymmetry points', () => {
    expect(recoveryGainPct(25)).toBeCloseTo(33.3333, 3);
    expect(recoveryGainPct(50)).toBeCloseTo(100, 6);
    expect(recoveryGainPct(90)).toBeCloseTo(900, 6);
  });

  it('total wipeout requires infinite recovery', () => {
    expect(recoveryGainPct(100)).toBe(Infinity);
    expect(recoveryGainPct(150)).toBe(Infinity);
  });

  it('non-positive or non-finite loss → 0', () => {
    expect(recoveryGainPct(0)).toBe(0);
    expect(recoveryGainPct(-5)).toBe(0);
    expect(recoveryGainPct(Number.NaN)).toBe(0);
  });
});

describe('recoveryAsymmetryRatio', () => {
  it('grows past 1 as the drawdown deepens', () => {
    expect(recoveryAsymmetryRatio(50)).toBeCloseTo(2, 6); // need 2x the drop to recover
    expect(recoveryAsymmetryRatio(10)).toBeCloseTo(1.1111, 3);
  });

  it('clamps to 1 for non-positive loss and Infinity for wipeout', () => {
    expect(recoveryAsymmetryRatio(0)).toBe(1);
    expect(recoveryAsymmetryRatio(100)).toBe(Infinity);
  });
});
