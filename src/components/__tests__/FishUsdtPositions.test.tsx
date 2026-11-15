import { render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { FishUsdtPositions } from '../FishUsdtPositions';
import { usdtPositionValue, type UsdtMirrorPosition } from '@/lib/fish/usdtPositionMirror';

const at=Date.parse('2026-11-15T19:28:42.697+08:00');
const position:UsdtMirrorPosition={symbol:'BEATUSDT',positionSide:'LONG',direction:'long',
  quantity:'100.000',entryPrice:'0.0822712',markPrice:'0.08236000',unrealizedPnl:'0.00888000',updatedAt:at};

it('opens the mirror for live positions and shows both exchange sides with exact units and opening time', async () => {
  const readPositionHistory=vi.fn(async ()=>({openedAt:at,fills:[]}));
  const follow={connected:true,positionMirror:1,campaignMirror:1,readPositionHistory} as const;
  const retryPositions=()=>{};
  const view=render(<FishUsdtPositions follow={follow as never} live={{snapshot:{observedAt:at,positions:[]},retryPositions,issue:undefined,archiveIssue:undefined}}/>);
  expect(screen.getByRole('button',{name:/币安实盘持仓/})).toHaveAttribute('aria-expanded','false');

  const short:UsdtMirrorPosition={...position,positionSide:'SHORT',direction:'short',quantity:'21.005',unrealizedPnl:'-0.001'};
  view.rerender(<FishUsdtPositions follow={follow as never} live={{snapshot:{observedAt:at,positions:[position,short]},retryPositions,issue:undefined,archiveIssue:undefined}}/>);
  expect(screen.getByRole('button',{name:/币安实盘持仓/})).toHaveAttribute('aria-expanded','true');
  expect(screen.getByText('数量 100 BEAT')).toBeVisible();
  expect(screen.getByText('数量 21.005 BEAT')).toBeVisible();
  expect(screen.getByText('名义仓位 8.236 USDT')).toBeVisible();
  expect(screen.getAllByText('均价 0.0822712')).toHaveLength(2);
  expect(await screen.findAllByText('开仓 2026-11-15 19:28:42.697')).toHaveLength(2);
  expect(readPositionHistory).toHaveBeenCalledTimes(2);
  view.rerender(<FishUsdtPositions follow={follow as never} live={{snapshot:{observedAt:at+1000,positions:[]},retryPositions,issue:undefined,archiveIssue:undefined}}/>);
  await waitFor(()=>expect(screen.queryByText('BEATUSDT')).not.toBeInTheDocument());
});

it('keeps decimal precision when calculating quote values', () => {
  expect(usdtPositionValue('100.000','0.08236000')).toBe('8.236');
  expect(usdtPositionValue('0.000000000000000123','0.0081')).toBe('0.0000000000000000009963');
});
