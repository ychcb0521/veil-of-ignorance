import { Link, useInRouterContext } from 'react-router-dom';
import { formatUTC8 } from '@/lib/timeFormat';
import {
  usdtMirrorRevision, usdtPositionDecimal, usdtPositionQuantityUnit, usdtPositionValue, usdtSettlementAsset,
  type UsdtMirrorPosition,
} from '@/lib/fish/usdtPositionMirror';
import { usdtLiveCampaignId } from '@/lib/fish/usdtLiveCampaign';
import type { useUsdtLiveTrading } from '@/hooks/useUsdtLiveTrading';
import type { useBinanceManualMonitor } from '@/hooks/useBinanceManualMonitor';
import { DetailCell, EntryPriceCell, PositionCardHeader, PositionCardPnl, positionActionsClass, positionCardClass, positionDetailsClass } from './PositionCard';

const positive = (value: string | undefined) => value != null && Number(value) > 0 ? usdtPositionDecimal(value) : undefined;
const campaignLinkClass = 'flex-1 py-2 text-center text-xs font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground';

export function UsdtLivePositionCard({ position, live, entryMode, onToggleEntry }: {
  position: UsdtMirrorPosition;
  live: ReturnType<typeof useUsdtLiveTrading> & { management?: ReturnType<typeof useBinanceManualMonitor> };
  entryMode: 'entry' | 'breakeven';
  onToggleEntry: () => void;
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
  const campaignPath = campaign && '/journal/campaigns/' + encodeURIComponent(usdtLiveCampaignId(campaign)) + '?section=instant';
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
  return <div className={positionCardClass} data-testid="usdt-live-position" role="group" aria-label={position.symbol + ' 实盘持仓'}>
    <PositionCardHeader asset={unit} contract={asset + ' 永续'} long={position.direction === 'long'}
      leverage={position.leverage} mode={mode} openTimeText={openTimeText} openTimeTitle={openedAt ? '币安首笔开仓成交时间（北京）' : history?.issue}>
      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">币安实盘</span>
      {managed && <span className={managed.status.state === 'blocked' ? 'text-[10px] text-destructive' : 'text-[10px] text-primary'}>
        {managed.status.state === 'blocked' ? '托管待核对' : managed.position.pending ? '等待成交回报' : '策略托管中'}
      </span>}
    </PositionCardHeader>
    <PositionCardPnl pnl={pnl} roe={initialMargin > 0 ? pnl / initialMargin * 100 : null} asset={asset}
      pnlText={pnl === 0 ? '0' : (pnl > 0 ? '+' : '') + usdtPositionDecimal(position.unrealizedPnl)} />
    <div className={positionDetailsClass}>
      <DetailCell label="持仓数量" value={quantity + ' ' + unit} />
      <DetailCell label="保证金" value={margin ? margin + ' ' + asset : '—'} />
      <DetailCell label="保证金比率" value={ratio == null ? '—' : ratio.toFixed(2) + '%'}
        title={ratio == null ? '当前持仓回报未提供计算所需的保证金余额' : '维持保证金 ÷ 逐仓保证金余额'} />
      <EntryPriceCell mode={entryMode} onToggle={onToggleEntry} entryText={usdtPositionDecimal(position.entryPrice)}
        breakevenText={positive(position.breakEvenPrice) ?? '—'} breakevenTitle="币安返回的损益两平价。" />
      <DetailCell label="标记价格" value={usdtPositionDecimal(position.markPrice)} />
      <DetailCell label="强平价格" value={positive(position.liquidationPrice) ?? '—'} valueClassName="text-trading-red" />
    </div>
    <div className="flex flex-wrap gap-x-3 px-3 pb-2 text-[10px] text-muted-foreground">
      <span className="font-mono tabular-nums">名义仓位 {notional} {asset}</span>
    </div>
    {campaignPath && <div className={positionActionsClass}>
      {inRouter
        ? <Link className={campaignLinkClass} to={campaignPath}>交易战役</Link>
        : <a className={campaignLinkClass} href={campaignPath}>交易战役</a>}
    </div>}
  </div>;
}
