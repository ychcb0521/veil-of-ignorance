import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within,waitFor} from '@testing-library/react';
import {FishFilterLibrary} from '@/components/FishFilterLibrary';
import {makeQualityBuyFilter} from '@/lib/fish/qualityFilters';
import {newQualityStudy} from '@/lib/fish/quality';
import {definitionKey,CBI2_DEF} from '@/lib/deepDig/features';
afterEach(cleanup);
const T=Date.UTC(2026,9,28);
function study(){
 const s=newQualityStudy(T),filters=[makeQualityBuyFilter('cbi2:avg_CBI2_2','>',.04),makeQualityBuyFilter('cba:avg_CBA_2','>',8)];
 filters[0].label='笼统条件';filters[0].snapshot.definitionKey=definitionKey({...CBI2_DEF,formula:'CBI2 = C\navg_CBI2_2 = avg(CBI2,7)',halfLifeHours:9,avgHours:7});
 s.filterLibrary={version:1,settings:[{id:'old',signature:'old',filters,plans:[]}],rounds:[],records:[{id:'a',settingId:'old',source:{id:'a',symbol:'AAAUSDT',timeMs:T,timeLabel:'',fallbackZone:''},enteredAt:T,basis:'signal',readings:[{key:'a',value:.03},{key:'b',value:10}],status:{state:'fail',detail:'历史判断'},firstSavedAt:T,updatedAt:T}]};return s;
}
it('renders exact historical metrics, both thresholds and separately labelled readings, ignoring current filters and generic names',async()=>{
 const s=study(),before=JSON.stringify(s.filterLibrary);s.buyFilters=[makeQualityBuyFilter('state:state','>',.9)];
 render(<FishFilterLibrary study={s}/>);fireEvent.click(screen.getByRole('button',{name:'打开过滤库'}));fireEvent.click(screen.getByLabelText('打开过滤归档 filter-legacy'));expect(screen.queryByTestId('filter-library-row')).not.toBeInTheDocument();fireEvent.click(screen.getByText('过滤判定详情'));const row=await screen.findByTestId('filter-library-row');
 expect(row).toHaveTextContent('avg_CBI2_2 > 0.04');expect(row).toHaveTextContent('avg_CBA_2 > 8');expect(row).toHaveTextContent('avg_CBI2_2 = 0.03');expect(row).toHaveTextContent('avg_CBA_2 = 10');expect(row).not.toHaveTextContent('笼统条件');expect(row).toHaveTextContent('以下条件全部满足');
 const details=within(row).getAllByText(/公式 .*详情/)[0].closest('details')!;details.open=true;fireEvent(details,new Event('toggle'));await waitFor(()=>expect(within(row).getByText(/半衰期 9 小时/)).toBeInTheDocument());expect(within(row).getByText(/avg_CBI2_2 = avg\(CBI2,7\)/)).toBeInTheDocument();
 expect(JSON.stringify(s.filterLibrary)).toBe(before);
 fireEvent.change(screen.getByLabelText('搜索过滤库'),{target:{value:'avg_CBI2_2 > 0.04'}});expect(screen.getAllByTestId('filter-library-row')).toHaveLength(1);
});

it('keeps the dialog open through recovery and exposes unmatched rounds without changing the template view',()=>{
 const empty=newQualityStudy(T),retry=vi.fn(),renderTemplate=()=>null;
 const view=render(<FishFilterLibrary study={empty} ready={false} onRetry={retry} renderTemplate={renderTemplate}/>);
 fireEvent.click(screen.getByRole('button',{name:'打开过滤库'}));
 expect(screen.getByRole('status')).toHaveTextContent('正在核对账号');
 expect(screen.queryByText(/暂无过滤记录/)).toBeNull();
 view.rerender(<FishFilterLibrary study={empty} ready={false} loadError="账号研究恢复超时" onRetry={retry} renderTemplate={renderTemplate}/>);
 fireEvent.click(screen.getByRole('button',{name:'重试读取'}));expect(retry).toHaveBeenCalledOnce();
 expect(screen.queryByText(/暂无过滤记录/)).toBeNull();
 view.rerender(<FishFilterLibrary study={study()} ready renderTemplate={renderTemplate}/>);
 expect(screen.getByRole('button',{name:'按轮次'})).toHaveAttribute('aria-pressed','true');
 const search=screen.getByRole('searchbox',{name:'搜索过滤库轮次'});
 fireEvent.change(search,{target:{value:'不存在的轮次'}});expect(screen.getByText('没有匹配的过滤轮次。')).toBeVisible();
 fireEvent.change(search,{target:{value:'历史记录'}});expect(screen.getByLabelText('打开过滤归档 filter-legacy')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'按模板'}));
 expect(screen.getByText('暂无与已保存模板对应的记录。')).toBeVisible();
 view.rerender(<FishFilterLibrary study={empty} ready renderTemplate={renderTemplate}/>);
 expect(screen.getByText(/暂无过滤记录/)).toBeVisible();
});

it('also opens unmatched rounds when choosing rows from the workspace source menu',()=>{
 render(<FishFilterLibrary study={study()} openRequest={{key:1,importSelection:true}} renderTemplate={()=>null}
   renderStudy={snapshot=><span>{snapshot.samples.length} 条来源记录</span>}/>);
 fireEvent.click(screen.getByLabelText('打开过滤归档 filter-legacy'));
 expect(screen.getByText('1 条来源记录')).toBeVisible();
});
