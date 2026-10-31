import {expect,it,vi} from 'vitest';
import {fireEvent,render,screen} from '@testing-library/react';
import {Dbl5EvidenceView} from '../Dbl5EvidenceView';
import {DefinitionPanel} from '../DefinitionPanel';
import {DBL5_DEF} from '@/lib/deepDig/features';
import {computeDbl5} from '@/lib/dbl5m';
import {sample,T} from '@/lib/__tests__/fixtures/dblBars';
import type {DeepDigData} from '@/lib/deepDig/analysis';
import type {DeepDigSeries} from '@/lib/deepDig/series';
it('renders confirmed price and a separate break event despite the null final support; audit is folded',()=>{
 const bars=sample(),out=computeDbl5(bars,{symbol:'UI'}),id='example',data={definition:DBL5_DEF,rows:[{id,symbol:'UI',anchorMs:out.rows.at(-1).at,DBL5_details:out.rows.at(-1)}]} as unknown as DeepDigData,series={DBL5_windows:{[id]:{rows:out.rows,prices:bars.map(b=>({time:b.openTime+300000,close:b.close}))}}} as unknown as DeepDigSeries;
 const {container}=render(<Dbl5EvidenceView data={data} series={series}/>);expect(screen.getByText('本根 · 支撑破坏')).toBeInTheDocument();expect(screen.getByText(/本窗口有效 10 根 · 空值 8 根/)).toBeInTheDocument();expect(container.querySelector('details')).not.toHaveAttribute('open');
 fireEvent.change(screen.getByLabelText('DBL5 已收盘时点'),{target:{value:14}});expect(screen.getAllByText('完整上移').length).toBeGreaterThan(0);expect(screen.getByText('本根 · 无新事件')).toBeInTheDocument();expect(screen.getByText('102')).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('DBL5 事件筛选'),{target:{value:'SUPPORT_BROKEN'}});expect(screen.getByText(/ · 支撑破坏$/)).toBeInTheDocument();expect(container.querySelector('[data-dbl-line="lower"]').getAttribute('d')).toContain(' H');
});
it('blocks invalid n before saving and lets the user pin symbol and replay origin',()=>{
 const saved=vi.fn();render(<DefinitionPanel def={DBL5_DEF} editing onEditingChange={()=>{}} onSave={saved} samples={{campaigns:[],signals:[]}}/>);
 fireEvent.change(screen.getByLabelText('DBL5 参数配置'),{target:{value:'{"n":36}'}});fireEvent.click(screen.getByRole('button',{name:/^保存$/}));expect(saved).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toHaveTextContent('2n+1<W');
 fireEvent.change(screen.getByLabelText('DBL5 参数配置'),{target:{value:'{"n":3,"window_minutes":360}'}});fireEvent.change(screen.getByLabelText('DBL5 回放起点'),{target:{value:'2026-10-30T08:00'}});fireEvent.click(screen.getByRole('button',{name:/^保存$/}));expect(saved.mock.lastCall[0]).toMatchObject({DBL5_config:{n:3,window_minutes:360},DBL5_initialization_start:T});
});
