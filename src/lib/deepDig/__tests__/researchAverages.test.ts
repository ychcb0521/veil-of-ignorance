import { describe, expect, it } from 'vitest';
import { CDA_HOURLY_ID } from '@/lib/cdaPeriods';
import { researchChartFormula, researchIndicatorForFeature, researchSeriesNames } from '@/lib/researchIndicators';
import { BSS_DEF, BUILTIN_FEATURES, compileFeatureFormula, formulaVariables, MBI_DEF, SBS5M_DEF } from '../features';
import { evaluateProgramVars } from '../formula';
import { withResearchAverages } from '../researchAverages';

describe('Deep Dig 研究公式', () => {
  it('全部内置指标复用图表的均值，保留原主输出', () => {
    for (const def of BUILTIN_FEATURES) {
      const item = researchIndicatorForFeature(def);
      const effective = withResearchAverages(def);
      if (item.rawOnly) {
        expect(effective).toBe(def);
        continue;
      }
      const chart = researchChartFormula(item, def.formula);
      const names = researchSeriesNames(item, def.formula);
      expect(effective.formula.startsWith(chart), def.id).toBe(true);
      const variables = formulaVariables(effective.formula);
      expect(variables.names, def.id).toEqual(expect.arrayContaining([names.avg, names.avg2]));
      expect(variables.result, def.id).toBe(formulaVariables(def.formula).result);
    }
  });

  it('逐根核对普通均值、加权均值和原主输出，保留已有自定义均值及同名中间量', () => {
    const def = { ...BSS_DEF, formula: 'BSS = C\n_chart_m6 = C + 1\navg_BSS = avg(BSS, 2)' };
    const effective = withResearchAverages(Object.freeze(def));
    const close = Float64Array.from({ length: 48 }, (_, i) => i + 1);
    const run = (formula: string) => evaluateProgramVars(compileFeatureFormula(formula).program, { C: close }, { barMinutes: 60 });
    const evaluated = run(effective.formula);
    expect(evaluated.last).toEqual(run(def.formula).last);
    expect(evaluated.vars.get('_chart_m6')).toEqual(close.map(x => x + 1));
    expect(effective.formula).toContain('_chart_m6_ = avg(BSS, 6)');
    expect((effective.formula.match(/^avg_BSS = avg\(/gm) ?? [])).toHaveLength(1);
    const builtin = run(withResearchAverages({ ...BSS_DEF, formula: 'BSS = C' }).formula);
    for (let i = 23; i < close.length; i++) {
      const mean = (offset: number, length: number) => close[i] - offset - (length - 1) / 2;
      expect((builtin.vars.get('avg_BSS') as Float64Array)[i]).toBe(mean(0, 24));
      expect((evaluated.vars.get('avg_BSS_2') as Float64Array)[i]).toBe(
        (4 * mean(0, 6) + 3 * mean(6, 6) + 2 * mean(12, 6) + mean(18, 6)) / 10,
      );
    }
  });

  it('保留匿名主结果、小时版 CDA 的窗口、完整定义、只取原值及编辑中的无效公式', () => {
    const def = { ...BSS_DEF, formula: 'BSS = C\nC + 3' };
    const effective = withResearchAverages(def);
    expect(formulaVariables(effective.formula).result).toBe('结果');
    const { last } = evaluateProgramVars(compileFeatureFormula(effective.formula).program, { C: Float64Array.of(1, 2, 3) });
    expect(last).toEqual(Float64Array.of(4, 5, 6));
    const hourly = { ...BSS_DEF, id: 'copy-hourly', chartTemplate: CDA_HOURLY_ID, chartCore: 'CDA', formula: 'CDA = C' };
    expect(withResearchAverages(hourly).formula).toContain('avg_CDA = avg(CDA, 288)');
    const invalid = { ...BSS_DEF, formula: 'BSS = (' };
    for (const source of [MBI_DEF, SBS5M_DEF, invalid]) expect(withResearchAverages(source)).toBe(source);
  });
});
