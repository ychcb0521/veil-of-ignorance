// 【用户要求】2026-10-20「交集…合并到一起却捕捉不到」：根因之一是后台建议算完自动填阈值时，用了计算开始那一刻的旧输入，
// 把之后才填的「时间」冲回空（空 = 现在），于是合并那次实际按当前时间捕捞。
import {beforeEach,it,expect,vi} from 'vitest';
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {useState} from 'react';
import {FishPanel,type FishPanelProps} from '@/components/FishPanel';
import {CBI2_DEF} from '@/lib/deepDig/features';
import {initialFishProgress} from '@/lib/fishScanner';
import type {FishSuggestionOptions} from '@/lib/fish/suggestions';
const custom={...CBI2_DEF,id:'custom-x',short:'X',name:'自定义',formula:'v = C\nv',scale:1,unit:'',builtin:false};
vi.mock('@/hooks/useFishFeatures',()=>({useFishFeatures:()=>[custom]}));
let resolve!:(v:any)=>void;
const suggest=vi.fn((o:FishSuggestionOptions)=>new Promise<any>(r=>{resolve=r;o.onProgress({status:'running',phase:'signals',done:1,total:2,current:''});}));
const stats=(p25:number,p75:number)=>({n:2,attempted:2,p25,p50:(p25+p75)/2,p75,constraintsPassed:2,constraintRatio:1,skipped:{},failures:[]});
const library=[{id:'s1',symbol:'AAAUSDT',timeMs:Date.UTC(2026,3,1),timeLabel:'',fallbackZone:''}];
function Harness({progress=null}:{progress?:FishPanelProps['progress']}){const [inputs,setInputs]=useState({time:'',threshold:''});return <FishPanel librarySignals={library as any} onSuggest={suggest} signals={[]} progress={progress} inputs={inputs} onInputsChange={setInputs} selection={{exchanges:['binance'],includeDuplicates:false}} onSelectionChange={()=>{}} onStart={()=>{}} onCancel={()=>{}} onJump={()=>{}} onDelete={()=>{}} onRate={()=>{}} jumpingSignalId={null} tradedDayIndex={new Set()} campaignDayIndex={new Set()}/>;}
beforeEach(()=>{localStorage.clear();sessionStorage.clear();suggest.mockClear();});
// 这个用例用自定义特征值：内置特征值有固定参考区间，不跑后台建议
it('后台建议算完自动填阈值，不会把之后才填的捕捞时间冲回空',async()=>{
 render(<Harness/>);
 await waitFor(()=>expect(suggest).toHaveBeenCalled(),{timeout:3000});
 fireEvent.change(screen.getByLabelText('捕捞时间（UTC+8）'),{target:{value:'2026-04-09 23:03:00'}});
 const plan=suggest.mock.calls[0][0].plan;
 await act(async()=>{resolve({key:'k',algorithmKey:plan.algorithmKey,definitionKey:'',fingerprint:'',featureId:'cbi2',statistic:'结果',scale:1,unit:'',createdAt:0,seed:1,samples:stats(0.01,0.04),random:stats(0,0.02)});});
 await waitFor(()=>expect(screen.getByLabelText('捕捞阈值')).toHaveValue(0.01));
 expect(screen.getByLabelText('捕捞时间（UTC+8）')).toHaveValue('2026-04-09 23:03:00');
});
it('进度行写出本轮实际使用的截止时刻，时间框留空时一眼能看出用的是「现在」',()=>{
 render(<Harness progress={{...initialFishProgress(),status:'complete',cutoffMs:Date.UTC(2026,3,9,15),anchorMs:Date.UTC(2026,3,9,15,3)}}/>);
 expect(screen.getByTestId('fish-cutoff')).toHaveTextContent('截止 2026-04-09 23:00');
 expect(screen.getByLabelText('捕捞时间（UTC+8）')).toHaveAttribute('placeholder','留空 = 现在');
});
