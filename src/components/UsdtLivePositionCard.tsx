import { Link, useInRouterContext } from 'react-router-dom';
import { formatUTC8 } from '@/lib/timeFormat';
import {
  usdtMirrorRevision, usdtPositionDecimal, usdtPositionQuantityUnit, usdtPositionValue, usdtSettlementAsset,
  type UsdtMirrorPosition,
} from '@/lib/fish/usdtPositionMirror';
import { usdtLiveCampaignId } from '@/lib/fish/usdtLiveCampaign';
import type { useUsdtLiveTrading } from '@/hooks/useUsdtLiveTrading';
import type { useUsdtFollow } from '@/hooks/useUsdtFollow';
import type { useBinanceManualMonitor } from '@/hooks/useBinanceManualMonitor';
import {
  PositionContract,PositionMarketClose,PositionNumber,PositionOpenedAt,PositionPnl,PositionProtectionButton,
  PositionProtectionPrices,PositionTableRow,
} from './PositionTable';
import {UsdtLivePositionActions,type LivePositionControls} from './UsdtLivePositionActions';

const positive = (value: string | undefined) => value != null && Number(value) > 0 ? usdtPositionDecimal(value) : undefined;
const campaignLinkClass = 'text-muted-foreground hover:text-foreground hover:underline';

export function UsdtLivePositionCard({position,live,follow,onOpenChart}: {
  position: UsdtMirrorPosition;
  live: ReturnType<typeof useUsdtLiveTrading> & { management?: ReturnType<typeof useBinanceManualMonitor> };
  follow?: ReturnType<typeof useUsdtFollow>;
  onOpenChart?:()=>void;
}) {
  const inRouter = useInRouterContext();
  const asset = usdtSettlementAsset(position.symbol);
  const unit = usdtPositionQuantityUnit(position.symbol);
  const quantity = usdtPositionDecimal(position.quantity);
  const history = live.histories.get(usdtMirrorRevision(position));
  const campaign = live.openCampaigns?.find(row => row.symbol === position.symbol &&
    row.positionSide === position.positionSide && row.direction === position.direction &&
    usdtPositionDecimal(row.quantity) === quantity &&
    (history?.openedAt ? row.openedAt === history.openedAt : (row.fills.at(-1)?.at ?? 0) >= position.updatedAt));
  const openedAt = history?.openedAt ?? campaign?.openedAt;
  const campaignId = campaign && usdtLiveCampaignId(campaign);
  const campaignPath = campaignId && '/journal/campaigns/' + encodeURIComponent(campaignId) + '?section=instant';
  const managed = live.management?.positions.find(({ position: row }) => row.anchor.symbol === position.symbol &&
    row.anchor.positionSide === position.positionSide && row.anchor.openedAt === openedAt);
  const pnl = Number(position.unrealizedPnl);
  const initialMargin = Number(position.positionInitialMargin);
  const isolatedBalance = Number(position.isolatedWallet) + pnl;
  const ratio = position.marginMode === 'isolated' && isolatedBalance > 0 && position.maintMargin != null
    ? Number(position.maintMargin) / isolatedBalance * 100 : null;
  const margin = (position.marginMode === 'isolated' ? positive(position.isolatedWallet) : undefined) ??
    positive(position.positionInitialMargin);
  const notional = position.notional == null ? usdtPositionValue(position.quantity, position.markPrice) :
    usdtPositionDecimal(position.notional.replace(/^-/, ''));
  const openTimeText = openedAt ? formatUTC8(openedAt) + '.' + String(openedAt % 1000).padStart(3, '0') :
    history?.issue ? '待核验' : '核对中…';
  const mode = position.marginMode === 'isolated' ? '逐仓' : position.marginMode === 'cross' ? '全仓' : undefined;
  const long=position.direction==='long';
  const protection=(kind:'tp'|'sl')=>[...new Set(position.protectionOrders?.filter(order=>order.kind===kind)
    .map(order=>usdtPositionDecimal(order.triggerPrice))??[])].join(' / ')||undefined;
  const renderRow=(actions?:LivePositionControls)=><PositionTableRow long={long} testId="usdt-live-position" label={position.symbol+' 实盘持仓'} cells={{
    symbol:<PositionContract symbol={position.symbol} leverage={position.leverage} long={long} onOpen={onOpenChart}
      onLeverage={actions?.onLeverage} badge={<span className="text-primary">币安实盘</span>}/>,
    quantity:<PositionNumber value={quantity+' '+unit} tone={long?'text-trading-green':'text-trading-red'}/>,
    entry:<PositionNumber value={usdtPositionDecimal(position.entryPrice)}/>,
    breakeven:<PositionNumber value={positive(position.breakEvenPrice)??'—'} title="币安返回的损益两平价"/>,
    mark:<PositionNumber value={usdtPositionDecimal(position.markPrice)}/>,
    liquidation:<PositionNumber value={positive(position.liquidationPrice)??'—'} tone="text-trading-red"/>,
    ratio:<PositionNumber value={ratio==null?'—':ratio.toFixed(2)+'%'}
      title={ratio==null?'暂无计算所需的保证金余额':'维持保证金 ÷ 逐仓保证金余额'}/>,
    margin:<div className="flex items-center gap-1">
      <div><PositionNumber value={margin?margin+' '+asset:'—'}/>{mode&&<div className="text-muted-foreground">（{mode}）</div>}</div>
      {actions?.margin}
    </div>,
    pnl:<PositionPnl pnl={pnl} roe={initialMargin>0?pnl/initialMargin*100:null} asset={asset}
      pnlText={pnl===0?'0':(pnl>0?'+':'')+usdtPositionDecimal(position.unrealizedPnl)}/>,
    close:actions?.market??<PositionMarketClose mark={usdtPositionDecimal(position.markPrice)} quantity={quantity}/>,
    protection:<PositionProtectionPrices tp={protection('tp')} sl={protection('sl')}>{actions?.editProtection}</PositionProtectionPrices>,
    addProtection:actions?.addProtection??<PositionProtectionButton/>,
    details:<div title={`名义仓位 ${notional} ${asset}`}>
      <PositionOpenedAt text={openTimeText} title={openedAt?'币安首笔开仓成交时间（北京）':history?.issue}/>
      <div className="flex items-center gap-2 text-[10px]">
        {campaignPath&&(inRouter?<Link className={campaignLinkClass} to={campaignPath}>交易战役</Link>
          :<a className={campaignLinkClass} href={campaignPath}>交易战役</a>)}
        {managed&&<span className={managed.status.state==='blocked'?'text-destructive':'text-primary'}>
          {managed.status.state==='blocked'?'托管待核对':managed.position.pending?'等待成交回报':'策略托管中'}
        </span>}
      </div>
      {follow?.connected&&!follow.positionControls&&<span title="更新 Windows 本机执行端后可操作实盘平仓和止盈止损。" className="text-[10px] text-muted-foreground">执行端待更新</span>}
      {actions?.details}
    </div>,
  }}/>;
  return follow?.positionControls===1 && follow.controlPosition
    ? <UsdtLivePositionActions position={position} control={follow.controlPosition} refresh={live.retryPositions}
        target={campaignId&&openedAt&&!live.issue?{campaignId,openedAt,symbol:position.symbol,
          direction:position.direction,positionSide:position.positionSide,revision:usdtMirrorRevision(position)}:undefined}>
        {renderRow}
      </UsdtLivePositionActions>
    : renderRow();
}
