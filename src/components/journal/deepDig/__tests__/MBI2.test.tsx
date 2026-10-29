import {useState} from 'react';
import {render,screen,fireEvent,within} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {MBI2_DEF,MBI2_BEAR_DEF} from '@/lib/deepDig/features';
import {KlineSettings} from '../DefinitionPanel';
import {FeatureView} from '../FeatureView';
import {makeData} from '@/lib/deepDig/__tests__/fixtures';
import {snapshotOf} from '@/lib/deepDig/analysis';
import {defaultFeatureCommands} from '@/lib/deepDig/commands';
import {Mbi2EvaluationView} from '../Mbi2EvaluationView';
import {finishMbi2Evaluation} from '@/lib/deepDig/mbi2Evaluation';
it('calendar default follows the timeframe and manual hours derive n without a manual n input',()=>{
 function Parameters(){const[value,setValue]=useState({...MBI2_DEF,interval:'5m' as const,halfLifeHours:6,avgHours:24});return <KlineSettings value={value} onChange={v=>setValue(v as typeof value)} testId="mbi2-config"/>;}
 render(<Parameters/>);expect(screen.getByLabelText('MBI2_N')).toHaveTextContent('25');expect(screen.queryByRole('spinbutton',{name:'MBI2_N'})).not.toBeInTheDocument();
 expect(screen.getByTestId('mbi2-config-summary')).toHaveTextContent('701 根');
 fireEvent.click(screen.getByTestId('mbi2-config-interval-15m'));expect(screen.getByLabelText('MBI2_T_HOURS')).toHaveValue(6.25);expect(screen.getByLabelText('MBI2_N')).toHaveTextContent('25');
 fireEvent.click(screen.getByTestId('mbi2-config-interval-5m'));fireEvent.change(screen.getByLabelText('MBI2_T_HOURS'),{target:{value:'12'}});fireEvent.blur(screen.getByLabelText('MBI2_T_HOURS'));
 expect(screen.getByLabelText('MBI2_N')).toHaveTextContent('144');expect(screen.getByTestId('mbi2-config-summary')).toHaveTextContent('1296 根');
 fireEvent.click(screen.getByTestId('mbi2-config-interval-15m'));expect(screen.getByLabelText('MBI2_T_HOURS')).toHaveValue(12);expect(screen.getByLabelText('MBI2_N')).toHaveTextContent('48');
});
it.each([MBI2_DEF,MBI2_BEAR_DEF])('shows all five outputs in order for $id, including Chinese state',def=>{
 const core=def.chartCore!,seller=def.id==='mbi2-bear';
 const data=makeData();data.definition=snapshotOf(def);data.rows=[{...data.rows[1],group:'positive',v:seller?-.5:.5,vars:{[core]:seller?-.5:.5,['avg_'+core+'_2']:.3,[core+'_state']:seller?-2:2,[core+'_lead_h']:3,[core+'_confirm_h']:1}}];
 render(<FeatureView def={def} data={data} inference={null} series={null} editing={false} onEditingChange={vi.fn()} onSaveDef={vi.fn()} samples={{campaigns:[],signals:[]}} describeStatus="idle" describeProgress={null} describeError={null} canDescribe onDescribe={vi.fn()} onCancel={vi.fn()} inferStatus="idle" inferError={null} onInfer={vi.fn()} onDownload={vi.fn()} commands={defaultFeatureCommands('mbi2')} onCommandsChange={vi.fn()} excluded={[]} onExcludedChange={vi.fn()} tab="describe" onTabChange={vi.fn()} group="positive" onGroupChange={vi.fn()} showAll onShowAllChange={vi.fn()} onOpenCampaign={vi.fn()} note={null} onSaveNote={vi.fn()}/>);
 const table=screen.getByTestId('deep-dig-rows'),heads=within(table).getAllByRole('columnheader').map(e=>e.textContent);
 const expected=seller?['MBI2·卖方','avg_MBI2_bear_2','MBI2 卖方状态','MBI2 卖方本轮持续小时','MBI2 卖方确认持续小时']:['MBI2','avg_MBI2_2','MBI2 状态','MBI2 本轮持续小时','MBI2 确认持续小时'];
 const indices=expected.map(name=>heads.indexOf(name));expect(indices.every(i=>i>=0)).toBe(true);expect(indices).toEqual([...indices].sort((a,b)=>a-b));expect(within(table).getByText(seller?'卖方确认':'买方确认')).toBeVisible();
});
it('reports missing evaluation data honestly and keeps wide scans in a scroll container',()=>{
 const report=finishMbi2Evaluation([], [{campaignId:'missing',delta:null,nMin:null,ceilN:null,hours:null,reason:'missing'}],snapshotOf(MBI2_DEF),5);
 render(<Mbi2EvaluationView report={report}/>);expect(screen.getByTestId('mbi2-recommendation')).toHaveTextContent('缺数据 1 场');expect(screen.getByTestId('mbi2-recommendation')).toHaveTextContent('25%分位 —h');expect(screen.getByRole('button',{name:'下载 MBI2 扫描 CSV'})).toBeEnabled();
 for(const table of screen.getAllByTestId('mbi2-scan-table'))expect(table.parentElement).toHaveClass('overflow-auto');
});
