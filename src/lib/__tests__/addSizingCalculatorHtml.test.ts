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
