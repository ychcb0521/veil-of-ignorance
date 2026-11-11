/** 测试环境展开鱼舱，这里恢复鱼舱在网站上的默认折叠状态。 */
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {fireEvent,render,screen} from '@testing-library/react';
import {FishPanel,FISH_DEFAULT_ALGORITHMS} from '@/components/FishPanel';
import {FISH_PANEL_DEFAULTS} from '@/components/fishPanelDefaults';
import {CBI2_DEF,CBA_DEF,type DeepDigFeatureDef} from '@/lib/deepDig/features';
import {fishFeatureDefinitions} from '@/lib/fish/features';
const defs=vi.hoisted(()=>({list:[] as DeepDigFeatureDef[]}));
vi.mock('@/hooks/useFishFeatures',()=>({useFishFeatures:()=>defs.list}));
const start=vi.fn();
const panel=(extra:object={})=><FishPanel defaultAlgorithms={FISH_DEFAULT_ALGORITHMS} signals={[]} progress={null} inputs={{time:'',threshold:''}} onInputsChange={()=>{}} selection={{exchanges:['binance'],includeDuplicates:false}} onSelectionChange={()=>{}} onStart={start} onCancel={()=>{}} onJump={()=>{}} onDelete={()=>{}} onRate={()=>{}} jumpingSignalId={null} tradedDayIndex={new Set()} campaignDayIndex={new Set()} {...extra}/>;
const testDefaults={...FISH_PANEL_DEFAULTS};
beforeEach(()=>{localStorage.clear();sessionStorage.clear();start.mockClear();defs.list=fishFeatureDefinitions([CBI2_DEF,CBA_DEF]);Object.assign(FISH_PANEL_DEFAULTS,{cabin:false});});
afterEach(()=>{Object.assign(FISH_PANEL_DEFAULTS,testDefaults);});
const SIGNAL={id:'fish-AAA',symbol:'AAAUSDT',timeMs:Date.UTC(2026,9,19),timeLabel:'2026-10-19 08:00:00',fallbackZone:''};
it('捕捞默认展开且不启动扫描，鱼舱默认折叠，本次浏览记住手动折叠', ()=>{
 const view=render(panel({signals:[SIGNAL]}));
 expect(screen.getByRole('button',{name:'捕捞'})).toHaveAttribute('aria-expanded','true');
 expect(screen.getByRole('button',{name:'开始捕捞'})).toBeVisible();
 expect(start).not.toHaveBeenCalled();
 expect(screen.queryByTestId('fish-old-panel')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'捕捞'}));
 expect(screen.queryByRole('button',{name:'开始捕捞'})).toBeNull();
 view.unmount();render(panel({signals:[SIGNAL]}));
 expect(screen.getByRole('button',{name:'捕捞'})).toHaveAttribute('aria-expanded','false');
});
