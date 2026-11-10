import{expect,it}from'vitest';
import{calculateHoldingLedgerAddition as size,replayQualityHoldingLedger as ledger,HOLDING_LEDGER_ADDITION_VERSION as VERSION}from'../qualityHoldingLedger';
import{additionPosition,type QualityAdditionFill}from'../qualityAddition';
const T=60000,entryAt=T,base={notional:100,entryPrice:100,entryAt};
const add=(at:number,price:number,quantity:number):QualityAdditionFill=>({positionVersion:VERSION,at,price,quantity,notional:price*quantity,scanFrom:T,barOpenTime:at-T,reading:1,threshold:0,direction:'>',metric:'raw',label:'fixture'});
it('uses the entire unsold position with zero realized money before any mirror',()=>{
 const p=ledger({...base,additions:[]});expect(p.held).toBe(1);expect(p.cost).toBe(100);expect(p.realized).toBe(0);expect(size(p,130,110).addCoins).toBe(.5);
 const future=ledger({...base,additions:[],mirror:{at:T*5,price:140,fraction:.5},through:T*3});expect(future.held).toBe(1);expect(future.realized).toBe(0);expect(size(future,130,110).addCoins).toBe(.5);
});
it('accounts for a mirror after an addition using the inventory and average cost at execution',()=>{
 const p=ledger({...base,additions:[add(T*2,130,.5)],mirror:{at:T*3,price:140,fraction:.5}});
 expect(p.held).toBe(1);expect(p.cost).toBeCloseTo(110,12);expect(p.realized).toBeCloseTo(15,12);expect(size(p,150,120).addCoins).toBeCloseTo(25/30,12);
 expect(p.sales[0].lots.map(l=>l.quantity)).toEqual([1/3,1/6]);
});
it('does not spend the same realized profit again in later rounds',()=>{
 const first=add(T*2,130,.5),mirror={at:T*3,price:140,fraction:.5};const p=ledger({...base,additions:[first],mirror});const q=size(p,150,120).addCoins;
 const next=ledger({...base,additions:[first,add(T*4,150,q)],mirror});expect(next.held*120-next.cost+next.realized).toBeCloseTo(0,10);expect(size(next,150,120).addCoins).toBeCloseTo(0,10);
 expect(size(next,160,125).addCoins).toBeCloseTo(next.held*5/35,10);
});
it('keeps realized losses signed rather than granting fictitious risk budget',()=>{
 expect(size({held:.5,cost:55,realized:-10},150,120).error).toBe('risk_budget_insufficient');expect(size({held:1,cost:100,realized:0},120,90).error).toBe('risk_budget_insufficient');
 expect(size({held:1,cost:100,realized:0},110,110).error).toBe('price_not_above_support');
});
it('does not borrow intraminute proceeds for an open-time decision',()=>{
 const mirror={at:T*3,price:140,fraction:.5};expect(ledger({...base,additions:[],mirror,through:T*3}).realized).toBe(0);expect(ledger({...base,additions:[],mirror,through:T*3,includeIntraminute:true}).realized).toBe(20);
});
it('full mirror exits all inventory and cannot be followed by resurrection',()=>{
 const first=add(T*2,130,.5),mirror={at:T*3,price:140,fraction:1};const p=ledger({...base,additions:[first],mirror});expect(p.held).toBe(0);expect(p.realized).toBe(45);expect(size(p,160,125).error).toBe('position_closed');
 expect(()=>ledger({...base,additions:[first,add(T*4,160,.2)],mirror})).toThrow('剩余持仓');
});
it('uses the same ledger for displayed position totals',()=>{
 const p=additionPosition(100,100,150,true,[add(T*2,130,.5)],{at:T*3,price:140,fraction:.5},[],T);expect(p.totalPnl).toBeCloseTo(55,12);expect(p.mirrorPnl).toBeCloseTo(15,12);expect(p.remainingPnl).toBeCloseTo(40,12);expect(p.remainingQuantity).toBe(0);expect(p.realizedPnl).toBeCloseTo(55,12);
});
it('does not reject a valid position whose banked profit exceeds its remaining cost',()=>{
 const p={held:.1,cost:10,realized:50};expect(size(p,120,100)).toMatchObject({error:null,addCoins:2.5});
 const next={held:2.6,cost:310,realized:50};expect(size(next,120,100).addCoins).toBe(0);
});
it('orders open-time reductions before an intraminute mirror without borrowing future cash',()=>{
 const first=add(T*2,130,.5),cut={at:T*3,price:130,fraction:.2,quantity:.3,costRemoved:33,realizedPnl:6,breakeven:110,previousK:110,newK:100,previousSupport:110,newSupport:100,atr:2};
 const mirror={at:T*3,price:135,fraction:.5};
 const before=ledger({...base,additions:[first],reductions:[cut],mirror,through:T*3});expect(before.held).toBeCloseTo(1.2);expect(before.realized).toBeCloseTo(6);
 const after=ledger({...base,additions:[first],reductions:[cut],mirror,through:T*3,includeIntraminute:true});expect(after.held).toBeCloseTo(.7);expect(after.cost).toBeCloseTo(77);expect(after.realized).toBeCloseTo(18.5);
 expect(after.sales.map(s=>s.kind)).toEqual(['reduce','mirror']);expect(size(after,150,120).addCoins).toBeCloseTo(25.5/30);
});
