import {beforeEach,it,expect,vi} from 'vitest';
import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {useState} from 'react';
import {FishPanel,type FishPanelProps} from '@/components/FishPanel';
import {FEATURES_KEY,CBI2_DEF} from '@/lib/deepDig/features';
import {getUserPrefix} from '@/lib/userStoragePrefix';
import {collectFishSuggestion,type FishSuggestionOptions} from '@/lib/fish/suggestions';
import {readFishPreference} from '@/lib/fish/preferences';
import type {TradeSignal} from '@/lib/signalLibrary';
const def={...CBI2_DEF,id:'ui-suggest',name:'建议自检',short:'Z',formula:'n = 2 # 常数\nV = Q # 成交额\nC',scale:2,unit:'点',builtin:false};
const signals:TradeSignal[]=['AAAUSDT','BBBUSDT'].map((symbol,i)=>({id:symbol,symbol,timeMs:Date.UTC(2026,5,20)+i*300000,timeLabel:'',fallbackZone:''}));
const load=vi.fn(async({symbol}:{symbol:string},cut:number,plan:any)=>Array.from({length:plan.N},(_,i)=>({openTime:cut-(plan.N-i)*plan.step,open:1,close:symbol==='AAAUSDT'?1:3,high:4,low:0,volume:1,quoteVolume:symbol==='AAAUSDT'?100:300,takerBuyQuoteVolume:50,takerBuyVolume:null,refClose:50000})));
const suggest=vi.fn((options:FishSuggestionOptions)=>collectFishSuggestion(options,load));
const start=vi.fn();
function Harness({onSuggest=suggest}:{onSuggest?:FishPanelProps['onSuggest']}){
 const [inputs,onInputsChange]=useState({time:'',threshold:''}),[selection,onSelectionChange]=useState<FishPanelProps['selection']>({exchanges:['binance'],includeDuplicates:false}),[library,setLibrary]=useState(signals);
 return <><button onClick={()=>setLibrary([...signals,{...signals[0],id:'extra',timeMs:signals[0].timeMs+300000}])}>增加信号</button><FishPanel librarySignals={library} onSuggest={onSuggest} signals={[]} progress={null} inputs={inputs} onInputsChange={onInputsChange} selection={selection} onSelectionChange={onSelectionChange} onStart={start} onCancel={()=>{}} onJump={()=>{}} onDelete={()=>{}} onRate={()=>{}} jumpingSignalId={null} tradedDayIndex={new Set()} campaignDayIndex={new Set()}/></>;
}
function select(){fireEvent.change(screen.getByLabelText('捕捞算法'),{target:{value:def.id}});expect(screen.queryByLabelText('捕捞平均时长')).toBeNull();}
beforeEach(()=>{localStorage.clear();sessionStorage.clear();localStorage.setItem(getUserPrefix()+FEATURES_KEY,JSON.stringify([def]));suggest.mockClear();load.mockClear();start.mockClear();});
it('小下拉排除常数并显示行注释，中间量使用原值，选择按特征值保存',()=>{
 render(<Harness/>);select();const stat=screen.getByLabelText('捕捞统计量');expect(within(stat).getByRole('option',{name:'V · 成交额'})).toBeVisible();expect(within(stat).queryByRole('option',{name:/常数/})).toBeNull();fireEvent.change(stat,{target:{value:'V'}});expect(screen.getByText('原值')).toBeVisible();fireEvent.change(screen.getByLabelText('捕捞阈值'),{target:{value:'200'}});fireEvent.click(screen.getByRole('button',{name:'开始捕捞'}));expect(start).toHaveBeenCalledWith(expect.objectContaining({algorithm:expect.objectContaining({statistic:'V'})}));fireEvent.change(screen.getByLabelText('捕捞算法'),{target:{value:'cbi2'}});fireEvent.change(screen.getByLabelText('捕捞算法'),{target:{value:def.id}});expect(stat).toHaveValue('V');expect(readFishPreference(def.id).statistic).toBe('V');
});
// 【用户要求】2026-10-19「默认的建议区间…源于信号库中所有信号的统计所得」：不用点，打开就在后台算
it('打开就在后台自动算，空阈值>自动填P25；换方向不重算，仍为上次建议时改填P75；手动改过的不覆盖',async()=>{
 render(<Harness/>);select();expect(suggest).not.toHaveBeenCalled();await waitFor(()=>expect(screen.getByLabelText('捕捞阈值')).toHaveValue(3),{timeout:3000});expect(suggest).toHaveBeenCalledTimes(1);expect(screen.getByTestId('fish-suggestion')).toHaveTextContent('建议 3 ~ 5');expect(screen.getByTestId('fish-suggestion')).not.toHaveTextContent('已过期');expect(screen.getByTestId('fish-suggestion')).toHaveAttribute('title',expect.stringContaining('随机对照'));
 expect(screen.getByLabelText('捕捞统计量')).toBeEnabled();
 fireEvent.change(screen.getByLabelText('捕捞方向'),{target:{value:'<'}});expect(screen.getByLabelText('捕捞阈值')).toHaveValue(5);expect(screen.getByTestId('fish-suggestion')).not.toHaveTextContent('已过期');
 fireEvent.change(screen.getByLabelText('捕捞阈值'),{target:{value:'99'}});fireEvent.change(screen.getByLabelText('捕捞方向'),{target:{value:'>'}});expect(screen.getByLabelText('捕捞阈值')).toHaveValue(99);expect(readFishPreference(def.id).lastSuggestion).toBeUndefined();
 await act(()=>new Promise(r=>setTimeout(r,1000)));expect(suggest).toHaveBeenCalledTimes(1);
},10000);
it('手动刷新重新取样；无记录区间的信号库变动后自动重算；明细共用淡色入口',async()=>{
 render(<Harness/>);select();await waitFor(()=>expect(screen.getByLabelText('捕捞阈值')).toHaveValue(3),{timeout:3000});const count=load.mock.calls.length;fireEvent.click(screen.getByRole('button',{name:'计算建议'}));await waitFor(()=>expect(screen.getByRole('button',{name:'计算建议'})).toBeEnabled(),{timeout:3000});expect(load.mock.calls.length).toBeGreaterThan(count);expect(suggest.mock.calls[suggest.mock.calls.length-1]?.[0].force).toBe(true);
 const refreshedCount=load.mock.calls.length;fireEvent.click(screen.getByRole('button',{name:'增加信号'}));expect(screen.getByTestId('fish-suggestion')).toHaveTextContent(/已过期|更新中/);await waitFor(()=>expect(load.mock.calls.length).toBeGreaterThan(refreshedCount),{timeout:3000});await waitFor(()=>expect(screen.getByTestId('fish-suggestion')).not.toHaveTextContent(/已过期|更新中/),{timeout:3000});
 fireEvent.click(screen.getByRole('button',{name:'捕捞说明'}));expect(screen.getByTestId('fish-suggestion-detail')).toHaveTextContent('随机对照');
},10000);
it('后台计算时点开始捕捞：先停掉建议再开始',async()=>{
 const delayed=vi.fn((o:FishSuggestionOptions)=>new Promise<any>((_resolve,reject)=>{o.onProgress({status:'running',phase:'signals',done:1,total:2,current:'AAAUSDT'});o.signal.addEventListener('abort',()=>reject(new DOMException('已取消','AbortError')),{once:true});}));
 render(<Harness onSuggest={delayed}/>);select();fireEvent.change(screen.getByLabelText('捕捞阈值'),{target:{value:'2'}});await waitFor(()=>expect(delayed).toHaveBeenCalled(),{timeout:3000});expect(screen.getByTestId('fish-suggestion-auto')).toHaveTextContent('建议计算中 1 / 2');expect(screen.getByRole('button',{name:'开始捕捞'})).toBeEnabled();
 fireEvent.click(screen.getByRole('button',{name:'开始捕捞'}));await waitFor(()=>expect(start).toHaveBeenCalled());expect(delayed.mock.calls[0][0].signal.aborted).toBe(true);
});
it('计算期间锁定设置与捕捞，可取消；进度收在明细入口',async()=>{
 const delayed=vi.fn((o:FishSuggestionOptions)=>new Promise<any>((_resolve,reject)=>{o.onProgress({status:'running',phase:'signals',done:1,total:2,current:'AAAUSDT'});o.signal.addEventListener('abort',()=>reject(new DOMException('已取消','AbortError')),{once:true});}));
 render(<Harness onSuggest={delayed}/>);select();fireEvent.click(screen.getByRole('button',{name:'计算建议'}));expect(screen.getByLabelText('捕捞统计量')).toBeDisabled();expect(screen.getByRole('button',{name:'开始捕捞'})).toBeDisabled();expect(screen.queryByTestId('fish-suggestion-detail')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'捕捞说明'}));expect(screen.getByTestId('fish-suggestion-detail')).toHaveTextContent('1 / 2');fireEvent.click(screen.getByRole('button',{name:'取消'}));await waitFor(()=>expect(screen.getByTestId('fish-suggestion-detail')).toHaveTextContent('已取消'));expect(delayed.mock.calls[0][0].signal.aborted).toBe(true);expect(screen.getByLabelText('捕捞统计量')).toBeEnabled();
});

it('共享定义只平均一次，所有命名序列仍可显式选中，保存的公式不被修改',()=>{
 const edited={...CBI2_DEF,formula:CBI2_DEF.formula+'\navg_CBI2 = avg(CBI2,24)'};localStorage.setItem(getUserPrefix()+FEATURES_KEY,JSON.stringify([edited]));render(<Harness/>);expect(screen.getByTestId('fish-rule')).toHaveTextContent('avg_CBI2 > —');expect(screen.queryByTestId('fish-use-builtin')).toBeNull();fireEvent.change(screen.getByLabelText('捕捞统计量'),{target:{value:'F'}});expect(screen.getByTestId('fish-rule')).toHaveTextContent('F > ');fireEvent.change(screen.getByLabelText('捕捞统计量'),{target:{value:'avg_CBI2'}});expect(screen.getByTestId('fish-rule')).toHaveTextContent('avg_CBI2 > ');expect(screen.getByTestId('fish-rule')).not.toHaveTextContent('avg(');expect(JSON.parse(localStorage.getItem(getUserPrefix()+FEATURES_KEY)!)[0].formula).toBe(edited.formula);
});

// 【用户要求】2026-10-19「CBI 这里为何没有」：每一张算法卡都有自己的信号库建议，按卡片顺序在后台逐张算，空阈值自动填
it('附加算法卡也有信号库建议：第 1 张算完接着算第 2 张，空阈值自动填 P25；同设置的卡共用一份不重算',async()=>{
 render(<Harness/>);select();await waitFor(()=>expect(screen.getByLabelText('捕捞阈值')).toHaveValue(3),{timeout:3000});const first=suggest.mock.calls.length;
 fireEvent.click(screen.getByRole('button',{name:'+ 算法'}));await act(()=>new Promise(r=>setTimeout(r,1000)));expect(suggest).toHaveBeenCalledTimes(first);
 fireEvent.change(screen.getByLabelText('算法 2 统计量'),{target:{value:'V'}});expect(screen.getByLabelText('算法 2 阈值')).toHaveValue(null);
 await waitFor(()=>expect(screen.getByLabelText('算法 2 阈值')).toHaveValue(150),{timeout:3000});expect(screen.getByTestId('fish-suggestion-2')).toHaveTextContent('信号库建议 150 ~ 250（2 / 2 条）');
 fireEvent.change(screen.getByLabelText('算法 2 方向'),{target:{value:'<'}});expect(screen.getByLabelText('算法 2 阈值')).toHaveValue(250);
 fireEvent.change(screen.getByLabelText('算法 2 阈值'),{target:{value:'7'}});fireEvent.change(screen.getByLabelText('算法 2 方向'),{target:{value:'>'}});expect(screen.getByLabelText('算法 2 阈值')).toHaveValue(7);
});

it('建议尚未完成时新增同设置卡片：共用结果也填入第二张的空阈值',async()=>{
 render(<Harness/>);select();fireEvent.click(screen.getByRole('button',{name:'+ 算法'}));
 await waitFor(()=>expect(screen.getByLabelText('捕捞阈值')).toHaveValue(3),{timeout:3000});
 await waitFor(()=>expect(screen.getByLabelText('算法 2 阈值')).toHaveValue(3));
 expect(suggest).toHaveBeenCalledTimes(1);
});


it('已有记录区间的卡不自动排队或取数，淡色刷新只手动重算对应算法',async()=>{
 render(<Harness/>);fireEvent.click(screen.getByRole('button',{name:'+ 算法'}));
 fireEvent.change(screen.getByLabelText('算法 2 特征值'),{target:{value:'cba'}});
 await act(()=>new Promise(r=>setTimeout(r,1000)));
 expect(suggest).not.toHaveBeenCalled();expect(load).not.toHaveBeenCalled();expect(screen.queryByText(/建议排队中/)).toBeNull();
 expect(screen.queryByTestId('fish-recorded-range-1')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'算法 1 的记录区间'}));
 expect(screen.getByTestId('fish-recorded-range-1')).toHaveTextContent('-0.0108802 ~ 0.0396005');
 fireEvent.click(screen.getByRole('button',{name:'算法 1 的记录区间'}));
 fireEvent.click(screen.getByRole('button',{name:'算法 2 的记录区间'}));
 expect(screen.getByTestId('fish-recorded-range-2')).toHaveTextContent('2.05893 ~ 7.73665');
 fireEvent.click(screen.getByRole('button',{name:'重新计算算法 2 的区间'}));
 await waitFor(()=>expect(suggest).toHaveBeenCalledTimes(1));
 expect(suggest.mock.calls[0][0]).toEqual(expect.objectContaining({force:true,plan:expect.objectContaining({def:expect.objectContaining({id:'cba'})})}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'重新计算算法 2 的区间'})).toBeEnabled(),{timeout:3000});
 fireEvent.change(screen.getByLabelText('算法 2 特征值'),{target:{value:'drift-speed-z'}});
 expect(screen.getByTestId('fish-recorded-range-2')).toHaveTextContent('2.0469 ~ 10.0813');
 await act(()=>new Promise(r=>setTimeout(r,1000)));expect(suggest).toHaveBeenCalledTimes(1);
},10000);
