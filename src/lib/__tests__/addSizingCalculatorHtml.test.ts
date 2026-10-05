import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const html = readFileSync(join(process.cwd(), 'src/assets/addSizingCalculator.html'), 'utf8');

type CalculatorWindow = Window & {
  AddPositionMath: {
    calculate: (input: Record<string, number>) => Record<string, number>;
    setSeed: (input: Record<string, number | string>) => void;
  };
};

describe('embedded add calculator source of truth', () => {
  it('shows the same compact calculator and carries strategy cost without spending P twice', () => {
    const dom = new JSDOM(html, { url: 'https://app.test', runScripts: 'dangerously' });
    const win = dom.window as unknown as CalculatorWindow;
    const field = (id: string) => win.document.getElementById(id) as HTMLInputElement;
    const first = win.AddPositionMath.calculate({ T: 150, K: 120, S: 100, Q: 1, P: 30 });
    expect(first.baseQty).toBeCloseTo(2 / 3, 12);
    expect(first.mirrorQty).toBe(1);
    expect(first.addQty).toBeCloseTo(5 / 3, 12);
    expect(first.newCost).toBe(131.25);
    win.AddPositionMath.setSeed({ currentPrice: 150, support: 120, strategyCost: 100, realAverage: 100, coins: 1, mirrorProfitAvailable: 30, leverage: 10, side: 'LONG' });
    expect(field('r-add').textContent).toContain('1.67');
    field('carry-next').click();
    expect(field('cost').value).toBe('120');
    expect(field('position').value).toBe(String(8 / 3));
    expect(field('mirror').value).toBe('0');
    expect(field('current').value).toBe('');
    expect(win.AddPositionMath.calculate({ T: 200, K: 180, S: 120, realAverage: 131.25, Q: 8 / 3, P: 0 }).mirrorQty).toBe(0);
    dom.window.close();
  });

  it('【用户要求】宿主没带来真实均价（0）时照样能算；价格缺省按给定位数写进输入框，手改成任意位数都不受限制', () => {
    const dom = new JSDOM(html, { url: 'https://app.test', runScripts: 'dangerously' });
    const win = dom.window as unknown as CalculatorWindow;
    const field = (id: string) => win.document.getElementById(id) as HTMLInputElement;
    const type = (id: string, value: string) => {
      field(id).value = value;
      field(id).dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    };
    // 截图那一场：没读到持仓，真实均价被种成 0——原来之后怎么填都报「须为大于 0 的有效数字」
    win.AddPositionMath.setSeed({ currentPrice: 2.9920289, support: 0, strategyCost: 0, realAverage: 0, coins: 0, mirrorProfitAvailable: 0, leverage: 10, side: 'LONG', priceDecimals: 4 });
    expect(field('current').value).toBe('2.9920');
    expect(field('cost').value).toBe('');
    type('support', '2.8');
    type('cost', '2.8489');
    type('position', '9999');
    // 截图里的输入（K 2.8 < S 2.8489，P = 0）：原仓退到支撑位要亏 488.95 U、没有镜像利润可补——
    // 给出的是这条结论与一组读数，不再是「须为大于 0 的有效数字」
    expect(field('single-error').textContent).not.toContain('有效数字');
    expect(field('single-error').textContent).toContain('镜像止盈利润不足以覆盖原仓到新支撑位的亏损');
    expect(field('single-error').textContent).toContain('488.95');
    expect(field('r-add').textContent).toBe('0.00');
    expect(field('r-check').textContent).toContain('尚缺');
    type('support', '2.9');
    expect(field('single-error').hidden).toBe(true);
    expect(Number(field('r-add').textContent!.replace(/,/g, ''))).toBeCloseTo(9999 * (2.9 - 2.8489) / (2.9920 - 2.9), 1);
    // 小数位数不设限：7 位、10 位都按原样参与计算
    type('current', '2.9920289');
    type('cost', '2.8489321765');
    expect(field('single-error').hidden).toBe(true);
    expect(Number(field('r-add').textContent!.replace(/,/g, ''))).toBeCloseTo(9999 * (2.9 - 2.8489321765) / (2.9920289 - 2.9), 1);
    // 有持仓时：策略成本线与现价同一位数；真实均价保留完整精度单独承接
    win.AddPositionMath.setSeed({ currentPrice: 2.9920289, support: 0, strategyCost: 2.84893217, realAverage: 2.84893217, coins: 9986.31, mirrorProfitAvailable: 0, leverage: 10, side: 'LONG', priceDecimals: 4 });
    expect(field('current').value).toBe('2.9920');
    expect(field('cost').value).toBe('2.8489');
    expect(field('position').value).toBe('9986.31');
    // 不给位数（旧宿主）：原样写
    win.AddPositionMath.setSeed({ currentPrice: 2.9920289, support: 2.9, strategyCost: 2.84893217, realAverage: 2.84893217, coins: 1, mirrorProfitAvailable: 0, leverage: 10, side: 'LONG' });
    expect(field('current').value).toBe('2.9920289');
    expect(win.AddPositionMath.calculate({ T: 150, K: 120, S: 100, Q: 1, P: 30, realAverage: 0 }).newCost).toBe(131.25);
    dom.window.close();
  });

  it('uses six full-precision steps and handles insufficient or excess mirror profit', () => {
    const dom = new JSDOM(html, { url: 'https://app.test', runScripts: 'dangerously' });
    const { calculate } = (dom.window as unknown as CalculatorWindow).AddPositionMath;
    let S = 100;
    let realAverage = 100;
    let Q = 1;
    for (const [T, K] of [[150, 120], [200, 180], [250, 220], [300, 280], [350, 320], [400, 380]]) {
      const result = calculate({ T, K, S, Q, P: 0, realAverage });
      Q = result.newQ;
      S = K;
      realAverage = result.newCost;
    }
    expect(Q).toBeCloseTo(580.740740741, 8);
    expect(calculate({ T: 150, K: 100, S: 120, Q: 1, P: 10 }).addQty).toBe(0);
    expect(calculate({ T: 150, K: 100, S: 120, Q: 1, P: 50 }).addQty).toBe(0.6);
    dom.window.close();
  });
});
