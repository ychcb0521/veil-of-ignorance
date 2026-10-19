import { describe, expect, it } from 'vitest';
import { CBI2_DEF, BUILTIN_FEATURES } from '@/lib/deepDig/features';
import { fishDefinitionDrift, fishResultName, fishRuleText } from '@/lib/fishRule';

describe('【用户要求】2026-10-19 渔的规则文字写出真实被平均的量；内置特征值在 Deep dig 里改过时提醒', () => {
  it('规则文字用公式最后一句的名字', () => {
    expect(fishResultName(CBI2_DEF)).toBe('CBI2');
    expect(fishRuleText(CBI2_DEF, '24', '>', '0.07')).toBe('avg(CBI2, 24h) > 0.07');
    const edited = { ...CBI2_DEF, formula: `${CBI2_DEF.formula}\navg_CBI2 = avg(CBI2, 24)` };
    expect(fishRuleText(edited, 24, '>', 0.07, 2)).toBe('avg(avg_CBI2, 24h) > 0.07 且 2 条约束');
  });

  it('内置没改过 → 不提醒；只改注释也不算；末尾加一行 → 公式改过、被平均的量不同；平均时长只在公式用到时才算', () => {
    for (const d of BUILTIN_FEATURES) expect(fishDefinitionDrift(d)).toBeNull();
    expect(fishDefinitionDrift({ ...CBI2_DEF, formula: CBI2_DEF.formula.replace('# 参与度敏感度', '# 改个注释') })).toBeNull();
    const drift = fishDefinitionDrift({ ...CBI2_DEF, formula: `${CBI2_DEF.formula}\navg_CBI2 = avg(CBI2, 24)` })!;
    expect(drift.changed).toEqual(['公式']);
    expect([drift.resultName, drift.builtinResultName]).toEqual(['avg_CBI2', 'CBI2']);
    expect(fishDefinitionDrift({ ...CBI2_DEF, avgHours: 48 })!.changed).toEqual(['平均时长']);
    expect(fishDefinitionDrift({ ...CBI2_DEF, halfLifeHours: 12 })).toBeNull(); // CBI-2 不用 hl
    expect(fishDefinitionDrift({ ...CBI2_DEF, id: 'f-custom' })).toBeNull();
  });
});

import { fishCalcDef, readUseBuiltin, writeUseBuiltin } from '@/lib/fishRule';
describe('【用户要求】2026-10-19 改用内置公式：Deep dig 里改过的内置特征值，渔可以按最初版定义捕捞', () => {
  it('选了就用内置定义，没选或不是内置特征值就用 Deep dig 里保存的；按特征值记住', () => {
    const edited = { ...CBI2_DEF, formula: `${CBI2_DEF.formula}\navg_CBI2 = avg(CBI2, 24)`, avgHours: 48 };
    expect(fishCalcDef(edited, [])).toBe(edited);
    const calc = fishCalcDef(edited, ['cbi2'])!;
    expect(calc.formula).toBe(CBI2_DEF.formula);
    expect(calc.avgHours).toBe(CBI2_DEF.avgHours);
    expect(fishRuleText(calc, 24, '>', 0.07)).toBe('avg(CBI2, 24h) > 0.07');
    const custom = { ...CBI2_DEF, id: 'f-x' };
    expect(fishCalcDef(custom, ['f-x'])).toBe(custom);
    const store = new Map<string, string>();
    writeUseBuiltin('p_', ['cbi2', 'cbi2'], (k, v) => store.set(k, v));
    expect(readUseBuiltin('p_', k => store.get(k) ?? null)).toEqual(['cbi2']);
    expect(readUseBuiltin('q_', () => 'oops')).toEqual([]);
  });
});
