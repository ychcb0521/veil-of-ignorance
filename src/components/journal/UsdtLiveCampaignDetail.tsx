import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import {useQualityTemplateNames} from '@/contexts/QualityTemplateNamesContext';
import { formatUTC8 } from '@/lib/timeFormat';
import { loadQualityCampaignData } from '@/lib/fish/qualityCampaigns';
import { subscribeInstantCampaigns } from '@/lib/fish/instantCampaignStore';
import { usdtCampaignAmounts, type UsdtLiveCampaign } from '@/lib/fish/usdtLiveCampaign';
import { usdtAmountText } from '@/lib/fish/usdtPositionMirror';

const time = (at: number) => formatUTC8(at) + '.' + String(at % 1000).padStart(3, '0');
const action = { open: '开仓', add: '加仓', reduce: '减仓' } as const;

export function UsdtLiveCampaignDetail({ id }: { id: string }) {
  const owner = useAuth().user?.id;
  const names=useQualityTemplateNames();
  const [campaign, setCampaign] = useState<UsdtLiveCampaign>();
  const [issue, setIssue] = useState('');
  useEffect(() => {
    if (!owner) return;
    const lifetime = new AbortController();
    let revision = 0;
    const refresh = () => {
      const request = ++revision;
      void loadQualityCampaignData(owner, id, lifetime.signal).then(row => {
        if (lifetime.signal.aborted || request !== revision) return;
        setCampaign(row.campaign.comparison?.liveUsdt);
        setIssue('');
      }, error => {
        if (!lifetime.signal.aborted && request === revision) setIssue(error instanceof Error ? error.message : '实盘战役暂时无法读取');
      });
    };
    const unsubscribe = subscribeInstantCampaigns(owner, refresh);
    refresh();
    return () => { lifetime.abort(); unsubscribe(); };
  }, [owner, id]);

  const total = campaign && usdtCampaignAmounts(campaign);
  const amount = (value: number) => usdtAmountText(value) + ' ' + campaign?.asset;
  return <main className="mx-auto max-w-5xl space-y-4 px-4 py-5">
    <Link className="inline-flex items-center gap-1.5 rounded-md px-1 py-1 text-xs text-muted-foreground hover:text-foreground" to="/journal/campaigns?section=instant">
      <ArrowLeft aria-hidden className="h-3.5 w-3.5"/>交易战役
    </Link>
    {issue && <p role="alert" className="text-xs text-destructive">{issue}</p>}
    {!campaign && !issue && <p role="status" className="text-xs text-muted-foreground">正在读取实盘战役…</p>}
    {campaign && total && <>
      <header className="space-y-3 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h1 className="font-mono text-base font-semibold">{campaign.symbol}</h1>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">币安实盘</span>
          <span className="text-[11px] text-muted-foreground">{campaign.management ? '币安手动开仓 · 策略托管' : campaign.followId ? '系统跟单' : '币安开仓'} · {campaign.direction === 'long' ? '多' : '空'}</span>
          <span className={campaign.closedAt ? 'text-[11px] text-muted-foreground' : 'rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300'}>{campaign.closedAt ? '已平仓' : '持仓中'}</span>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
          <div><dt className="text-muted-foreground">已实现盈亏</dt><dd className="mt-0.5 font-mono font-medium">{amount(total.realized)}</dd></div>
          <div><dt className="text-muted-foreground">手续费</dt><dd className="mt-0.5 font-mono">{[...total.fees].map(([asset, fee]) => usdtAmountText(fee) + ' ' + asset).join(' / ')}</dd></div>
          {total.net !== null && <div><dt className="text-muted-foreground">扣手续费后</dt><dd className="mt-0.5 font-mono font-medium">{amount(total.net)}</dd></div>}
          <div><dt className="text-muted-foreground">开仓时间</dt><dd className="mt-0.5 font-mono">{time(campaign.openedAt)}</dd></div>
          {campaign.closedAt && <div><dt className="text-muted-foreground">平仓时间</dt><dd className="mt-0.5 font-mono">{time(campaign.closedAt)}</dd></div>}
          {campaign.management && <div><dt className="text-muted-foreground">冻结持仓模板</dt><dd className="mt-0.5">{names?.forMonitor(campaign.management.monitor.plan,campaign.management.monitor.templateId)?.name??campaign.management.monitor.name}</dd></div>}
          {campaign.management?.exitReason && <div><dt className="text-muted-foreground">策略平仓原因</dt><dd className="mt-0.5">{campaign.management.exitReason}</dd></div>}
        </dl>
      </header>
      <section aria-label="币安逐笔成交" className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full whitespace-nowrap text-left text-xs">
          <caption className="px-3 py-2 text-left font-medium">逐笔成交 <span className="ml-1 text-[10px] font-normal text-muted-foreground">北京时间</span></caption>
          <thead className="bg-muted/50 text-muted-foreground"><tr>{['时间', '动作', '成交价', '成交金额', '已实现盈亏', '手续费'].map(label =>
            <th key={label} scope="col" className="px-3 py-2 font-medium">{label}</th>)}</tr></thead>
          <tbody>{campaign.fills.map((fill, index) => <tr key={fill.id} className="border-t border-border/50">
            <td className="px-3 py-2 font-mono">{time(fill.at)}</td>
            <td className="px-3 py-2">{fill.action === 'reduce' && campaign.closedAt && index === campaign.fills.length - 1 ? '平仓' : action[fill.action]}</td>
            <td className="px-3 py-2 font-mono">{fill.price}</td>
            <td className="px-3 py-2 font-mono" title={fill.positionQuantity + ' 币'}>{amount(Number(fill.price) * Number(fill.positionQuantity))}</td>
            <td className="px-3 py-2 font-mono">{amount(fill.realized)}</td>
            <td className="px-3 py-2 font-mono">{usdtAmountText(fill.commission)} {fill.commissionAsset}</td>
          </tr>)}</tbody>
        </table>
      </section>
    </>}
  </main>;
}
