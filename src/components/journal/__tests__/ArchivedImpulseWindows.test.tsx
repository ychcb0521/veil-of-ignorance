import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import type {TradeCampaign} from '@/types/journal';
import {ArchivedImpulseWindows} from '../ArchivedImpulseWindows';
const read=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/fishScanner',()=>({FishScanner:class {readInstantImpulseWindows=read;}}));
afterEach(()=>{cleanup();read.mockReset();});
const entry=Date.UTC(2026,10,26,11,15), step=300000, at=entry+step;
const campaign={id:'old',opened_at:new Date(entry).toISOString(),comparison:{
 instant:{source:{symbol:'SEIUSDT'},timing:{observedAt:at+step}},
 sellEvidence:{executedAt:at+step,addition:{enabled:true,impulse1115Position:{}},
 mirrorFill:{at:entry},additionFills:[{at,label:'新箱体确认'}]},
}} as TradeCampaign;
it('reconstructs only on demand, distinguishes a simultaneous box fill, and retries missing data',async()=>{
 read.mockRejectedValueOnce(Error('历史行情缺口')).mockResolvedValueOnce([{at,price:0.03645,freshUntil:at+step}]);
 render(<ArchivedImpulseWindows campaign={campaign}/>);
 expect(read).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button'));expect(await screen.findByRole('alert')).toHaveTextContent('历史行情缺口');
 fireEvent.click(screen.getByRole('button'));
 expect(await screen.findByRole('listitem')).toHaveTextContent('同刻已成交：新箱体确认');
 expect(screen.getByRole('listitem')).toHaveTextContent('记录卖出时已过有效期');
});
it('uses frozen audit rows for new runs',()=>{
 const comparison=campaign.comparison!;
 render(<ArchivedImpulseWindows campaign={{...campaign,comparison:{...comparison,sellEvidence:{...comparison.sellEvidence!,impulseTimingAuditFrom:entry}}}}/>);
 expect(screen.queryByRole('button')).toBeNull();expect(read).not.toHaveBeenCalled();
});
