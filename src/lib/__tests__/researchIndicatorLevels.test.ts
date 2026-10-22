// 【用户要求】2026-10-22「指标表中的多空状态 S，盘面上那条橘色横线的值设置为 0.67」
import { it, expect } from 'vitest';
import { RESEARCH_INDICATORS } from '@/lib/researchIndicators';
it('多空状态 S 的橘色线在 0.67（线上绿、线下红）；其余研究指标仍在 0', () => {
  const by = Object.fromEntries(RESEARCH_INDICATORS.map(i => [i.id, i.neutral]));
  expect(by.STATE).toBe(0.67);
  for (const id of ['CDI2', 'DSP_B', 'DSS', 'CDA']) expect(by[id]).toBe(0);
});
