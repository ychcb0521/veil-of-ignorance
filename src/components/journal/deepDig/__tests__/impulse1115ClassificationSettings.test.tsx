import {expect,it,vi} from 'vitest';
import {fireEvent,render,screen,within} from '@testing-library/react';
import {useState} from 'react';
import {DefinitionPanel} from '../DefinitionPanel';
import {IndicatorMenu} from '@/components/IndicatorMenu';
import {IMPULSE_1115_CLASSIFICATION_DEF,definitionKey} from '@/lib/deepDig/features';
import {IMPULSE_1115_CLASSIFICATION_LABEL,IMPULSE_1115_CLASSIFICATION_CHART_ID} from '@/lib/impulse1115Classification';
import type {IndicatorConfig} from '@/components/CandlestickChart';
import {visibleIndicatorCompanions} from '@/lib/customIndicators';

it('编辑分类阈值保存后完整恢复，错误参数阻止保存，原始对象不被修改',()=>{
  const saved=vi.fn(),original=JSON.stringify(IMPULSE_1115_CLASSIFICATION_DEF);
  const props={def:IMPULSE_1115_CLASSIFICATION_DEF,editing:true,onEditingChange:vi.fn(),onSave:saved,samples:{campaigns:[],signals:[]}};
  const view=render(<DefinitionPanel {...props}/>);
  fireEvent.change(screen.getByLabelText('有效跌破连续收盘'),{target:{value:'3'}});
  fireEvent.change(screen.getByLabelText('回踩附近容差'),{target:{value:'0.375123456'}});
  fireEvent.click(screen.getByRole('button',{name:/^保存$/}));
  expect(saved).toHaveBeenCalledOnce();
  const def=saved.mock.lastCall![0];
  expect(def.DBL5C_parameters).toMatchObject({breakCloses:3,nearAtr:.375123456});
  expect(definitionKey(def)).not.toBe(definitionKey(IMPULSE_1115_CLASSIFICATION_DEF));
  expect(JSON.stringify(IMPULSE_1115_CLASSIFICATION_DEF)).toBe(original);
  view.unmount();
  render(<DefinitionPanel {...props} def={JSON.parse(JSON.stringify(def))}/>);
  expect(screen.getByLabelText('回踩附近容差')).toHaveValue(.375123456);
  fireEvent.change(screen.getByLabelText('有效跌破连续收盘'),{target:{value:''}});
  fireEvent.click(screen.getByRole('button',{name:/^保存$/}));
  expect(saved).toHaveBeenCalledOnce();
  expect(screen.getAllByText(/有效跌破连续收盘须为/).length).toBeGreaterThan(0);
});

it('原急拉线与持仓分类可同时选择，新增项不自动套用旧配置',()=>{
  const changed=vi.fn();
  function Menu(){
    const [items,setItems]=useState<IndicatorConfig[]>([{type:'DBL5_IMPULSE_1115',period:3,enabled:true}]);
    return <IndicatorMenu open indicators={items} onClose={()=>{}} onIndicatorsChange={items=>{setItems(items);changed(items);}}/>;
  }
  render(<Menu/>);
  expect(changed).not.toHaveBeenCalled();
  const group=screen.getByRole('region',{name:'达瓦斯箱体 · 5m'});
  fireEvent.click(within(group).getByText(IMPULSE_1115_CLASSIFICATION_LABEL));
  const items=changed.mock.lastCall![0];
  expect(items.map((item:IndicatorConfig)=>item.type)).toEqual(['DBL5_IMPULSE_1115',IMPULSE_1115_CLASSIFICATION_CHART_ID]);
  expect(visibleIndicatorCompanions(items[1])).toEqual([]);
  expect(screen.queryByLabelText(IMPULSE_1115_CLASSIFICATION_LABEL+' 防守线版本')).not.toBeInTheDocument();
  fireEvent.click(within(group).getByLabelText(IMPULSE_1115_CLASSIFICATION_LABEL+' 说明'));
  expect(within(group).getByText(/蓝色线为一类，橙色线为二类/)).toBeInTheDocument();expect(within(group).queryByText(/第1、2种|第3至6种|1至6/)).not.toBeInTheDocument();
});
