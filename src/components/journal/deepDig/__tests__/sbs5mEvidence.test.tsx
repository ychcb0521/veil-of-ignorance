import {expect,it,vi} from 'vitest';
import {fireEvent,render,screen} from '@testing-library/react';
import {Sbs5mEvidenceView} from '../Sbs5mEvidenceView';
import {DefinitionPanel} from '../DefinitionPanel';
import {SBS5M_DEF} from '@/lib/deepDig/features';
import {computeSbs5m} from '@/lib/sbs5m';
import {sbsComplete} from '@/lib/__tests__/fixtures/sbsBars';
import type {DeepDigData} from '@/lib/deepDig/analysis';
import type {DeepDigSeries} from '@/lib/deepDig/series';
it('shows confirmed price, independent evidence and explicit invalidation, with collapsed audit details',()=>{
 const bars=sbsComplete(),out=computeSbs5m(bars,{symbol:'UI'}),id='example';
 const data={definition:SBS5M_DEF,rows:[{id,symbol:'UI',anchorMs:out.rows.at(-1).at,SBS5M_details:out.rows.at(-1)}]} as unknown as DeepDigData;
 const series={SBS5M_windows:{[id]:{rows:out.rows,prices:bars.map(b=>({time:b.openTime+300000,close:b.close}))}}} as unknown as DeepDigSeries;
 const {container}=render(<Sbs5mEvidenceView data={data} series={series}/>);expect(screen.getByText('结构失效')).toBeInTheDocument();
 expect(container.querySelector('details')).not.toHaveAttribute('open');
 fireEvent.change(screen.getByLabelText('SBS5M 已收盘时点'),{target:{value:45}});expect(screen.getByText('支撑有效')).toBeInTheDocument();expect(screen.getByText('104')).toBeInTheDocument();
 expect(container.querySelector('[data-sbs-line="support_price"]').getAttribute('d')).toContain(' H');
 expect(screen.getByText('证据分 / 100')).toBeInTheDocument();
});
it('rejects invalid native parameters before saving and exposes their units and bounds',()=>{
 const saved=vi.fn();render(<DefinitionPanel def={SBS5M_DEF} editing onEditingChange={()=>{}} onSave={saved} samples={{campaigns:[],signals:[]}}/>);
 fireEvent.change(screen.getByLabelText('SBS5M 参数配置'),{target:{value:'{"box_formation_bars":0}'}});fireEvent.click(screen.getByRole('button',{name:/^保存$/}));expect(saved).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toHaveTextContent('参数越界');
 fireEvent.change(screen.getByLabelText('SBS5M 参数配置'),{target:{value:'{"active_box_max_age":5}'}});fireEvent.click(screen.getByRole('button',{name:/^保存$/}));expect(saved.mock.lastCall[0].SBS5M_config).toEqual({active_box_max_age:5});
});

it('lets price research select one symbol before running while preserving the saved definition',()=>{
 const saved=vi.fn(),samples={campaigns:[{symbol:'BTCUSDT'},{symbol:'ETHUSDT'}],signals:[]} as unknown as Parameters<typeof DefinitionPanel>[0]['samples'];
 render(<DefinitionPanel def={SBS5M_DEF} editing={false} onEditingChange={()=>{}} onSave={saved} samples={samples}/>);
 fireEvent.change(screen.getByLabelText('SBS5M 研究标的'),{target:{value:'ETHUSDT'}});expect(saved.mock.lastCall[0]).toMatchObject({id:'sbs_5m',SBS5M_research_symbol:'ETHUSDT'});
});
