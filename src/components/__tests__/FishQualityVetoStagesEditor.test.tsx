import {useState} from 'react';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,it,expect} from 'vitest';
import {FishQualityVetoStagesEditor,type VetoStagesDraft} from '../FishQualityVetoStagesEditor';
afterEach(cleanup);
function Editor(){const [draft,setDraft]=useState<VetoStagesDraft>({enabled:false,mode:'overlay',peakBasis:'stage',stages:[]});return <FishQualityVetoStagesEditor draft={draft} setDraft={setDraft}/>;}
it('provides editable 6/20 and 7/15 stages, independent profiles, add/remove, mode and peak selection',()=>{
 render(<Editor/>);expect(screen.queryByRole('tab')).toBeNull();fireEvent.click(screen.getByLabelText('启用一票条件次数切换'));expect(screen.getByLabelText('一票次数切换峰值口径')).toHaveValue('stage');expect(screen.getByLabelText('一票条件切换加仓次数')).toHaveValue(6);expect(screen.getByLabelText('一票切换 1 持仓否决 1 阈值')).toHaveValue(20);
 fireEvent.change(screen.getByLabelText('一票切换 1 持仓否决 1 阈值'),{target:{value:'25'}});fireEvent.click(screen.getByRole('tab',{name:'第 7 次后'}));expect(screen.getByLabelText('一票切换 2 持仓否决 1 阈值')).toHaveValue(15);fireEvent.change(screen.getByLabelText('一票条件切换加仓次数'),{target:{value:'8'}});fireEvent.click(screen.getByRole('button',{name:'添加否决条件'}));expect(screen.getByLabelText('一票切换 2 持仓否决 2 指标')).toHaveValue('static-drawdown');fireEvent.click(screen.getByRole('tab',{name:'第 6 次后'}));expect(screen.getByLabelText('一票切换 1 持仓否决 1 阈值')).toHaveValue(25);expect(screen.queryByLabelText('一票切换 1 持仓否决 2 指标')).toBeNull();
 fireEvent.change(screen.getByLabelText('一票次数切换条件范围'),{target:{value:'replace'}});fireEvent.change(screen.getByLabelText('一票次数切换峰值口径'),{target:{value:'stage'}});expect(screen.getByLabelText('一票次数切换条件范围')).toHaveValue('replace');expect(screen.getByLabelText('一票次数切换峰值口径')).toHaveValue('stage');
 fireEvent.click(screen.getByRole('button',{name:'添加一票切换阶段'}));expect(screen.getByLabelText('一票条件切换加仓次数')).toHaveValue(9);fireEvent.click(screen.getByLabelText('删除当前一票切换阶段'));expect(screen.getAllByRole('tab')).toHaveLength(2);fireEvent.click(screen.getByLabelText('启用一票条件次数切换'));expect(screen.queryByRole('tab')).toBeNull();fireEvent.click(screen.getByLabelText('启用一票条件次数切换'));expect(screen.getByRole('tab',{name:'第 8 次后'})).toBeInTheDocument();
});
