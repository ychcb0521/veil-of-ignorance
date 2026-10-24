import { describe, expect, it, vi } from 'vitest';
const registered = vi.hoisted(() => new Map<string, { draw?: (args: unknown) => boolean; maxValue?: number }>());
vi.mock('klinecharts', () => ({ registerIndicator: (def: { name: string }) => { registered.set(def.name, def as never); } }));
import { AVG_HIGHLIGHT_SPECS } from '@/lib/avgHighlight';
import { researchKcName } from '@/lib/researchIndicators';
import { ACTION_LEVELS, ORANGE_DASH_LINE, registerCustomIndicators } from '@/lib/customIndicators';

/** 假画布：纵轴 v → (100000 − 1000·v) 像素（细到 0.001），记录每条横线对应的数值与颜色。 */
function lines(name: string, calcParams?: unknown[]) {
  const out: { v: number; color: string }[] = [];
  let color = '', y = 0;
  const ctx = { save() {}, restore() {}, beginPath() {}, lineTo() {}, fillRect() { throw new Error('Raw indicators must not draw boundary bands'); }, setLineDash() {}, set lineWidth(_w: number) {}, set strokeStyle(c: string) { color = c; }, moveTo(_x: number, py: number) { y = py; }, stroke() { out.push({ v: (100000 - Math.floor(y)) / 1000, color }); } };
  registered.get(name)!.draw!({ ctx, bounding: { width: 300, height: 200000 }, yAxis: { convertToPixel: (v: number) => 100000 - 1000 * v }, indicator: { calcParams } });
  return out;
}
const orange = (name: string, calcParams?: unknown[]) => lines(name, calcParams).filter(l => l.color === ORANGE_DASH_LINE.color).map(l => Math.round(l.v * 100) / 100);

describe('副图橘色线按指标区分方向参考与经验门槛', () => {
  it('全部十一项原值只画一条淡实线，无上下界短刻度、色带或重复零线', () => {
    registerCustomIndicators();
    for (const spec of AVG_HIGHLIGHT_SPECS) {
      const threshold = ['STATE', 'STATE2'].includes(spec.id) ? 0.6 : 0;
      expect(lines(researchKcName(spec.id))).toEqual([{ v: threshold, color: ORANGE_DASH_LINE.color }]);
    }
    expect(ORANGE_DASH_LINE.dash).toEqual([]);
  });
  it('图表参考线独立为 0，不借用捕捞门槛', () => { expect(ACTION_LEVELS).toEqual({ cbi2: 0, cba: 0, avgBss: 0 }); });
  it('CBI-2 与 CBA 的黄线为 0', () => {
    registerCustomIndicators();
    expect(orange('CBI2_CUSTOM')).toEqual([0]);
    expect(orange('CBA_CUSTOM')).toEqual([0]);expect(registered.get('CBA_CUSTOM')!.maxValue).toBe(0);
  });
  it('a / avg_a：普通版和归一化版的方向参考线均为 0', () => {
    registerCustomIndicators();
    expect(orange('DSP_V_CUSTOM', [6, 1])).toEqual([0]);expect(orange('DSP_V_CUSTOM', [6, 0])).toEqual([0]);
    expect(orange('DSP_V_AVG_CUSTOM', [6, 24, 1])).toEqual([0]);expect(orange('DSP_V_AVG_CUSTOM', [6, 24, 0])).toEqual([0]);
  });
  it('DSP az 的独立入口、原值和两种均值均为 0 方向线，不借用原始 a 的经验门槛', () => {
    registerCustomIndicators();
    for (const name of ['DSP_Z_V_CUSTOM', 'DSP_Z_V_AVG_CUSTOM', 'DSP_Z_V_AVG2_CUSTOM']) {
      expect(orange(name, [6, 1, 0, 0])).toEqual([0]);
    }
    expect(orange('DSP_V_AVG2_CUSTOM', [6, 1])).toEqual([0]);
  });
  it('BSS 原值及均值黄线均为 0，均值不重复画灰色 0 线', () => {
    registerCustomIndicators();
    const avg = lines('BSS_AVG_CUSTOM');
    expect(avg.map(l => Math.round(l.v * 100) / 100)).toEqual([0]);expect(orange('BSS_AVG_CUSTOM')).toEqual([0]);
    expect(orange('BSS_CUSTOM')).toEqual([0]);
  });
});

// 【用户要求】2026-10-22「为啥没有横线？要加上横线」：读数离线很远时纵轴也要包含橘色线
describe('纵轴总是包含橘色线', () => {
  const k = Array.from({ length: 400 }, (_, i) => { const close = 100 + i / 50 + 2 * Math.sin(i / 9), q = 10000 + 3000 * Math.cos(i / 7); return { timestamp: i * 300000, open: close - .1, high: close + 1, low: close - 1, close, volume: q / close, turnover: q, takerBuyTurnover: q * (.5 + .3 * Math.sin(i / 13)) }; });
  const bounds = (name: string, calcParams: unknown[]) => { const reg: any = registered.get(name); const ind: any = { calcParams }; reg.calc(k, ind); return [ind.minValue, ind.maxValue]; };
  it('avg_a / avg_a_2：普通版及归一化版均包含 0，不再强行包含 15', () => {
    registerCustomIndicators();
    expect(bounds('DSP_V_AVG_CUSTOM', [6, 24, 1])).toEqual([0, 0]);expect(bounds('DSP_V_AVG_CUSTOM', [6, 24, 0])).toEqual([0, 0]);
    expect(bounds('DSP_V_AVG2_CUSTOM', [6, 1, 0])).toEqual([0, 0]);
    expect(bounds('DSP_Z_V_AVG_CUSTOM', [6, 24, 1])).toEqual([0, 0]);
    // 原始 a 副图保留「总包含 0」，归一化版也只保留 0
    expect(bounds('DSP_V_CUSTOM', [6, 1])).toEqual([0, 0]);
  });
  it('CBI-2 / CBA / BSS 均值包含零线；原值不强制扩展到上下限', () => {
    registerCustomIndicators();
    expect(bounds('CBI2_AVG_CUSTOM', [24, 0, 0])).toEqual([0, 0]);
    expect(bounds('CBA_AVG2_CUSTOM', [6, 0, 0])).toEqual([0, 0]);
    expect(bounds('BSS_AVG_CUSTOM', [1, 24])).toEqual([0, 0]);
    for (const spec of AVG_HIGHLIGHT_SPECS) {
      const threshold = ['STATE', 'STATE2'].includes(spec.id) ? 0.6 : 0;
      expect(bounds(researchKcName(spec.id), [24, 0])).toEqual([threshold, threshold]);
    }
  });
  it('四项卖方原值及均值均包含零方向线', () => {
    registerCustomIndicators();
    for(const [id,raw,avg] of [['CDI2',0,0],['SELLER_CONTROL',0,0],['DSS',0,0],['CDA',0,0]] as const){
      for(const [suffix,line] of [['',raw],['_AVG',avg],['_AVG2',avg]] as const){
        const name=`${id}${suffix}_CUSTOM`,reg:any=registered.get(name),ind:any={calcParams:[6,0,0]};
        reg.calc([],ind);expect(ind.minValue).toBeLessThanOrEqual(line);expect(ind.maxValue).toBeGreaterThanOrEqual(line);
        expect(orange(name)).toEqual([line]);
      }
    }
  });
});
