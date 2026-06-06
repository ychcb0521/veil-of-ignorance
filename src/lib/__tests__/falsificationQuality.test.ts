import { describe, it, expect } from 'vitest';
import {
  deriveFalsificationQuality,
  type FalsificationQualityInput,
} from '@/lib/falsificationQuality';

function input(over: Partial<FalsificationQualityInput> = {}): FalsificationQualityInput {
  return {
    stopQuality: null,
    hasFalsificationSignal: false,
    hasFalsificationDeadline: false,
    hasPlannedStop: false,
    counterTrend: null,
    ...over,
  };
}

describe('deriveFalsificationQuality', () => {
  it('结构止损 + 可证伪信号 → 富集，不预报后门', () => {
    const r = deriveFalsificationQuality(
      input({ stopQuality: 'structural', hasFalsificationSignal: true, hasPlannedStop: true }),
    );
    expect(r.grade).toBe('rich');
    expect(r.tone).toBe('good');
    expect(r.predictsBackDoor).toBe(false);
  });

  it('只有结构止损、没信号 / 时限 → 稀薄', () => {
    const r = deriveFalsificationQuality(
      input({ stopQuality: 'structural', hasPlannedStop: true }),
    );
    expect(r.grade).toBe('thin');
    expect(r.tone).toBe('warn');
    expect(r.predictsBackDoor).toBe(false);
  });

  it('按百分比拍的止损 + 没信号 → 贫瘠，预报后门', () => {
    const r = deriveFalsificationQuality(
      input({ stopQuality: 'arbitrary', hasPlannedStop: true }),
    );
    expect(r.grade).toBe('poor');
    expect(r.tone).toBe('bad');
    expect(r.predictsBackDoor).toBe(true);
  });

  it('什么都没有 → 贫瘠', () => {
    const r = deriveFalsificationQuality(input());
    expect(r.grade).toBe('poor');
    expect(r.predictsBackDoor).toBe(true);
  });

  it('只有可证伪信号、没结构止损 → 稀薄', () => {
    const r = deriveFalsificationQuality(input({ hasFalsificationSignal: true }));
    expect(r.grade).toBe('thin');
  });

  it('有止损价但未标结构性、没信号 → 稀薄（不至于贫瘠）', () => {
    const r = deriveFalsificationQuality(input({ hasPlannedStop: true }));
    expect(r.grade).toBe('thin');
  });

  it('逆势把富集降到稀薄', () => {
    const r = deriveFalsificationQuality(
      input({
        stopQuality: 'structural',
        hasFalsificationSignal: true,
        hasPlannedStop: true,
        counterTrend: true,
      }),
    );
    expect(r.grade).toBe('thin');
  });

  it('逆势把稀薄降到贫瘠，预报后门', () => {
    const r = deriveFalsificationQuality(
      input({ stopQuality: 'structural', hasPlannedStop: true, counterTrend: true }),
    );
    expect(r.grade).toBe('poor');
    expect(r.predictsBackDoor).toBe(true);
  });

  it('贫瘠逆势仍是贫瘠（到底）', () => {
    const r = deriveFalsificationQuality(input({ counterTrend: true }));
    expect(r.grade).toBe('poor');
  });

  it('有证伪时限也算证伪点：结构止损 + 时限 → 富集', () => {
    const r = deriveFalsificationQuality(
      input({ stopQuality: 'structural', hasFalsificationDeadline: true, hasPlannedStop: true }),
    );
    expect(r.grade).toBe('rich');
  });
});
