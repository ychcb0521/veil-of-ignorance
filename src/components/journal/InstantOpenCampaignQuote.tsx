import { useInstantPositionQuote } from '@/hooks/useInstantPositionQuote';
import { formatPrice, formatSignedUSDT } from '@/lib/formatters';
import { formatBeijingTime } from '@/lib/timeFormat';
import type { TradeCampaign } from '@/types/journal';

type Instant = NonNullable<NonNullable<TradeCampaign['comparison']>['instant']>;
type Open = NonNullable<Instant['openPosition']>;

export function InstantOpenCampaignQuote({ source, position }: { source: Instant['source']; position: Open }) {
  const state = useInstantPositionQuote({ source, buyAt: position.buyAt });
  const quote = state?.value;
  const floating = quote ? quote.price * position.quantity - position.cost : null;
  const color = floating == null ? 'text-muted-foreground' : floating >= 0 ? 'text-trading-green' : 'text-trading-red';
  const quoteLabel = quote?.kind === 'close' ? '最近收盘价' : state?.delayed ? '最近标记价格' : '标记价格';
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono" data-testid="instant-open-campaign-quote">
    <span>{quoteLabel} {quote ? formatPrice(quote.price, source.symbol) : '—'}</span>
    <span className={color}>未实现盈亏 {floating == null ? '—' : formatSignedUSDT(floating) + ' USDT'}</span>
    <span>已实现盈亏 {formatSignedUSDT(position.realizedPnl)} USDT</span>
    {quote && <span className="text-muted-foreground">{formatBeijingTime(quote.at)}</span>}
  </div>;
}
