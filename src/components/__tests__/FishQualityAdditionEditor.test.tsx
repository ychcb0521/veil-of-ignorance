import {HOLDING_LEDGER_ADDITION_VERSION} from '@/lib/fish/qualityHoldingLedger';
import { cleanup,fireEvent,render,screen } from '@testing-library/react';
import { afterEach,expect,it } from 'vitest';
import { useState } from 'react';
import { additionDraft,parseAdditionDraft,parseAdditionSellStages,FishQualityAdditionEditor,GuardLineNotes,BreakevenFloorNotes } from '../FishQualityAdditionEditor';
import { BUILTIN_FEATURES } from '@/lib/deepDig/features';
import { makeQualityBuyFilter } from '@/lib/fish/qualityFilters';
import { defaultQualityAddition, type QualityAdditionRule } from '@/lib/fish/qualityAddition';
import type {VetoStagesDraft} from '../FishQualityVetoStagesEditor';
afterEach(cleanup);
// The original editor regressions intentionally exercise the preserved legacy scope.
function Editor(){const [draft,setDraft]=useState(()=>{const d=additionDraft(defaultQualityAddition());for(const r of [d,...d.otherRounds])for(const v of Object.values(r.entryVetoes))v.historyHours=undefined;return d;});return <><FishQualityAdditionEditor draft={draft} setDraft={setDraft}/><button onClick={()=>{const r=parseAdditionDraft(draft,BUILTIN_FEATURES);document.querySelector('output')!.textContent=JSON.stringify(r);document.querySelector('[data-stages]')!.textContent=JSON.stringify(parseAdditionSellStages(draft,BUILTIN_FEATURES)??null)}}>验证保存</button><output/><pre data-stages/></>}
const save=()=>{fireEvent.click(screen.getByRole('button',{name:'验证保存'}));return JSON.parse(document.querySelector('output')!.textContent!);};
const tab=(n:number)=>fireEvent.click(screen.getByRole('tab',{name:`第 ${n} 次`}));
it('defaults new addition vetoes to six history hours and independently edits or restores their original scope',()=>{
 function NewEditor(){const [draft,setDraft]=useState(()=>additionDraft());return <><FishQualityAdditionEditor draft={draft} setDraft={setDraft}/><button onClick={()=>document.querySelector('output')!.textContent=JSON.stringify(parseAdditionDraft(draft,BUILTIN_FEATURES))}>验证保存</button><output/></>;}
 render(<NewEditor/>);fireEvent.click(screen.getByLabelText('启用条件加仓'));fireEvent.click(screen.getByLabelText('启用加仓否决 冲高回落'));
 expect(screen.getByLabelText('冲高回落 历史回看小时')).toHaveValue(6);fireEvent.change(screen.getByLabelText('冲高回落 历史回看小时'),{target:{value:'12'}});
 expect(save().rounds[0].entryVetoes[0].historyHours).toBe(12);tab(2);expect(save().rounds[1].entryVetoes??[]).toEqual([]);tab(1);
 fireEvent.change(screen.getByLabelText('冲高回落 扫描范围'),{target:{value:'original'}});expect(save().rounds[0].entryVetoes[0].historyHours).toBeUndefined();
});
it('saves the two shared 5m vetoes independently for each addition round and restores their exact parameters',()=>{
 function NewEditor(){const [draft,setDraft]=useState(()=>additionDraft());return <><FishQualityAdditionEditor draft={draft} setDraft={setDraft}/><button onClick={()=>document.querySelector('output')!.textContent=JSON.stringify(parseAdditionDraft(draft,BUILTIN_FEATURES))}>验证保存</button><output/></>;}
 render(<NewEditor/>);fireEvent.click(screen.getByLabelText('启用条件加仓'));
 const stall='启用加仓否决 滞涨转弱（5分钟）',pullback='启用加仓否决 猛烈回调未创新高（5分钟）';
 fireEvent.click(screen.getByLabelText(stall));expect(screen.getByLabelText(pullback)).not.toBeChecked();fireEvent.change(screen.getByLabelText('滞涨转弱（5分钟） 上涨观察根数'),{target:{value:'18'}});
 let saved=save();expect(saved.rounds[0].entryVetoes).toEqual([{kind:'stall-turn',enabled:true,historyHours:6,riseMinutes:90,risePct:1,stallMinutes:15,maxProgressPct:20,turnMinutes:10}]);
 tab(2);expect(screen.getByLabelText(stall)).not.toBeChecked();fireEvent.click(screen.getByLabelText(pullback));saved=save();expect(saved.rounds[1].entryVetoes).toEqual([{kind:'pullback-new-high',enabled:true,historyHours:6,pct:3}]);expect(parseAdditionDraft(additionDraft(saved),BUILTIN_FEATURES)).toEqual(saved);
});
it('offers the lower-wick veto in holding settings, saves it per round, and preserves the same parameters on reopen',()=>{
 render(<Editor/>);fireEvent.click(screen.getByLabelText('启用条件加仓'));
 expect(screen.getByLabelText('启用加仓否决 长下影线')).not.toBeChecked();expect(screen.getByLabelText('长下影线 回看根数')).toHaveValue(12);expect(screen.getByLabelText('长下影线 ATR倍数')).toHaveValue(1.5);expect(screen.getByLabelText('长下影线 下影占比')).toHaveValue(60);
 fireEvent.click(screen.getByLabelText('启用加仓否决 长下影线'));fireEvent.change(screen.getByLabelText('长下影线 回看根数'),{target:{value:'9'}});fireEvent.change(screen.getByLabelText('长下影线 ATR倍数'),{target:{value:'2'}});fireEvent.change(screen.getByLabelText('长下影线 下影占比'),{target:{value:'75'}});
 const saved=save();expect(saved.rounds[0].entryVetoes).toEqual([{kind:'lower-wick',enabled:true,lookbackBars:9,atr:2,ratio:75}]);expect(saved.rounds[1].entryVetoes??[]).toEqual([]);expect(parseAdditionDraft(additionDraft(saved),BUILTIN_FEATURES)).toEqual(saved);
});
it('offers the opt-in double-drop veto with confirmed defaults, saves per round, and roundtrips percentage-only settings',()=>{
 render(<Editor/>);fireEvent.click(screen.getByLabelText('启用条件加仓'));
 expect(screen.getByLabelText('启用加仓否决 二次急跌未收复')).not.toBeChecked();
 expect(screen.getByLabelText('二次急跌未收复 回落ATR倍数')).toHaveValue(2.5);
 expect(screen.getByLabelText('二次急跌未收复 回落百分比')).toHaveValue(4);
 fireEvent.click(screen.getByLabelText('启用加仓否决 二次急跌未收复'));
 const saved=save();expect(saved.rounds[0].entryVetoes).toContainEqual({kind:'double-drop',enabled:true,atr:2.5,pct:4,join:'and'});
 expect(saved.rounds[1].entryVetoes??[]).toEqual([]);
 fireEvent.change(screen.getByLabelText('二次急跌未收复 回落ATR倍数'),{target:{value:''}});
 const pctOnly=save();expect(pctOnly.rounds[0].entryVetoes).toContainEqual({kind:'double-drop',enabled:true,pct:4});
 expect(parseAdditionDraft(additionDraft(pctOnly),BUILTIN_FEATURES)).toEqual(pctOnly);
});
it('shows the selected peak basis beside the dynamic stage condition without changing its 15% threshold',()=>{
 function StageEditor(){
  const [draft,setDraft]=useState(()=>additionDraft({...defaultQualityAddition(),enabled:true}));
  const [vetoStages,setVetoStages]=useState<VetoStagesDraft>({enabled:true,mode:'overlay',peakBasis:'stage',stages:[{afterAdditions:'1',conditions:[{choice:'dynamic-drawdown',direction:'>=',threshold:'15',enabled:true}]}]});
  return <FishQualityAdditionEditor draft={draft} setDraft={setDraft} vetoStages={vetoStages} setVetoStages={setVetoStages}/>;
 }
 render(<StageEditor/>);
 expect(screen.getByTestId('addition-dynamic-drawdown-basis')).toHaveTextContent('参考高点从本次加仓价重新记录');
 expect(screen.getByLabelText('第 1 次加仓后 持仓否决 1 阈值')).toHaveValue(15);
 fireEvent.change(screen.getByLabelText('一票次数切换峰值口径'),{target:{value:'holding'}});
 expect(screen.getByTestId('addition-dynamic-drawdown-basis')).toHaveTextContent('沿用持仓以来最高价，不因加仓重置');
 expect(screen.getByLabelText('第 1 次加仓后 持仓否决 1 阈值')).toHaveValue(15);
});
it('switches the screenshot K row to immediate execution, persists it for every round, and preserves original sizing',()=>{
 render(<Editor/>);fireEvent.click(screen.getByLabelText('启用条件加仓'));
 fireEvent.change(screen.getByLabelText('K基准箱体'),{target:{value:'guard'}});
 fireEvent.click(screen.getByLabelText('防守线保本底线'));
 const original=save();expect(original.kStopVersion).toBeUndefined();
 expect(screen.getByLabelText('碰到K执行版本')).toHaveValue('legacy');
 fireEvent.change(screen.getByLabelText('碰到K执行版本'),{target:{value:'addition-k-touch-v1'}});
 expect(screen.getByTestId('addition-sell-k')).toHaveTextContent('影线算，不等 1 分钟或 5 分钟收盘确认');
 const current=save(),{kStopVersion,...body}=current;expect(kStopVersion).toBe('addition-k-touch-v1');expect(body).toEqual(original);
 tab(2);expect(screen.getByLabelText('碰到K执行版本')).toHaveValue('addition-k-touch-v1');
 expect(parseAdditionDraft(additionDraft(current),BUILTIN_FEATURES)).toEqual(current);
 fireEvent.change(screen.getByLabelText('碰到K执行版本'),{target:{value:'legacy'}});
 expect(save()).toEqual(original);
});
// 【用户要求】2026-11-01 位置只用箱体算法（DBL / SBS），下方一行 K = 旧C − n×ATR，n 由用户自己填（新方案先填 0）。
it('defaults to the box position (S/T/K also offered), with calculator defaults and K = 旧C − n×ATR',()=>{
 render(<Editor/>);expect(screen.getByLabelText('启用条件加仓')).not.toBeChecked();expect(screen.getByLabelText('加仓条件来源')).toBeDisabled();
 for(const part of ['addition-prerequisites','addition-timing','addition-sell'])expect(screen.getByTestId(part)).toBeInTheDocument();expect(screen.getAllByRole('heading',{level:5}).map(h=>h.textContent)).toEqual(['方向','否决','位置','卖出']);expect(screen.getByLabelText('最多加仓次数')).toHaveValue(3);
 fireEvent.click(screen.getByLabelText('启用条件加仓'));
 expect([...(screen.getByLabelText('加仓条件来源') as HTMLSelectElement).options].map(o=>o.value)).toEqual(['structure','custom']);expect(screen.getByLabelText('加仓条件来源')).toHaveValue('structure');
 for(const gone of ['加仓特征值','加仓门槛提高幅度','K回撤ATR倍数','T高于S的ATR倍数','箱体K基准','箱体冗余单位'])expect(screen.queryByLabelText(gone)).toBeNull();
 expect(screen.getByLabelText('箱体加仓算法')).toHaveValue('dbl5');expect(screen.getByLabelText('箱体加仓时机')).toHaveValue('raise');expect(screen.getByLabelText('箱体支撑冗余')).toHaveValue(0);
 expect(screen.getByTestId('addition-timing')).toHaveTextContent('K =');expect(screen.getByTestId('addition-k-row')).toHaveTextContent('× ATR');expect(screen.getByLabelText('K基准箱体')).toHaveValue('previous');expect(screen.getByTestId('addition-timing')).not.toHaveTextContent('K ≤');
 const rule=save();expect(rule).toMatchObject({enabled:true,quantityMode:'calculator',quantity:1,source:'structure',structure:{algorithm:'dbl5',buffer:0}});expect(rule.rounds.map((r:QualityAdditionRule)=>r.source)).toEqual(['structure','structure','structure']);
});
// 【用户要求】2026-11-03 否决加「冲高回落·仅ATR」与三组回放预设（只改冲高回落、仅ATR、长上影线，作用于当前这一次）
it('offers the ATR-only pullback and three replay presets that set the current round only',()=>{
 render(<Editor/>);fireEvent.click(screen.getByLabelText('启用条件加仓'));
 expect(screen.getByLabelText('启用加仓否决 冲高回落·仅ATR')).not.toBeChecked();expect(screen.getByLabelText('冲高回落·仅ATR 回落ATR倍数')).toHaveValue(2.5);
 const vetoes=()=>save().rounds.map((r:{entryVetoes?:{kind:string}[]})=>r.entryVetoes??[]);
 fireEvent.click(screen.getByRole('button',{name:'否决预设 高胜率'}));
 expect(vetoes()[0]).toEqual([{kind:'pullback-atr',enabled:true,atr:2.5,sticky:true}]);expect(vetoes()[1]).toEqual([]);
 fireEvent.click(screen.getByRole('button',{name:'否决预设 高胜率+长上影'}));
 expect(vetoes()[0]).toEqual([{kind:'upper-wick',enabled:true,lookbackBars:12,atr:1.5,ratio:60},{kind:'pullback-atr',enabled:true,atr:2.5,sticky:true}]);
 fireEvent.click(screen.getByRole('button',{name:'否决预设 保大单'}));
 expect(vetoes()[0]).toEqual([{kind:'pullback',enabled:true,atr:2.5,pct:4,join:'and',sticky:true}]);
 tab(2);fireEvent.click(screen.getByRole('button',{name:'否决预设 高胜率'}));expect(vetoes()[1]).toEqual([{kind:'pullback-atr',enabled:true,atr:2.5,sticky:true}]);expect(vetoes()[0]).toEqual([{kind:'pullback',enabled:true,atr:2.5,pct:4,join:'and',sticky:true}]);
});
// 【用户要求】2026-11-03「方向」里可选探测算法与探测值提高百分比
it('adds a detector condition to 方向 with a chosen detector and percentage, per round',()=>{
 render(<Editor/>);fireEvent.click(screen.getByLabelText('启用条件加仓'));
 expect(screen.getByLabelText('启用探测算法方向条件')).not.toBeChecked();expect(screen.getByLabelText('探测值提高百分比')).toBeDisabled();
 fireEvent.click(screen.getByLabelText('启用探测算法方向条件'));fireEvent.change(screen.getByLabelText('探测值提高百分比'),{target:{value:'15'}});
 let rule=save();expect(rule.rounds[0].detectorPrerequisite).toEqual({enabled:true,stricterPct:15});expect(rule.rounds[1].detectorPrerequisite).toBeUndefined();
 const select=screen.getByLabelText('方向探测算法') as HTMLSelectElement,option=[...select.options].find(o=>o.value)!;
 fireEvent.change(select,{target:{value:option.value}});rule=save();expect(rule.rounds[0].detectorPrerequisite).toEqual({enabled:true,stricterPct:15,featureId:option.value});
 expect(parseAdditionDraft(additionDraft(rule),BUILTIN_FEATURES).rounds[0].detectorPrerequisite).toEqual(rule.rounds[0].detectorPrerequisite);
 const bad=additionDraft(rule);bad.detectorPre={...bad.detectorPre,stricterPct:'-1'};expect(()=>parseAdditionDraft(bad,BUILTIN_FEATURES)).toThrow('探测算法');
});
// 【用户要求】2026-11-03 K 最小距离：每次加仓可设，留空＝不限
it('saves the K minimum distance per round and clears it when left empty',()=>{
 render(<Editor/>);fireEvent.click(screen.getByLabelText('启用条件加仓'));
 expect(screen.getByLabelText('K最小距离')).toHaveValue(null);
 fireEvent.change(screen.getByLabelText('K最小距离'),{target:{value:'2'}});
 let rule=save();expect(rule.rounds[0].structure.minDistancePct).toBe(2);expect(rule.rounds[1].structure.minDistancePct).toBeUndefined();
 expect(parseAdditionDraft(additionDraft(rule),BUILTIN_FEATURES).rounds[0].structure.minDistancePct).toBe(2);
 fireEvent.change(screen.getByLabelText('K最小距离'),{target:{value:''}});rule=save();expect(rule.rounds[0].structure.minDistancePct).toBeUndefined();
});
// 【用户要求】2026-11-02 加仓设置的「位置」显示箱体算法版本，ⓘ 里写每个版本的逻辑；保存时冻结版本
it('shows the box algorithm version in 位置, explains every version, and freezes it on save',()=>{
 render(<Editor/>);fireEvent.click(screen.getByLabelText('启用条件加仓'));
 expect(screen.getByTestId('addition-box-version')).toHaveTextContent('DBL-5 v2');
 expect([...(screen.getByLabelText('箱体加仓算法') as HTMLSelectElement).options].map(o=>o.textContent)).toEqual(['DBL-5 v2 · 达瓦斯下轨','SBS-5M v1 · 台阶支撑']);
 expect([...(screen.getByLabelText('K基准箱体') as HTMLSelectElement).options].map(o=>o.textContent)).toContain('防守线 v1（更结实）');
 fireEvent.change(screen.getByLabelText('K基准箱体'),{target:{value:'guard'}});expect(screen.getByTestId('addition-box-version')).toHaveTextContent('DBL-5 v2 · 防守线 v1');
 fireEvent.click(screen.getByLabelText('箱体算法版本说明'));expect(screen.getByTestId('box-algorithm-versions')).toHaveTextContent('dbl5-guard-v1');
 const rule=save();expect(rule.rounds[0].structure.versions).toEqual({box:'dbl-5-v2',guard:'dbl5-guard-v1'});
});
// 【用户要求】2026-11-04 恢复 S/T/K：自选指标的轮次原样打开、原样保存（11-01～11-03 会改成箱体，保存后就换了算法）
it('keeps custom-indicator rounds as S/T/K on open and save; an original-detector round still becomes a box',()=>{
 const mbi=makeQualityBuyFilter('mbi:MBI','>',.8,true,BUILTIN_FEATURES),bear=makeQualityBuyFilter('mbi-bear:MBI_bear','<',-.7,true,BUILTIN_FEATURES);
 const legacy:QualityAdditionRule={...defaultQualityAddition(),enabled:true,maxRounds:2,rounds:[{source:'custom',stricterPct:10,condition:mbi,conditions:[mbi,bear],minGainPct:5,supportOffsetAtr:2},{source:'detector',stricterPct:10}]};
 const saved=parseAdditionDraft(additionDraft(legacy),BUILTIN_FEATURES);
 expect(saved.rounds![0]).toMatchObject({source:'custom',minGainPct:5,supportOffsetAtr:2,condition:{metric:'MBI',direction:'>',threshold:.8},conditions:[{metric:'MBI'},{metric:'MBI_bear',direction:'<',threshold:-.7}]});
 expect(saved.rounds![0].structure).toBeUndefined();expect(saved.rounds![0].entryDistanceAtr).toBeUndefined();expect(saved.rounds![0].gainBasis).toBeUndefined();
 // 2026-11-03 起旧的「原探测算法再次命中」找回到「方向」：全部原探测算法、门槛提高沿用原百分比
 expect(saved.rounds![1]).toMatchObject({source:'structure',detectorPrerequisite:{enabled:true,stricterPct:10}});expect(saved.rounds![1].prerequisites).toBeUndefined();expect(saved.rounds![0].detectorPrerequisite).toBeUndefined();
 expect(parseAdditionDraft(additionDraft(saved),BUILTIN_FEATURES)).toEqual(saved);
});
it('persists calculator defaults and the chosen number of rounds with no cash input',()=>{
 const d={...additionDraft(),enabled:true};expect(parseAdditionDraft({...d,quantityMode:'fixed',quantity:'75'},BUILTIN_FEATURES).quantityMode).toBe('calculator');expect(parseAdditionDraft(d,BUILTIN_FEATURES)).toMatchObject({quantityMode:'calculator',repeat:true});expect(parseAdditionDraft({...d,maxRounds:'1'},BUILTIN_FEATURES)).toMatchObject({quantityMode:'calculator',repeat:false});
 render(<Editor/>);expect(screen.queryByLabelText('加仓金额')).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'加仓细节说明'}));expect(screen.getByText(/首轮为镜像止盈后的剩余币数/)).toBeInTheDocument();expect(screen.getByText('Q × (K − S) + P = 新增币数 × (T − K)')).toBeInTheDocument();expect(screen.getByText(/最早从下一分钟起检查/)).toBeInTheDocument();expect(screen.getByRole('heading',{name:'加仓量（均衡公式）'})).toBeInTheDocument();
});
it('adds and removes 方向 indicators, saves gain against the latest cost line S and restores every constraint',()=>{
 render(<Editor/>);fireEvent.click(screen.getByLabelText('启用条件加仓'));
 for(const [i,feature,dir,th] of [[1,'mbi','>','.8'],[2,'mbi-bear','<','-.7']] as const){fireEvent.click(screen.getByRole('button',{name:'＋ 添加方向条件'}));fireEvent.change(screen.getByLabelText(`加仓方向条件 ${i} 特征值`),{target:{value:feature}});fireEvent.change(screen.getByLabelText(`加仓方向条件 ${i} 方向`),{target:{value:dir}});fireEvent.change(screen.getByLabelText(`加仓方向条件 ${i} 指标门槛`),{target:{value:th}});}
 fireEvent.click(screen.getByLabelText('启用加仓涨幅门槛'));expect(screen.getByText(/相对最新成本线 S/)).toBeInTheDocument();expect(screen.getByLabelText('加仓涨幅门槛')).toHaveValue(5);
 const rule=save();expect(rule).toMatchObject({minGainPct:5,prerequisites:[{metric:'MBI',threshold:.8},{metric:'MBI_bear',direction:'<',threshold:-.7}]});expect(parseAdditionDraft(additionDraft(rule),BUILTIN_FEATURES)).toEqual(rule);
 expect(parseAdditionDraft({...additionDraft(rule),enabled:false},BUILTIN_FEATURES).prerequisites).toEqual(rule.prerequisites);
 fireEvent.click(screen.getByLabelText('删除加仓方向条件 1'));expect(save().prerequisites).toMatchObject([{metric:'MBI_bear'}]);
 expect(()=>parseAdditionDraft({...additionDraft(rule),minGainPct:''},BUILTIN_FEATURES)).toThrow('涨幅门槛');
});
it('keeps each round’s box algorithm, trigger, n and gain gate independent, also after resizing the list',()=>{
 render(<Editor/>);fireEvent.click(screen.getByLabelText('启用条件加仓'));fireEvent.change(screen.getByLabelText('最多加仓次数'),{target:{value:'2'}});
 fireEvent.change(screen.getByLabelText('箱体支撑冗余'),{target:{value:'.75'}});fireEvent.click(screen.getByLabelText('启用加仓涨幅门槛'));
 tab(2);expect(screen.getByLabelText('箱体支撑冗余')).toHaveValue(0);fireEvent.change(screen.getByLabelText('K基准箱体'),{target:{value:'current'}});fireEvent.change(screen.getByLabelText('箱体加仓算法'),{target:{value:'sbs5m'}});expect(screen.getByLabelText('K基准箱体')).toHaveValue('current');fireEvent.change(screen.getByLabelText('箱体加仓时机'),{target:{value:'retest'}});fireEvent.change(screen.getByLabelText('箱体支撑冗余'),{target:{value:'.25'}});
 fireEvent.change(screen.getByLabelText('最多加仓次数'),{target:{value:'1'}});fireEvent.change(screen.getByLabelText('最多加仓次数'),{target:{value:'3'}});
 tab(2);expect(screen.getByLabelText('箱体加仓算法')).toHaveValue('sbs5m');expect(screen.getByLabelText('箱体支撑冗余')).toHaveValue(.25);
 tab(1);expect(screen.getByLabelText('箱体加仓算法')).toHaveValue('dbl5');expect(screen.getByLabelText('箱体支撑冗余')).toHaveValue(.75);expect(screen.getByLabelText('加仓涨幅门槛')).toHaveValue(5);
 const rule=save();expect(rule.rounds).toMatchObject([{source:'structure',minGainPct:5,structure:{algorithm:'dbl5',trigger:'raise',kBasis:'support',bufferUnit:'atr',buffer:.75}},{source:'structure',structure:{algorithm:'sbs5m',trigger:'retest',buffer:.25}},{source:'structure'}]);expect(rule.rounds.map((r:QualityAdditionRule)=>r.structure?.kSource??'previous')).toEqual(['previous','current','previous']);expect(rule.rounds[1].minGainPct).toBeUndefined();
 expect(parseAdditionDraft(additionDraft(rule),BUILTIN_FEATURES)).toEqual(rule);expect(()=>parseAdditionDraft({...additionDraft(rule),maxRounds:'1.5'},BUILTIN_FEATURES)).toThrow('整数');
});
// 【用户要求】2026-11-02 K 可选 DBL-5 防守线；上涨 / 震荡冗余可调，卖出改为收盘确认
it('offers the DBL-5 guard line as K with editable trend / range buffers and close-confirmed selling',()=>{
 render(<Editor/>);fireEvent.click(screen.getByLabelText('启用条件加仓'));expect(screen.queryByTestId('addition-guard-row')).toBeNull();
 fireEvent.change(screen.getByLabelText('K基准箱体'),{target:{value:'guard'}});
 expect(screen.getByLabelText('上涨期防守冗余')).toHaveValue(.5);expect(screen.getByLabelText('震荡期防守冗余')).toHaveValue(1);
 fireEvent.change(screen.getByLabelText('震荡期防守冗余'),{target:{value:'1.5'}});expect(screen.getByTestId('addition-sell-k')).toHaveTextContent('5 分钟收盘跌破 K 即卖出');
 const rule=save();expect(rule.rounds[0].structure).toMatchObject({kSource:'guard',definition:{DBL5_config:{guard_range_atr:1.5}}});
 fireEvent.change(screen.getByLabelText('箱体加仓算法'),{target:{value:'sbs5m'}});expect(screen.getByLabelText('K基准箱体')).toHaveValue('previous');expect([...(screen.getByLabelText('K基准箱体') as HTMLSelectElement).options].map(o=>o.value)).toEqual(['previous','current']);
});
// 【用户要求】2026-11-03 防守线分两种：实线和虚线都用（默认）／只用实线；保存后读回不变，换回旧 C 时不留这个选项
it('chooses solid-only or both guard lines, defaulting to both and round-tripping through save',()=>{
 render(<Editor/>);fireEvent.click(screen.getByLabelText('启用条件加仓'));fireEvent.change(screen.getByLabelText('K基准箱体'),{target:{value:'guard'}});
 const pick=screen.getByLabelText('防守线类型') as HTMLSelectElement;expect(pick).toHaveValue('both');expect([...pick.options].map(o=>o.textContent)).toEqual(['实线和虚线','只用实线']);
 expect(save().rounds[0].structure.guardTrendOnly).toBeUndefined();
 fireEvent.change(pick,{target:{value:'trend'}});const rule=save();expect(rule.rounds[0].structure).toMatchObject({kSource:'guard',guardTrendOnly:true});expect(rule.structure.guardTrendOnly).toBe(true);
 const back=additionDraft(rule);expect(back.structure.guardTrendOnly).toBe(true);expect(parseAdditionDraft(back,BUILTIN_FEATURES).rounds![0].structure!.guardTrendOnly).toBe(true);
 cleanup();render(<GuardLineNotes/>);expect(screen.getByTestId('guard-line-notes')).toHaveTextContent('只用实线');expect(screen.getByTestId('guard-line-notes')).toHaveTextContent('未加仓理由');
 cleanup();render(<Editor/>);fireEvent.click(screen.getByLabelText('启用条件加仓'));fireEvent.change(screen.getByLabelText('K基准箱体'),{target:{value:'guard'}});fireEvent.change(screen.getByLabelText('防守线类型'),{target:{value:'trend'}});
 fireEvent.change(screen.getByLabelText('K基准箱体'),{target:{value:'previous'}});expect(screen.queryByLabelText('防守线类型')).toBeNull();expect(save().rounds[0].structure.guardTrendOnly).toBeUndefined();
});
// 【用户要求】2026-11-03 防守线说明：是哪条线、虚线算不算、断掉意味着什么
it('explains the guard line next to its settings: which line, solid vs dashed, what a break means',()=>{
 render(<Editor/>);fireEvent.click(screen.getByLabelText('启用条件加仓'));fireEvent.change(screen.getByLabelText('K基准箱体'),{target:{value:'guard'}});
 expect(screen.getByRole('button',{name:'防守线说明'})).toBeInTheDocument();
 cleanup();render(<GuardLineNotes/>);const notes=screen.getByTestId('guard-line-notes');
 for(const text of ['蓝色加粗线','实线＝上涨期','虚线＝震荡期','影线刺穿不算','断掉意味着什么','不会加仓','冻结'])expect(notes).toHaveTextContent(text);
 // 【用户要求】2026-11-03 防守线与是否卖出没有直接关系，只通过 K 起作用
 for(const text of ['只在加仓那一刻起作用','实线 1 根，虚线连续 2 根','卖不卖只看 K','不直接触发卖出','支撑下移减仓','K′'])expect(notes).toHaveTextContent(text);
 for(const gone of ['基本就是卖点','例外','保住有效涨幅','盈亏比'])expect(notes).not.toHaveTextContent(gone);
});
// 【用户要求】2026-11-03「加仓后，无论如何都不要亏」：卖出里的保本底线，默认不勾选
it('saves the breakeven floor in 卖出, default off, and explains it',()=>{
 render(<Editor/>);fireEvent.click(screen.getByLabelText('启用条件加仓'));
 expect(screen.getByLabelText('防守线保本底线')).not.toBeChecked();expect(screen.getByLabelText('保本底线ATR倍数')).toBeDisabled();
 expect(screen.getByLabelText('保本底线ATR倍数')).toHaveValue(0.25);
 expect(save().breakevenFloor).toBeUndefined();
 fireEvent.click(screen.getByLabelText('防守线保本底线'));fireEvent.change(screen.getByLabelText('保本底线ATR倍数'),{target:{value:'0.3'}});
 const rule=save();expect(rule.breakevenFloor).toEqual({enabled:true,atr:.3});
 expect(additionDraft(rule).breakevenFloor).toEqual({enabled:true,atr:'0.3'});
 const bad=additionDraft(rule);bad.breakevenFloor={enabled:true,atr:'-1'};expect(()=>parseAdditionDraft(bad,BUILTIN_FEATURES)).toThrow('保本底线');
 expect(screen.getByRole('button',{name:'保本底线说明'})).toBeInTheDocument();
 cleanup();render(<BreakevenFloorNotes/>);const notes=screen.getByTestId('breakeven-floor-notes');
 for(const text of ['平衡公式只保证在 K 价卖出时整笔保本','盘中碰到 F','加仓量按 F','跳空','噪音容忍度'])expect(notes).toHaveTextContent(text);
});
// 【用户要求】2026-11-03 几何仓位 > 10 时至少保留 x% 开仓价有效涨幅，x 由用户设置、默认 1%
it('saves the geometric-position lock in 卖出, default off with 10× and 1%',()=>{
 render(<Editor/>);fireEvent.click(screen.getByLabelText('启用条件加仓'));
 expect(screen.getByLabelText('几何仓位大时保住有效涨幅')).not.toBeChecked();expect(screen.getByLabelText('几何仓位门槛')).toHaveValue(10);expect(screen.getByLabelText('保留开仓价有效涨幅百分比')).toHaveValue(1);
 expect(save().geometricLock).toBeUndefined();
 fireEvent.click(screen.getByLabelText('几何仓位大时保住有效涨幅'));fireEvent.change(screen.getByLabelText('保留开仓价有效涨幅百分比'),{target:{value:'2.5'}});
 const rule=save();expect(rule.geometricLock).toEqual({enabled:true,multiple:10,pct:2.5});
 expect(parseAdditionDraft(additionDraft(rule),BUILTIN_FEATURES)).toEqual(rule);
 const bad=additionDraft(rule);bad.geometricLock={...bad.geometricLock!,pct:''};expect(()=>parseAdditionDraft(bad,BUILTIN_FEATURES)).toThrow('保住有效涨幅');
});
it('rejects a blank, negative or non-finite n and names the round',()=>{
 const draft={...additionDraft(),enabled:true};
 for(const value of ['', '-1','Infinity','NaN'])expect(()=>parseAdditionDraft({...draft,structureBuffer:value},BUILTIN_FEATURES)).toThrow('冗余');
 expect(()=>parseAdditionDraft({...draft,otherRounds:[{...draft.otherRounds[0],structureBuffer:'-1'},draft.otherRounds[1]]},BUILTIN_FEATURES)).toThrow('第 2 次加仓');
 const saved=parseAdditionDraft({...draft,structureBuffer:'0'},BUILTIN_FEATURES);expect(saved.structure?.buffer).toBe(0);
 expect(parseAdditionDraft({...additionDraft(saved),enabled:false},BUILTIN_FEATURES).structure).toEqual(saved.structure);
});
it('box position with 方向 conditions saves them as prerequisites of that round only, and restores them',()=>{
 render(<Editor/>);fireEvent.click(screen.getByLabelText('启用条件加仓'));fireEvent.change(screen.getByLabelText('最多加仓次数'),{target:{value:'2'}});
 fireEvent.change(screen.getByLabelText('加仓条件来源'),{target:{value:'structure'}});fireEvent.click(screen.getByRole('button',{name:'＋ 添加方向条件'}));
 fireEvent.change(screen.getByLabelText('加仓方向条件 1 特征值'),{target:{value:'mbi'}});fireEvent.change(screen.getByLabelText('加仓方向条件 1 指标门槛'),{target:{value:'.6'}});
 fireEvent.click(screen.getByRole('button',{name:'验证保存'}));
 const rule=JSON.parse(document.querySelector('output')!.textContent!);
 expect(rule.rounds[0]).toMatchObject({source:'structure',prerequisites:[{metric:'MBI',direction:'>',threshold:.6}]});expect(rule.rounds[0].conditions).toBeUndefined();expect(rule.rounds[1].prerequisites).toBeUndefined();
 expect(parseAdditionDraft(additionDraft(rule),BUILTIN_FEATURES)).toEqual(rule);
});
it('sets an independent seller for each addition round and keeps switches beyond the round limit',()=>{
 render(<Editor/>);fireEvent.click(screen.getByLabelText('启用条件加仓'));fireEvent.change(screen.getByLabelText('最多加仓次数'),{target:{value:'2'}});
 fireEvent.click(screen.getByRole('tab',{name:'第 2 次'}));fireEvent.click(screen.getByLabelText('第 2 次加仓后改用卖出算法'));
 fireEvent.change(screen.getByLabelText('第 2 次加仓后卖出 特征值'),{target:{value:'cda'}});fireEvent.change(screen.getByLabelText('第 2 次加仓后卖出 方向'),{target:{value:'<'}});fireEvent.change(screen.getByLabelText('第 2 次加仓后卖出 指标门槛'),{target:{value:'.5'}});
 fireEvent.click(screen.getByRole('tab',{name:'第 1 次'}));expect(screen.getByLabelText('第 1 次加仓后改用卖出算法')).not.toBeChecked();
 fireEvent.click(screen.getByRole('button',{name:'验证保存'}));
 const stages=JSON.parse(document.querySelector('[data-stages]')!.textContent!),rule=JSON.parse(document.querySelector('output')!.textContent!);
 expect(stages).toHaveLength(1);expect(stages[0]).toMatchObject({afterAdditions:2,snapshot:{featureId:'cda'},rule:{direction:'<',threshold:.5}});
 const restored=additionDraft(rule,stages);expect(restored.otherRounds[0].sellSwitch).toMatchObject({enabled:true,threshold:'.5'.replace('.','0.')});expect(parseAdditionSellStages(restored,BUILTIN_FEATURES)).toEqual(stages);
 const later={...stages[0],afterAdditions:6},kept=additionDraft(rule,[...stages,later]);expect(kept.laterSellStages).toEqual([later]);expect(parseAdditionSellStages(kept,BUILTIN_FEATURES)).toEqual([...stages,later]);
 expect(()=>parseAdditionSellStages({...restored,otherRounds:[{...restored.otherRounds[0],sellSwitch:{...restored.otherRounds[0].sellSwitch,threshold:''}}]},BUILTIN_FEATURES)).toThrow('第 2 次加仓');
});

// 【用户要求】2026-11-02 加仓否决：每次加仓可单独勾选长上影线 / 向下大插针 / 高震荡 / 冲高回落并调参数
it('saves per-round addition vetoes with editable parameters and restores them',()=>{
 render(<Editor/>);fireEvent.click(screen.getByLabelText('启用条件加仓'));
 expect(screen.getByTestId('addition-vetoes')).toBeInTheDocument();expect(screen.getByLabelText('启用加仓否决 长上影线')).not.toBeChecked();expect(screen.getByLabelText('长上影线 ATR倍数')).toBeDisabled();
 fireEvent.click(screen.getByLabelText('启用加仓否决 长上影线'));fireEvent.change(screen.getByLabelText('长上影线 ATR倍数'),{target:{value:'2'}});
 fireEvent.click(screen.getByLabelText('启用加仓否决 冲高回落'));
 tab(2);expect(screen.getByLabelText('启用加仓否决 长上影线')).not.toBeChecked();fireEvent.click(screen.getByLabelText('启用加仓否决 高震荡'));fireEvent.change(screen.getByLabelText('高震荡 效率比'),{target:{value:'.1'}});
 const rule=save();
 expect(rule.rounds[0].entryVetoes).toEqual([{kind:'upper-wick',enabled:true,lookbackBars:12,atr:2,ratio:60},{kind:'pullback',enabled:true,atr:2.5,pct:4,join:'and',sticky:true}]);
 expect(rule.rounds[1].entryVetoes).toEqual([{kind:'volatility',enabled:true,ratio:1.8,er:.1}]);expect(rule.rounds[2].entryVetoes).toBeUndefined();
 expect(parseAdditionDraft(additionDraft(rule),BUILTIN_FEATURES)).toEqual(rule);
 fireEvent.click(screen.getByLabelText('启用加仓否决 持仓期间急跌'));expect(screen.getByLabelText('持仓期间急跌 第1组跌幅')).toHaveValue(5);fireEvent.change(screen.getByLabelText('持仓期间急跌 第2组跌幅'),{target:{value:'4'}});fireEvent.change(screen.getByLabelText('持仓期间急跌 第3组跌幅'),{target:{value:''}});
 expect(save().rounds[1].entryVetoes.find((v:{kind:string})=>v.kind==='fast-drop')).toEqual({kind:'fast-drop',enabled:true,windows:[{minutes:1,pct:5},{minutes:5,pct:4}]});
 const bad=additionDraft(rule);bad.otherRounds[0].entryVetoes.volatility.er='3';expect(()=>parseAdditionDraft(bad,BUILTIN_FEATURES)).toThrow('效率比');
 // 冲高回落加百分比：两项都填默认「且」，可改「或」；清空 ATR 就只按百分比
 tab(1);fireEvent.change(screen.getByLabelText('冲高回落 回落百分比'),{target:{value:'4'}});
 expect(save().rounds[0].entryVetoes.find((v:{kind:string})=>v.kind==='pullback')).toEqual({kind:'pullback',enabled:true,atr:2.5,pct:4,join:'and',sticky:true});
 fireEvent.change(screen.getByLabelText('冲高回落组合方式'),{target:{value:'or'}});expect(save().rounds[0].entryVetoes.find((v:{kind:string})=>v.kind==='pullback').join).toBe('or');
 fireEvent.change(screen.getByLabelText('冲高回落 回落ATR倍数'),{target:{value:''}});
 const pctOnly=save();expect(pctOnly.rounds[0].entryVetoes.find((v:{kind:string})=>v.kind==='pullback')).toEqual({kind:'pullback',enabled:true,pct:4,sticky:true});
 fireEvent.click(screen.getByLabelText('冲高回落 未收复最高点前不再加'));expect(save().rounds[0].entryVetoes.find((v:{kind:string})=>v.kind==='pullback').sticky).toBeUndefined();
 expect(parseAdditionDraft(additionDraft(pctOnly),BUILTIN_FEATURES).rounds[0].entryVetoes).toEqual(pctOnly.rounds[0].entryVetoes);
});

// 【用户要求】2026-11-04「有 S、有 T、有 K 的那个还挺好的」：位置可选「指标 · S / T / K」
it('restores the S/T/K position: indicator trigger, entry distance T ≥ S + n ATR, K = T − m ATR and gain against the holding average',()=>{
 render(<Editor/>);fireEvent.click(screen.getByLabelText('启用条件加仓'));
 fireEvent.change(screen.getByLabelText('加仓条件来源'),{target:{value:'custom'}});
 expect(screen.queryByLabelText('箱体加仓算法')).toBeNull();expect(screen.queryByTestId('addition-k-row')).toBeNull();expect(screen.queryByLabelText('启用探测算法方向条件')).toBeNull();
 expect(screen.getByLabelText('入场距离ATR倍数')).toHaveValue(2);expect(screen.getByLabelText('K回撤ATR倍数')).toHaveValue(1.5);
 fireEvent.change(screen.getByLabelText('加仓条件 特征值'),{target:{value:'state'}});fireEvent.change(screen.getByLabelText('加仓条件 指标门槛'),{target:{value:'.7'}});
 fireEvent.change(screen.getByLabelText('入场距离ATR倍数'),{target:{value:'3'}});fireEvent.change(screen.getByLabelText('K回撤ATR倍数'),{target:{value:'2'}});
 fireEvent.click(screen.getByLabelText('启用加仓涨幅门槛'));fireEvent.change(screen.getByLabelText('涨幅门槛基准'),{target:{value:'average'}});fireEvent.change(screen.getByLabelText('加仓涨幅门槛'),{target:{value:'10'}});
 const rule=save(),r=rule.rounds[0];
 expect(r).toMatchObject({source:'custom',condition:{direction:'>',threshold:.7},entryDistanceAtr:3,supportOffsetAtr:2,minGainPct:10,gainBasis:'average'});expect(r.structure).toBeUndefined();
 expect(parseAdditionDraft(additionDraft(rule),BUILTIN_FEATURES)).toEqual(rule);
 // 入场距离留空＝不检查；不写字段，方案身份与 11-01 以来的自选指标方案相同
 fireEvent.change(screen.getByLabelText('入场距离ATR倍数'),{target:{value:''}});expect(save().rounds[0].entryDistanceAtr).toBeUndefined();
});

it('defaults new drafts to optional-mirror execution while explicitly preserving legacy drafts and templates',()=>{
 const old=defaultQualityAddition(),before=JSON.stringify(old);expect(additionDraft(old).positionVersion).toBeUndefined();expect(additionDraft().positionVersion).toBe(HOLDING_LEDGER_ADDITION_VERSION);
 render(<Editor/>);expect(screen.getByLabelText('加仓执行口径')).toHaveValue('legacy-mirror');fireEvent.change(screen.getByLabelText('加仓执行口径'),{target:{value:HOLDING_LEDGER_ADDITION_VERSION}});const saved=save();expect(saved.positionVersion).toBe(HOLDING_LEDGER_ADDITION_VERSION);expect(additionDraft(saved).positionVersion).toBe(HOLDING_LEDGER_ADDITION_VERSION);expect(JSON.stringify(old)).toBe(before);
});

it('defaults the first increase metric to State S avg2, saves multiple choices per round and reopens frozen selections',()=>{
 render(<Editor/>);
 fireEvent.click(screen.getByLabelText('启用条件加仓'));
 expect(screen.queryByLabelText('递增加仓算法 1')).toBeNull();
 const add=screen.getByRole('button',{name:/添加递增条件/});
 fireEvent.click(add);
 expect(screen.getByLabelText('递增加仓算法 1')).toHaveValue('state:avg_state_2');
 fireEvent.click(add);
 fireEvent.change(screen.getByLabelText('递增加仓算法 2'),{target:{value:'state:state'}});
 tab(2);
 expect(screen.queryByLabelText('递增加仓算法 1')).toBeNull();
 const saved=save() as QualityAdditionRule;
 expect(saved.rounds?.[0].indicatorIncrease?.metrics.map(m=>m.metric)).toEqual(['avg_state_2','state']);
 expect(saved.rounds?.[1].indicatorIncrease).toBeUndefined();
 expect(parseAdditionDraft(additionDraft(saved),BUILTIN_FEATURES)).toEqual(saved);
});
