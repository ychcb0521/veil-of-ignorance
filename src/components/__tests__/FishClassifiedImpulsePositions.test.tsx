import {useState} from 'react';
import {render,screen,within,fireEvent} from '@testing-library/react';
import {it,expect,vi} from 'vitest';
import {FishQualityAdditionEditor,additionDraft,parseAdditionDraft} from '../FishQualityAdditionEditor';
import {HoldingMonitorSettings} from '../FishHoldingMonitorSettings';
import {BUILTIN_FEATURES} from '@/lib/deepDig/features';
import {defaultQualityAddition,type QualityAdditionRule} from '@/lib/fish/qualityAddition';
import {defaultStructureAddition} from '@/lib/fish/qualityAdditionStructure';
import {classifiedImpulsePositionLabel,defaultClassifiedImpulsePosition,CLASSIFIED_IMPULSE_POSITION_VERSION,CLASSIFIED_IMPULSE_LINE_K_POSITION_VERSION} from '@/lib/fish/qualityClassifiedImpulsePosition';
import {IMPULSE_1115_POSITION_VERSION,IMPULSE_1115_DISPLAY_NAME} from '@/lib/dbl5GuardPlus';
import {defaultHoldingImpulse1115Rule} from '@/lib/fish/holdingImpulse1115Classification';
import {newQualityStudy,type QualityGroup} from '@/lib/fish/quality';
import {makeQualitySellPlan} from '@/lib/fish/qualitySellPlans';
import type {FishQualityState} from '@/hooks/useFishQuality';
function Editor({initial=defaultQualityAddition()}:{initial?:QualityAdditionRule}){
 const [draft,setDraft]=useState(()=>additionDraft(initial));return <><FishQualityAdditionEditor draft={draft} setDraft={setDraft}/><button onClick={()=>document.querySelector('output')!.textContent=JSON.stringify(parseAdditionDraft(draft,BUILTIN_FEATURES))}>验证保存</button><output/></>;
}
const save=()=>{fireEvent.click(screen.getByRole('button',{name:'验证保存'}));return JSON.parse(document.querySelector('output')!.textContent!);};
it('位置保留原四项再增一／二类，按轮选择、填写和保存，主界面没有展开判定参数',()=>{
 render(<Editor/>);fireEvent.click(screen.getByLabelText('启用条件加仓'));
 const choices=()=>within(screen.getByRole('group',{name:'本轮位置策略'}));expect(choices().getAllByRole('checkbox')).toHaveLength(6);
 for(const mainClass of [1,2] as const)fireEvent.click(choices().getByLabelText(classifiedImpulsePositionLabel(mainClass)));
 fireEvent.click(choices().getAllByRole('checkbox')[0]);
 expect(screen.getByText('K＝急拉线（一类） − N × ATR')).toBeVisible();expect(screen.getByText('K＝急拉线（二类） − N × ATR')).toBeVisible();
 fireEvent.change(screen.getByLabelText(classifiedImpulsePositionLabel(1)+' N（ATR 倍数）'),{target:{value:'0.712345678901234'}});
 fireEvent.change(screen.getByLabelText(classifiedImpulsePositionLabel(2)+' N（ATR 倍数）'),{target:{value:'1.1'}});
 expect(screen.getAllByText('分类判定参数').every(e=>!e.parentElement!.hasAttribute('open'))).toBe(true);
 fireEvent.click(screen.getByRole('tab',{name:'第 2 次'}));expect(choices().getByLabelText(classifiedImpulsePositionLabel(1))).not.toBeChecked();
 fireEvent.click(choices().getByLabelText(classifiedImpulsePositionLabel(2)));fireEvent.click(choices().getAllByRole('checkbox')[0]);
 fireEvent.change(screen.getByLabelText(classifiedImpulsePositionLabel(2)+' N（ATR 倍数）'),{target:{value:'0.4'}});
 fireEvent.click(screen.getByRole('tab',{name:'第 1 次'}));expect(screen.getByLabelText(classifiedImpulsePositionLabel(1)+' N（ATR 倍数）')).toHaveValue(.712345678901234);
 const saved=save();expect(saved.rounds[0].classifiedImpulsePositions.map((p:{mainClass:number;bufferAtr:number;skipNative?:true})=>[p.mainClass,p.bufferAtr,p.skipNative])).toEqual([[1,.712345678901234,true],[2,1.1,true]]);
 expect(saved.rounds[1].classifiedImpulsePositions).toMatchObject([{mainClass:2,bufferAtr:.4,skipNative:true}]);expect(saved.rounds[2].classifiedImpulsePositions).toBeUndefined();
 expect(saved.classifiedImpulsePositions).toEqual(saved.rounds[0].classifiedImpulsePositions);
 expect(saved.rounds.flatMap((r:{classifiedImpulsePositions?:{version:string}[]})=>r.classifiedImpulsePositions??[]).every((p:{version:string})=>p.version===CLASSIFIED_IMPULSE_LINE_K_POSITION_VERSION)).toBe(true);
},20000);
it('旧急拉线版本可与新分类并选，原版参数和模板对象不改写',()=>{
 const raw={version:IMPULSE_1115_POSITION_VERSION} as const,initial:QualityAdditionRule={...defaultQualityAddition(),enabled:true,source:'structure',stricterPct:10,structure:defaultStructureAddition(),impulse1115Position:raw,maxRounds:1,rounds:[{source:'structure',stricterPct:10,structure:defaultStructureAddition(),impulse1115Position:raw}]},before=JSON.stringify(initial);
 render(<Editor initial={initial}/>);const choices=within(screen.getByRole('group',{name:'本轮位置策略'}));expect(choices.getByLabelText(IMPULSE_1115_DISPLAY_NAME)).toBeChecked();
 fireEvent.click(choices.getByLabelText(classifiedImpulsePositionLabel(1)));const saved=save();
 expect(saved.impulse1115Position).toEqual(raw);expect(saved.rounds[0].impulse1115Position).toEqual(raw);expect(saved.rounds[0].classifiedImpulsePositions[0].version).toBe(CLASSIFIED_IMPULSE_LINE_K_POSITION_VERSION);expect(JSON.stringify(initial)).toBe(before);
});
it('真实持仓监测把分类收进位置，新加仓位置和原显示设置独立冻结',()=>{
 const plan={...makeQualitySellPlan('state:state','<',.4,BUILTIN_FEATURES,undefined,'p'),impulse1115Classification:defaultHoldingImpulse1115Rule()},before=JSON.stringify(plan);
 const state={study:{...newQualityStudy(),sellPlans:[plan],sellPlansConfigured:true},ready:true,running:false,error:'',setSellPlans:vi.fn(),setHoldingVetoes:vi.fn(),selectSell:vi.fn()} as unknown as FishQualityState;
 render(<HoldingMonitorSettings state={state} activeId="p" onSelect={()=>{}} done={()=>{}} selectedCount={0}/>);
 expect(state.setSellPlans).not.toHaveBeenCalled();expect(screen.getByTestId('addition-timing')).toContainElement(screen.getByTestId('holding-impulse1115-settings'));
 expect(screen.getByText('分类结果显示设置（本方案）').parentElement).not.toHaveAttribute('open');
 fireEvent.click(screen.getByLabelText('启用条件加仓'));fireEvent.click(within(screen.getByRole('group',{name:'本轮位置策略'})).getByLabelText(classifiedImpulsePositionLabel(1)));
 fireEvent.click(screen.getByRole('button',{name:/^保存到/}));const saved=vi.mocked(state.setSellPlans).mock.lastCall![0] as QualityGroup[];
 expect(saved[0].addition?.rounds?.[0].classifiedImpulsePositions?.[0].mainClass).toBe(1);expect(saved[0].impulse1115Classification).toEqual(plan.impulse1115Classification);expect(JSON.stringify(plan)).toBe(before);
},20000);
it('已存一类保留原公式与 N，只有主动切换才在运行副本采用急拉线基准',()=>{
 const legacy={...defaultClassifiedImpulsePosition(1),bufferAtr:1.5},initial:QualityAdditionRule={...defaultQualityAddition(),enabled:true,source:'structure',stricterPct:10,structure:defaultStructureAddition(),maxRounds:1,classifiedImpulsePositions:[legacy]},before=JSON.stringify(initial);
 render(<Editor initial={initial}/>);
 expect(screen.getByText('K＝起涨低点 − N × ATR')).toBeVisible();expect(save().rounds[0].classifiedImpulsePositions[0]).toMatchObject({version:CLASSIFIED_IMPULSE_POSITION_VERSION,bufferAtr:1.5});
 fireEvent.click(screen.getByRole('button',{name:'改用急拉线公式'}));expect(screen.getByText('K＝急拉线（一类） − N × ATR')).toBeVisible();
 expect(screen.getByLabelText(classifiedImpulsePositionLabel(1)+' N（ATR 倍数）')).toHaveValue(1.5);
 expect(save().rounds[0].classifiedImpulsePositions[0]).toMatchObject({version:CLASSIFIED_IMPULSE_LINE_K_POSITION_VERSION,bufferAtr:1.5});expect(JSON.stringify(initial)).toBe(before);
});
