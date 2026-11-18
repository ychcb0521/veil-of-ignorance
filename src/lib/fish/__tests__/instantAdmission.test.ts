import {expect,it,vi,beforeEach} from 'vitest';
import {reserveInstantAdmission,registerInstantHoldingCheck} from '../instantAdmission';
const state=vi.hoisted(()=>({open:[] as any[],pending:[] as any[]}));
vi.mock('../instantCampaignStore',()=>({
 readOpenInstantPositions:async()=>state.open,
 readPendingInstantCampaignJobs:async()=>state.pending,
 saveInstantPosition:async(_owner:string,input:any)=>{state.pending.push({input});},
}));
vi.mock('../instantCampaign',()=>({instantPositionInput:(r:any)=>r.input}));
const a={id:'a',source:{symbol:'BULLAUSDT'}},b={...a,id:'b'};
beforeEach(()=>{state.open=[];state.pending=[];});
it('skips a new signal with remaining position and accepts one after the position closes',async()=>{
 state.open=[a];
 expect(await reserveInstantAdmission('owner',{input:b} as never,{} as never)).toBe(false);
 state.open=[];
 expect(await reserveInstantAdmission('owner',{input:b} as never,{} as never)).toBe(true);
});
it('reserves an accepted entry before its asynchronous fill and permits idempotent retry',async()=>{
 expect(await reserveInstantAdmission('owner',{input:a} as never,{} as never)).toBe(true);
 expect(await reserveInstantAdmission('owner',{input:b} as never,{} as never)).toBe(false);
 expect(await reserveInstantAdmission('owner',{input:a} as never,{} as never)).toBe(true);
});
it('includes manually opened Binance positions',async()=>{
 const release=registerInstantHoldingCheck('live',()=>true);
 try{expect(await reserveInstantAdmission('live',{input:a} as never,{} as never)).toBe(false);}finally{release();}
});
