import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';

const html = readFileSync(join(process.cwd(), 'src/assets/addSizingCalculator.html'), 'utf8');
const storageKey = 'add-position-calculator-mirror-final-v3';
const standaloneDoms: JSDOM[] = [];

afterEach(() => {
  standaloneDoms.splice(0).forEach(dom => dom.window.close());
});

type CalculatorWindow = Window & {
  AddPositionMath: {
    calculate: (input: Record<string, number>) => Record<string, number>;
    setSeed: (input: Record<string, number | string>) => void;
  };
};

function standaloneCalculator(saved?: string) {
  const dom = new JSDOM(html, {
    url: 'https://standalone.test',
    runScripts: 'dangerously',
    beforeParse(window) {
      if (saved) window.localStorage.setItem(storageKey, saved);
    },
  });
  standaloneDoms.push(dom);
  const win = dom.window as unknown as CalculatorWindow;
  const field = (id: string) => win.document.getElementById(id) as HTMLInputElement;
  const type = (id: string, value: string) => {
    field(id).focus();
    field(id).value = value;
    field(id).dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  };
  const savedState = () => win.localStorage.getItem(storageKey)!;
  return { win, field, type, savedState };
}

describe('embedded add calculator source of truth', () => {
  it('defaults to the latest opening average and switches to breakeven without changing the risk budget', () => {
    const dom = new JSDOM(html, { url: 'https://app.test', runScripts: 'dangerously' });
    const win = dom.window as unknown as CalculatorWindow;
    const field = (id: string) => win.document.getElementById(id) as HTMLInputElement;
    win.AddPositionMath.setSeed({ currentPrice: 150, support: 120, strategyCost: 100, realAverage: 110, coins: 2, mirrorProfitAvailable: 30, side: 'LONG' });
    expect(field('cost-view').value).toBe('110');
    expect(field('process-1').textContent).toContain('Q₁ × (K − S₁)');
    expect(field('process-2').textContent).toContain('50.00 U');
    expect(field('process-3').textContent).toContain('70.00 U');
    expect(field('process-4').textContent).toContain('|T − K|');
    expect(field('process-5').textContent).toContain('2.33 币');
    expect(field('process-6').textContent).toContain('350.00 U');
    expect(field('formula-main').textContent).toContain('Q₁ × (K − S₀)');
    expect(field('formula-explanation').textContent).toContain('保本线已扣利润，不再额外加一次 P');
    const quantity = field('r-add').textContent;
    field('cost-breakeven').click();
    expect(field('cost-view').value).toBe('85');
    expect(field('cost-view').readOnly).toBe(true);
    expect(field('cost-breakeven').parentElement!.textContent).toContain('S₀');
    expect(field('cost').value).toBe('100');
    expect(field('r-add').textContent).toBe(quantity);
    field('cost-latest').click();
    expect(field('cost-view').value).toBe('110');
    expect(field('cost-view').readOnly).toBe(false);
    field('cost-view').value = '112';
    field('cost-view').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    expect(field('cost').value).toBe('102');
    expect(field('r-new-cost').textContent).not.toBe('—');
    field('cost-breakeven').click();
    expect(field('cost-view').value).toBe('87');
    win.AddPositionMath.setSeed({ currentPrice: 80, support: 90, strategyCost: 100, realAverage: 95, coins: 2, mirrorProfitAvailable: 30, side: 'SHORT' });
    expect(field('cost-view').value).toBe('95');
    field('cost-breakeven').click();
    expect(field('cost-view').value).toBe('115');
    expect(field('process-1').textContent).toContain('Q₁ × (S₁ − K)');
    field('clear-single').click();
    expect(field('process-3').textContent).toBe('—');
    dom.window.close();
  });
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
    type('cost-view', '2.8489');
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
    type('cost-view', '2.8489321765');
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

  it('keeps a missing standalone cost editable when the user requests the breakeven view', () => {
    const { win, field, type } = standaloneCalculator();
    field('clear-single').click();
    type('current', '200');
    type('support', '180');
    type('position', '1.67');
    type('mirror', '0');
    field('cost-breakeven').click();

    expect(field('cost').value).toBe('');
    expect(field('cost-view').value).toBe('');
    expect(field('cost-view').readOnly).toBe(false);
    expect(field('cost-latest').getAttribute('aria-pressed')).toBe('true');
    expect(field('cost-breakeven').getAttribute('aria-pressed')).toBe('false');
    expect(win.document.activeElement).toBe(field('cost-view'));
    expect(field('cost-input-help').hidden).toBe(false);
    expect(field('cost-input-help').textContent).toContain('开仓均价');

    type('cost-view', '120');
    expect(field('cost').value).toBe('120');
    expect(field('single-error').hidden).toBe(true);
    expect(field('r-add').textContent).toBe('5.01');
    field('cost-breakeven').click();
    expect(field('cost-view').value).toBe('120');
    expect(field('cost-view').readOnly).toBe(true);
  });

  it.each([null, 120])('recovers an empty cached cost without inventing one from a stale average (%s)', staleAverage => {
    const original = standaloneCalculator();
    original.field('clear-single').click();
    original.type('current', '200');
    original.type('support', '180');
    original.type('position', '1.67');
    const cached = JSON.parse(original.savedState());
    cached.realAverageState = staleAverage;
    delete cached.costBasisCredit; // Old files have no separate credit field.

    const { win, field, type } = standaloneCalculator(JSON.stringify(cached));
    expect(field('cost').value).toBe('');
    expect(field('cost-view').value).toBe('');
    field('cost-breakeven').click();
    expect(field('cost-view').readOnly).toBe(false);
    expect(win.document.activeElement).toBe(field('cost-view'));
    expect(field('cost-input-help').hidden).toBe(false);
    type('cost-view', '120');
    expect(field('r-add').textContent).toBe('5.01');
    expect(field('single-error').hidden).toBe(true);
  });

  it.each([
    { side: 'LONG', currentPrice: 150, support: 120, realAverage: 110, replacement: '112', credit: 10, breakeven: '87', quantity: '2.20' },
    { side: 'SHORT', currentPrice: 80, support: 90, realAverage: 95, replacement: '97', credit: -5, breakeven: '117', quantity: '5.40' },
  ])('preserves the carried cost credit when replacing a $side average through an empty input', example => {
    const { win, field, type, savedState } = standaloneCalculator();
    win.AddPositionMath.setSeed({ side: example.side, currentPrice: example.currentPrice, support: example.support, realAverage: example.realAverage, strategyCost: 100, coins: 2, mirrorProfitAvailable: 30 });
    type('cost-view', '');
    expect(field('cost').value).toBe('');
    expect(JSON.parse(savedState()).costBasisCredit).toBe(example.credit);
    type('cost-view', example.replacement);

    expect(field('cost').value).toBe('102');
    expect(field('r-add').textContent).toBe(example.quantity);
    expect(field('single-error').hidden).toBe(true);
    field('cost-breakeven').click();
    expect(field('cost-view').value).toBe(example.breakeven);
    expect(field('mirror').value).toBe('30');
  });

  it('preserves the cost credit across saving and reopening an unfinished empty draft', () => {
    const original = standaloneCalculator();
    original.win.AddPositionMath.setSeed({ currentPrice: 150, support: 120, strategyCost: 100, realAverage: 110, coins: 2, mirrorProfitAvailable: 30, side: 'LONG' });
    original.type('cost-view', '');

    const { field, type, savedState } = standaloneCalculator(original.savedState());
    expect(field('cost-view').value).toBe('');
    type('cost-view', '112');
    expect(field('cost').value).toBe('102');
    expect(field('r-add').textContent).toBe('2.20');
    expect(JSON.parse(savedState()).costBasisCredit).toBe(10);
    field('cost-breakeven').click();
    expect(field('cost-view').value).toBe('87');
  });

  it.each(['0', '-1'])('rejects a nonpositive opening average (%s) even when a short cost credit would produce a positive strategy cost', invalidAverage => {
    const { win, field, type, savedState } = standaloneCalculator();
    win.AddPositionMath.setSeed({ currentPrice: 80, support: 90, strategyCost: 100, realAverage: 95, coins: 2, mirrorProfitAvailable: 30, side: 'SHORT' });
    type('cost-view', invalidAverage);
    expect(field('cost-view').value).toBe(invalidAverage);
    expect(field('cost-view').readOnly).toBe(false);
    expect(field('cost').value).toBe('');
    expect(field('r-add').textContent).toBe('—');
    expect(field('single-error').hidden).toBe(false);
    expect(field('single-error').textContent).toContain('开仓均价');
    expect(JSON.parse(savedState()).costBasisCredit).toBe(-5);

    type('cost-view', '97');
    expect(field('cost').value).toBe('102');
    expect(field('single-error').hidden).toBe(true);
    expect(field('r-add').textContent).toBe('5.40');
  });

  it('updates the readonly breakeven as P changes and displays a negative breakeven without changing the cost basis', () => {
    const { win, field, type, savedState } = standaloneCalculator();
    win.AddPositionMath.setSeed({ currentPrice: 150, support: 120, strategyCost: 100, realAverage: 110, coins: 2, mirrorProfitAvailable: 30, side: 'LONG' });
    field('cost-breakeven').click();
    expect(field('cost-view').value).toBe('85');
    type('mirror', '50');
    expect(field('cost-view').value).toBe('75');
    expect(field('cost-view').readOnly).toBe(true);
    type('mirror', '');
    expect(field('cost-view').value).toBe('');
    expect(field('cost-input-help').hidden).toBe(false);
    expect(field('cost-input-help').textContent).toContain('镜像止盈');

    type('mirror', '250');
    expect(field('cost-view').value).toBe('-25');
    expect(field('cost-view').readOnly).toBe(true);
    expect(field('cost-input-help').hidden).toBe(true);
    expect(field('single-error').hidden).toBe(true);
    expect(field('r-add').textContent).toBe('9.67');
    expect(field('cost').value).toBe('100');
    expect(JSON.parse(savedState()).costBasisCredit).toBe(10);
    type('mirror', '0');
    expect(field('cost-view').value).toBe('100');
    field('cost-latest').click();
    expect(field('cost-view').value).toBe('110');
  });

  it('derives the carried credit when restoring a valid cache from an older file', () => {
    const original = standaloneCalculator();
    original.win.AddPositionMath.setSeed({ currentPrice: 150, support: 120, strategyCost: 100, realAverage: 110, coins: 2, mirrorProfitAvailable: 30, side: 'LONG' });
    const cached = JSON.parse(original.savedState());
    delete cached.costBasisCredit;
    const { field, type } = standaloneCalculator(JSON.stringify(cached));
    type('cost-view', '');
    type('cost-view', '112');
    expect(field('cost').value).toBe('102');
    expect(field('r-add').textContent).toBe('2.20');
  });

  it('refreshes a focused cost field after switching views, seeding, resetting, clearing and carrying', () => {
    const { win, field, type } = standaloneCalculator();
    win.AddPositionMath.setSeed({ currentPrice: 150, support: 120, strategyCost: 100, realAverage: 110, coins: 2, mirrorProfitAvailable: 30, side: 'LONG' });
    field('cost-view').focus();
    field('cost-breakeven').click();
    expect(field('cost-view').value).toBe('85');
    field('cost-latest').click();
    expect(field('cost-view').value).toBe('110');
    field('cost-view').focus();
    win.AddPositionMath.setSeed({ currentPrice: 80, support: 90, strategyCost: 100, realAverage: 95, coins: 2, mirrorProfitAvailable: 30, side: 'SHORT' });
    expect(field('cost-view').value).toBe('95');
    field('cost-view').focus();
    field('reset-single').click();
    expect(field('cost-view').value).toBe('100');
    field('cost-view').focus();
    field('clear-single').click();
    expect(field('cost-view').value).toBe('');
    expect(field('cost-view').readOnly).toBe(false);

    win.AddPositionMath.setSeed({ currentPrice: 150, support: 120, strategyCost: 100, realAverage: 100, coins: 1, mirrorProfitAvailable: 30, side: 'LONG' });
    field('cost-view').focus();
    field('carry-next').click();
    expect(field('cost-view').value).toBe('131.25');
    expect(field('cost').value).toBe('120');
    expect(field('mirror').value).toBe('0');
    type('current', '200');
    type('support', '180');
    type('cost-view', '');
    type('cost-view', '133.25');
    expect(field('cost').value).toBe('122');
    expect(field('r-mirror-qty').textContent).toBe('0.00');
    field('cost-breakeven').click();
    expect(field('cost-view').value).toBe('122');
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
