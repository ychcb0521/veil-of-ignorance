import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { KLineData } from 'klinecharts';
import { bssPoints, CUSTOM_INDICATOR_MAP } from '@/lib/customIndicators';
import { computeBss } from '@/lib/bss';
import { IndicatorMenu } from '@/components/IndicatorMenu';

const BAR = 5 * 60_000;
function klines(n: number, barMs: number): KLineData[] {
  let close = 100;
  return Array.from({ length: n }, (_, i) => {
    const open = close;
    close = open * (1 + 0.003 * Math.sin(i / 5) + 0.001 * Math.cos(i / 3));
    const turnover = 1e5 * (1.5 + Math.sin(i / 7));
    return { timestamp: i * barMs, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: turnover / close, turnover, takerBuyTurnover: turnover * (0.5 + 0.3 * Math.sin(i / 11)) } as KLineData;
  });
}

describe('【用户要求】K 线图指标菜单：BSS 买卖强度综合分（副图）', () => {
  it('副图读 K 线的成交额 / 主动买入额，与 computeBss 一致；窗口按 5 分钟图计、其他周期等比例缩放（每根窗口根数相同）', () => {
    const k5 = klines(400, BAR);
    const p = bssPoints(k5, 1);
    const ref = computeBss(k5.map(k => ({ close: k.close, quoteVolume: k.turnover, takerBuyQuoteVolume: k.takerBuyTurnover as number })), 5, { recentHours: 1, normHours: 24 });
    expect(p.map(x => x.bss)).toEqual(ref.map(x => x.bss));
    // 同一串数据画在 1 小时图上：读数逐根相同（与动态谢林点同一约定）
    const k1h = klines(400, 12 * BAR);
    expect(bssPoints(k1h, 1).map(x => x.bss)).toEqual(p.map(x => x.bss));
    // 参数 = 近期窗口（小时）
    expect(bssPoints(k5, 2).at(-1)!.bss).not.toBeCloseTo(p.at(-1)!.bss!, 6);
    for (const x of p) if (x.bss != null) expect(Math.abs(x.bss)).toBeLessThanOrEqual(1);
    expect(CUSTOM_INDICATOR_MAP.BSS).toBe('BSS_CUSTOM');
  });

  it('菜单里有 BSS：名称下面写定义（去掉订单簿 I、权重 0.45 / 0.25 / 0.30），参数默认 1 小时', () => {
    const onChange = vi.fn();
    render(<IndicatorMenu open indicators={[]} onIndicatorsChange={onChange} onClose={() => {}} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'BSS' } });
    expect(screen.getByText(/BSS 买卖强度综合分（−1 ~ 1）/)).toHaveAttribute('title', expect.stringContaining('BSS = 0.45·M标准化 + 0.25·Vd + 0.30·A'));
    fireEvent.click(screen.getByText('买卖强度综合分 BSS'));
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ type: 'BSS', period: 1, enabled: true })]);
  });
});
