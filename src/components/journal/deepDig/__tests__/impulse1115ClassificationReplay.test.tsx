import {expect,it} from 'vitest';
import {fireEvent,render,screen} from '@testing-library/react';
import {Impulse1115ClassificationReplay} from '../Impulse1115ClassificationReplay';
import {IMPULSE_1115_CLASSIFICATION_DEF,compileFeatureFormula,evaluateOnBars} from '@/lib/deepDig/features';
import {snapshotOf,type DeepDigData} from '@/lib/deepDig/analysis';
import {deepDigCsv} from '@/lib/deepDig/export';
import {bar,impulse,warm,TICK} from '@/lib/__tests__/fixtures/dbl5GuardPlusBars';
import {Dbl5GuardPlusEngine} from '@/lib/dbl5GuardPlus';
import {classificationExamples} from '@/lib/__tests__/fixtures/impulse1115ClassificationBars';

it('冻结每条线的历史：收复前后逐根回放不会提前显示修复，CSV包含分类与检查点',()=>{
  const seed=[...warm(),impulse()],native=new Dbl5GuardPlusEngine({symbol:'TESTUSDT',tickSize:TICK});
  const early=seed.map(b=>native.push(b)).at(-1)!.plus.early_impulse_event!;
  const price=(x:number)=>Math.round((early.impulse_guard_value+(x-100)*early.frozen_atr)*100)/100;
  const tail=classificationExamples[5].bars.map((b,i)=>bar(i+21,price(b.open),price(b.high),price(b.low),price(b.close)));
  const def=IMPULSE_1115_CLASSIFICATION_DEF;
  const result=evaluateOnBars([...seed,...tail],compileFeatureFormula(def.formula),{...def,DBL5_symbol:'TESTUSDT',DBL5_tick_size:TICK});
  const rows=result.DBL5C_details!,last=rows.at(-1)!;
  const data={definition:snapshotOf(def),rows:[{id:'frozen',symbol:'TESTUSDT',anchorMs:last.at,group:'other',
    DBL5C_details:last,DBL5C_checkpoint:result.DBL5C_checkpoint,v:2,vars:{DBL5C:2}}]} as unknown as DeepDigData;
  render(<Impulse1115ClassificationReplay data={data} series={{DBL5_windows:{frozen:{rows:[],prices:[],classificationRows:rows}}} as never}/>);
  expect(screen.getAllByText('二类｜修复确认').length).toBeGreaterThan(0);
  fireEvent.change(screen.getByLabelText('持仓分类回放时点'),{target:{value:22}});
  expect(screen.queryByText('二类｜修复确认')).not.toBeInTheDocument();
  expect(screen.getAllByText('二类｜已跌破，等待反抽结果').length).toBeGreaterThan(0);
  const exported=deepDigCsv(data);
  expect(exported).toContain('DBL5C_details,DBL5C_checkpoint,DBL5C_parameters');
  expect(exported).toContain('REPAIRED');
  expect(exported).toContain('breakCloses');
});

it('定义快照复制分类参数，后续编辑不会改变冻结证据；旧结果只提示没有证据',()=>{
  const def={...IMPULSE_1115_CLASSIFICATION_DEF,DBL5C_parameters:{breakCloses:3}};
  const snapshot=snapshotOf(def);
  def.DBL5C_parameters.breakCloses=4;
  expect(snapshot.DBL5C_parameters?.breakCloses).toBe(3);
  render(<Impulse1115ClassificationReplay data={{rows:[],definition:snapshot} as unknown as DeepDigData}/>);
  expect(screen.getByText(/本份冻结结果没有持仓分类证据/)).toBeInTheDocument();
});
