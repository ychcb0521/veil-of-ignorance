import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UsdtLiveOrderTicket } from '@/components/UsdtLiveOrderTicket';
import { UsdtLivePositionActions } from '@/components/UsdtLivePositionActions';
import type { UsdtMirrorPosition } from '@/lib/fish/usdtPositionMirror';
import type { UsdtPositionControlRequest, UsdtPositionTarget } from '@/lib/fish/usdtPositionControls';

beforeEach(()=>vi.stubGlobal('ResizeObserver',class { observe(){} unobserve(){} disconnect(){} }));
afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals(); });
const symbol='BEATUSDT';
function fixture(direction:'long'|'short'='long') {
  const position:UsdtMirrorPosition={symbol,positionSide:direction==='long'?'LONG':'SHORT',direction,quantity:'100',
    entryPrice:'0.08',markPrice:'0.081',unrealizedPnl:'0',updatedAt:123};
  const target:UsdtPositionTarget={symbol,positionSide:position.positionSide,direction,revision:'current',campaignId:'fixture',openedAt:100};
  const follow={owner:'fixture',
    readDeskQuote:vi.fn(async (_symbol:string,_signal:AbortSignal)=>({symbol,ask:'0.0812',bid:'0.0811',mark:'0.081',
      available:'100',leverage:5,priceTick:'0.0001',orderStep:'0.1',marketStep:'1',maxQuantity:'10000',maxNotional:'10000'})),
    deskOpen:vi.fn(async ()=>({pending:false})),
    deskClose:vi.fn(async (_request:UsdtPositionControlRequest,_signal:AbortSignal)=>({pending:false,filledQuantity:'25'})),
  };
  return {position,target,follow};
}
function ticket(v:ReturnType<typeof fixture>) {
  render(<UsdtLiveOrderTicket symbol={symbol} follow={v.follow as never} legs={[{position:v.position,target:v.target}]} refresh={vi.fn()}/>);
}
async function confirmTicket(direction:'long'|'short'='long') {
  fireEvent.change(screen.getByRole('textbox',{name:'数量'}),{target:{value:'25'}});
  fireEvent.click(screen.getByRole('button',{name:direction==='long'?'平多':'平空'}));
  const dialog=screen.getByRole('dialog');expect(dialog).toHaveTextContent('市价');
  fireEvent.click(within(dialog).getByRole('button',{name:'确认提交'}));
}

it.each(['long','short'] as const)('submits a %s reduction as a plain market order with no limit controls',async direction=>{
  const v=fixture(direction);ticket(v);
  expect(within(screen.getByRole('group',{name:'委托类型'})).getAllByRole('button').map(button=>button.textContent)).toEqual(['市价']);
  expect(screen.queryByRole('checkbox',{name:'滑点容差'})).toBeNull();
  expect(screen.queryByRole('textbox',{name:'委托价格'})).toBeNull();
  await confirmTicket(direction);
  await waitFor(()=>expect(v.follow.deskClose).toHaveBeenCalledOnce());
  expect(v.follow.deskClose.mock.calls[0][0]).toMatchObject({target:v.target,action:{kind:'close',fraction:.25,order:{type:'market'}}});
  expect(v.follow.deskClose.mock.calls[0][0].action).toEqual({kind:'close',fraction:.25,order:{type:'market'}});
  expect(v.follow.deskOpen).not.toHaveBeenCalled();
});

it.each(['limit','bounded-market','conditional'] as const)('does not carry %s entry settings into a close',async kind=>{
  const v=fixture();ticket(v);fireEvent.click(screen.getByRole('button',{name:'开仓'}));
  const menu=within(screen.getByRole('group',{name:'委托类型'}));
  fireEvent.click(menu.getByRole('button',{name:kind==='limit'?'限价':kind==='conditional'?'条件委托':'市价'}));
  if(kind==='bounded-market'){
    fireEvent.click(screen.getByRole('checkbox',{name:'滑点容差'}));
    fireEvent.change(screen.getByRole('textbox',{name:'滑点容差百分比'}),{target:{value:'0'}});
  }
  fireEvent.click(screen.getByRole('button',{name:'平仓'}));
  expect(within(screen.getByRole('group',{name:'委托类型'})).queryByRole('button',{name:'限价'})).toBeNull();
  expect(screen.queryByRole('textbox',{name:'滑点容差百分比'})).toBeNull();
  await confirmTicket();
  await waitFor(()=>expect(v.follow.deskClose).toHaveBeenCalledOnce());
  expect(v.follow.deskClose.mock.calls[0][0].action).toEqual({kind:'close',fraction:.25,order:{type:'market'}});
});

it('reconciles an ambiguous market reduction under the original request ID',async()=>{
  const v=fixture();v.follow.deskClose.mockRejectedValueOnce(new TypeError('lost response'));ticket(v);
  await confirmTicket();
  fireEvent.click(await screen.findByRole('button',{name:'核对实盘回报'}));
  await waitFor(()=>expect(v.follow.deskClose).toHaveBeenCalledTimes(2));
  expect(v.follow.deskClose.mock.calls[1][0]).toEqual(v.follow.deskClose.mock.calls[0][0]);
  expect(v.follow.deskClose.mock.calls[1][0].action).toEqual({kind:'close',fraction:.25,order:{type:'market'}});
});

it.each([25,100])('uses market execution for a position-card exit of %s percent',async percent=>{
  const v=fixture(),control=vi.fn(async (_request:UsdtPositionControlRequest)=>({pending:false,filledQuantity:String(percent)}));
  render(<UsdtLivePositionActions position={v.position} target={v.target} control={control} refresh={vi.fn()}>
    {controls=><>{controls.market}{controls.details}</>}
  </UsdtLivePositionActions>);
  expect(screen.queryByRole('button',{name:'限价'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'平仓'}));
  fireEvent.change(screen.getByRole('textbox',{name:'市价平仓百分比'}),{target:{value:String(percent)}});
  fireEvent.click(screen.getByRole('button',{name:/^确认实盘平仓/}));
  await waitFor(()=>expect(control).toHaveBeenCalledOnce());
  expect(control.mock.calls[0][0].action).toEqual({kind:'close',fraction:percent/100,order:{type:'market'}});
});
