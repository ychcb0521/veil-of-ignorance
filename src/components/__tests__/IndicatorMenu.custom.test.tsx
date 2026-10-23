import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { IndicatorMenu, INDICATOR_CATALOG, CUSTOM_INDICATOR_GROUPS } from '@/components/IndicatorMenu';
import type { IndicatorConfig } from '@/components/CandlestickChart';
import { CUSTOM_INDICATOR_MAP, INDICATOR_COMPANIONS, indicatorCalcParams, registerCustomIndicators, visibleIndicatorCompanions } from '@/lib/customIndicators';

const registered = vi.hoisted(() => new Map<string, any>());
vi.mock('klinecharts', () => ({ registerIndicator: (template: any) => registered.set(template.name, template) }));
registerCustomIndicators();
beforeEach(() => localStorage.clear());
const ids = ['DSP_VA', 'BSS', 'CBA', 'DSP_Z', 'CBI2', 'STATE', 'CDI2', 'SELLER_CONTROL', 'DSS', 'CDA'];
const name = (id: string) => INDICATOR_CATALOG.find(item => item.id === id)!.nameZh;

describe('自制区的十个特征值', () => {
  it('按 Deep dig 图示的顺序集中列出十项，均可添加；成交量分类不再混入这些特征值', () => {
    expect(INDICATOR_CATALOG.filter(item => item.category === 'custom').map(item => item.id)).toEqual(ids);
    const changed = vi.fn();
    render(<IndicatorMenu open indicators={[]} onClose={() => {}} onIndicatorsChange={changed} />);
    fireEvent.click(screen.getByRole('button', { name: '自制区' }));
    for (const id of ids.filter(id => id !== 'DSP_VA')) { expect(screen.getByText(name(id))).toBeInTheDocument(); expect(CUSTOM_INDICATOR_MAP[id]).toBeTruthy(); }
    expect(screen.queryByText('成交量加权平均价')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '成交量' }));
    for (const id of ids) expect(screen.queryByText(name(id))).not.toBeInTheDocument();
    expect(changed).not.toHaveBeenCalled(); // 分类不改已有选择或参数。
  });

  it('自制区按三个模块分组；搜索后只保留命中的模块，选择状态不变', () => {
    const changed = vi.fn();
    render(<IndicatorMenu open indicators={[]} onClose={() => {}} onIndicatorsChange={changed} />);
    fireEvent.click(screen.getByRole('button', { name: '自制区' }));
    for (const group of CUSTOM_INDICATOR_GROUPS) {
      const section = screen.getByRole('region', { name: group.title });
      for (const id of group.ids) expect(within(section).getByText(name(id))).toBeInTheDocument();
    }
    fireEvent.change(screen.getByPlaceholderText('搜索指标 (MACD / RSI / BOLL ...)'), { target: { value: 'DSS' } });
    expect(screen.getAllByRole('region')).toHaveLength(1);
    expect(screen.getByRole('region', { name: '与过去24 小时相比' })).toBeInTheDocument();
    expect(changed).not.toHaveBeenCalled();
  });

  it('隐藏普通 DSP·a，保留 Z 分数版的添加、调参和关闭', () => {
    const changed = vi.fn();
    function Menu() {
      const [items, setItems] = useState<IndicatorConfig[]>([]);
      return <IndicatorMenu open indicators={items} onClose={() => {}} onIndicatorsChange={next => { setItems(next); changed(next); }} />;
    }
    render(<Menu />);
    fireEvent.click(screen.getByRole('button', { name: '自制区' }));
    expect(screen.queryByText(name('DSP_VA'))).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(name('DSP_Z')));
    expect(changed.mock.lastCall![0][0]).toMatchObject({ type: 'DSP_Z', zscore: true });
    fireEvent.change(screen.getByLabelText(name('DSP_Z') + ' 参数'), { target: { value: '12' } });
    expect(changed.mock.lastCall![0][0].period).toBe(12);
    fireEvent.click(screen.getByText(name('DSP_Z')));
    expect(changed.mock.lastCall![0]).toEqual([]);
  });

  it('十项默认隐藏普通均值，avg 按钮只切换可见性，保留参数、原值和加权均值', () => {
    const initial = ids.map(type => ({ type, period: 6, enabled: true }));
    const changed = vi.fn();
    function Menu() { const [items,setItems] = useState<IndicatorConfig[]>(initial); return <IndicatorMenu open indicators={items} onClose={() => {}} onIndicatorsChange={next => {setItems(next);changed(next)}}/>; }
    render(<Menu />); fireEvent.click(screen.getByRole('button',{name:'自制区'}));
    for(const id of ids.filter(id => id !== 'DSP_VA')){
      const ind=initial.find(i=>i.type===id)!;
      expect(visibleIndicatorCompanions(ind).some(c=>c.kcName.includes('_AVG_CUSTOM'))).toBe(false);
      expect(visibleIndicatorCompanions(ind).some(c=>c.kcName.includes('_AVG2_CUSTOM'))).toBe(true);
      const button=screen.getByRole('button',{name:name(id)+' 显示 avg_x'});
      expect(button).toHaveAttribute('aria-pressed','false');fireEvent.click(button);
      expect(button).toHaveAttribute('aria-pressed','true');
      const next=changed.mock.lastCall![0].find((i:IndicatorConfig)=>i.type===id);
      expect(next).toEqual({...ind,showAverage:true});
      expect(visibleIndicatorCompanions(next).length).toBe(visibleIndicatorCompanions(ind).length+1);
      fireEvent.click(button);expect(button).toHaveAttribute('aria-pressed','false');
      expect(changed.mock.lastCall![0].find((i:IndicatorConfig)=>i.type===id)).toEqual({...ind,showAverage:false});
    }
  });

  it('标题栏拖动卡片并限制在视口内，关闭按钮不启动拖动', () => {
    const close = vi.fn();
    render(<IndicatorMenu open indicators={[]} onClose={close} onIndicatorsChange={() => {}} />);
    const header = screen.getByTitle('拖动标题栏移动卡片');
    const panel = header.parentElement!;
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 100, width: 384, height: 400, right: 484, bottom: 500, x: 100, y: 100, toJSON() {} });
    header.setPointerCapture = vi.fn();
    header.hasPointerCapture = () => false;
    const pointer = (type: string, x: number, y: number, target = header) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { pointerId: 1, button: 0, clientX: x, clientY: y });
      fireEvent(target, event);
    };
    pointer('pointerdown', 120, 120);
    pointer('pointermove', 220, 170);
    expect(panel.style.transform).toBe('translate(100px, 50px)');
    pointer('pointermove', -1000, -1000);
    expect(panel.style.transform).toBe('translate(-92px, -92px)');
    pointer('pointerup', -1000, -1000);
    pointer('pointermove', 500, 500);
    expect(panel.style.transform).toBe('translate(-92px, -92px)');
    pointer('pointerdown', 120, 120, header.querySelector('button')!);
    expect(header.setPointerCapture).toHaveBeenCalledTimes(1);
    fireEvent.click(header.querySelector('button')!);
    expect(close).toHaveBeenCalledOnce();
  });

  it('Z 版使用独立的原生副图名称，复用现有 Z 公式和均值，参数不串到普通版', () => {
    const data = Array.from({ length: 700 }, (_, i) => ({ timestamp: i * 300000, open: 100, high: 102, low: 98,
      close: 100 + Math.sin(i / 7), volume: 1000, turnover: 100000 + 1000 * Math.cos(i / 11), takerBuyTurnover: 50000 + 20000 * Math.sin(i / 13) }));
    const base = INDICATOR_COMPANIONS.DSP_VA, z = INDICATOR_COMPANIONS.DSP_Z;
    expect(new Set([...base, ...z].map(item => item.kcName)).size).toBe(6);
    for (let i = 0; i < z.length; i++) {
      const params = indicatorCalcParams(z[i].kcName, { period: 6, avgHours: 12 });
      const expectedParams = indicatorCalcParams(base[i].kcName, { period: 6, avgHours: 12, zscore: true });
      expect(params).toEqual(expectedParams);
      const actual = registered.get(z[i].kcName).calc(data, { calcParams: params });
      expect(actual).toEqual(registered.get(base[i].kcName).calc(data, { calcParams: expectedParams }));
    }
    expect(indicatorCalcParams('DSP_V_CUSTOM', { period: 12 })).toEqual([12, 0, expect.any(Number), expect.any(Number)]);
    expect(indicatorCalcParams('DSP_Z_V_CUSTOM', { period: 6 })).toEqual([6, 1, expect.any(Number), expect.any(Number)]);
  });
});
