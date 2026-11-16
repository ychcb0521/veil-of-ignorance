import { formatUTC8 } from '@/lib/timeFormat';
import type { UsdtLiveCampaign } from '@/lib/fish/usdtLiveCampaign';
import { usdtAmountText, usdtPositionQuantityUnit } from '@/lib/fish/usdtPositionMirror';

export function usdtFillTime(at: number) {
  return formatUTC8(at) + '.' + String(at % 1000).padStart(3, '0');
}

const fillLabels = { open: '开仓', add: '加仓', reduce: '减仓' } as const;

export function usdtCampaignFillLabel(campaign: UsdtLiveCampaign, index: number) {
  const fill = campaign.fills[index];
  if (fill.action !== 'reduce' && fill.orderId === campaign.fills[0].orderId) return '开仓';
  return fill.action === 'reduce' && campaign.closedAt && index === campaign.fills.length - 1 ? '平仓' : fillLabels[fill.action];
}

export function UsdtLiveCampaignFills({ campaign }: { campaign: UsdtLiveCampaign }) {
  const unit = usdtPositionQuantityUnit(campaign.symbol);
  return <section aria-label="币安逐笔成交" className="overflow-x-auto rounded border border-border bg-card">
    <table className="w-full whitespace-nowrap text-left text-xs">
      <caption className="px-3 py-2 text-left font-medium">逐笔成交 <span className="ml-1 text-[10px] font-normal text-muted-foreground">北京时间</span></caption>
      <thead className="bg-muted/50 text-muted-foreground"><tr>{['时间', '动作', '成交价', '成交数量', '成交金额', '已实现盈亏', '手续费'].map(label =>
        <th key={label} scope="col" className="px-3 py-2 font-medium">{label}</th>)}</tr></thead>
      <tbody>{campaign.fills.map((fill, index) => <tr key={fill.id} className="border-t border-border/50">
        <td className="px-3 py-2 font-mono">{usdtFillTime(fill.at)}</td>
        <td className="px-3 py-2">{usdtCampaignFillLabel(campaign, index)}</td>
        <td className="px-3 py-2 font-mono">{fill.price}</td>
        <td className="px-3 py-2 font-mono">{fill.positionQuantity} {unit}</td>
        <td className="px-3 py-2 font-mono">{usdtAmountText(Number(fill.price) * Number(fill.positionQuantity))} {campaign.asset}</td>
        <td className="px-3 py-2 font-mono">{usdtAmountText(fill.realized)} {campaign.asset}</td>
        <td className="px-3 py-2 font-mono">{usdtAmountText(fill.commission)} {fill.commissionAsset}</td>
      </tr>)}</tbody>
    </table>
  </section>;
}
