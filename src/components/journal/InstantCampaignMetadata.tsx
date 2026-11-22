import {useCampaignTemplateNames} from '@/contexts/QualityTemplateNamesContext';
import { Activity, Filter, Wallet, Waves } from 'lucide-react';
import type { ReactNode } from 'react';
import { QualityMonitorSettingsButton } from '@/components/FishQualityMonitorSettingsView';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { TradeCampaign } from '@/types/journal';
import { FishFrozenScreeningSettings } from '@/components/FishFrozenScreeningSettings';
import type { InstantCampaignMetadata } from '@/lib/fish/instantCampaignMetadata';
import { formatUTC8 } from '@/lib/timeFormat';
import { SCREENED_CDA_GUARD_RULE, SCREENED_PRICE_EXIT_RULE, screenedSellReason } from '@/lib/fish/screenedCda';

const triggerStyle = 'inline-flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground';

function MetadataButton({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
  return <Popover>
    <PopoverTrigger asChild><button type="button" className={triggerStyle} aria-label={'查看' + label}>{icon}{label}</button></PopoverTrigger>
    <PopoverContent align="start" collisionPadding={12} aria-label={label}
      className="w-[34rem] max-w-[calc(100vw-1.5rem)] max-h-[min(80dvh,var(--radix-popover-content-available-height))] space-y-3 overflow-y-auto overscroll-contain text-[11px]">
      <h4 className="text-xs font-medium">{label}</h4>
      {children}
    </PopoverContent>
  </Popover>;
}

function FishingInfo({ fishing, detectors }: { fishing?: InstantCampaignMetadata['fishing']; detectors: { id: string; label: string }[] }) {
  const algorithms = fishing?.algorithms ?? detectors.map(({ label }) => ({ label, reading: undefined, unit: undefined, interval: undefined }));
  if (!algorithms.length) return <p className="text-muted-foreground">当前没有可读取的原始捕捞记录。</p>;
  return <>
    <p>命中 {algorithms.length} 个算法{fishing?.combination ? ' · ' + (fishing.combination === 'and' ? '交集' : '并集') : ''}</p>
    <ul className="space-y-1 font-mono tabular-nums">{algorithms.map((value, index) => <li key={index} className="break-words">
      {value.label}（{value.reading == null ? '读数未保存' : String(value.reading) + (value.unit ?? '')}）{value.interval && <span className="ml-2 text-muted-foreground">{value.interval}</span>}
    </li>)}</ul>
  </>;
}

export function InstantCampaignMetadataButtons({ campaign }: { campaign: TradeCampaign }) {
  const names=useCampaignTemplateNames(campaign);
  const comparison = campaign.comparison, instant = comparison?.instant;
  if (!comparison || !instant) return null;
  const version = instant.sellEvidence?.version;
  const screening = instant.metadata?.screening;
  return <div className="flex flex-wrap gap-2">
    <MetadataButton label="捕捞信息" icon={<Waves aria-hidden className="h-3.5 w-3.5"/>}>
      <FishingInfo fishing={instant.metadata?.fishing} detectors={comparison.detectors}/>
    </MetadataButton>
    <MetadataButton label="动态筛选" icon={<Filter aria-hidden className="h-3.5 w-3.5"/>}>
      <FishFrozenScreeningSettings screening={screening} templateName={screening?.plan?names?.forPlan(screening.plan,'screen',screening.hours):undefined} label={comparison.monitorPlan ? undefined : comparison.planLabel}/>
    </MetadataButton>
    {instant.metadata?.position && <MetadataButton label="仓位设置" icon={<Wallet aria-hidden className="h-3.5 w-3.5"/>}>
      <p>{instant.metadata.position.balanceObservedAt ? '入选时币安可用资金' : '模拟可用资金'} {instant.metadata.position.availableUsdt} USDT · 保证金比例 {instant.metadata.position.marginPct}%</p>
      <p>首仓保证金 {instant.marginUsdt} USDT · 杠杆 {campaign.initial_leverage} 倍 · 首仓名义仓位 {campaign.initial_main_size_usdt} USDT</p>
      {instant.metadata.position.liveBalanceIssue && <p>本次实盘未开仓 · {instant.metadata.position.liveBalanceIssue}</p>}
    </MetadataButton>}
    {comparison.monitorPlan ? <QualityMonitorSettingsButton plan={comparison.monitorPlan} campaign={campaign}/> :
      <MetadataButton label="持仓监测" icon={<Activity aria-hidden className="h-3.5 w-3.5"/>}>
        <p>{comparison.sellLabel}</p>
        <p>保证金 {instant.marginUsdt} USDT · {campaign.initial_leverage} 倍 · 名义仓位 {campaign.initial_main_size_usdt} USDT</p>
        {(version === SCREENED_CDA_GUARD_RULE || version === SCREENED_PRICE_EXIT_RULE) && <p>DBL-5-5mins 防守线-20261112 · 5 分钟收盘确认 · 支持手动卖出</p>}
        {instant.sellEvidence && <p>本次卖出 {screenedSellReason({ at: comparison.valuedAt, evidence: instant.sellEvidence })}</p>}
        {instant.cdaValue != null && <p>CDA 确认读数 {instant.cdaValue}</p>}
      </MetadataButton>}
    {!!instant.switches?.length && <MetadataButton label="方案切换记录" icon={<Activity aria-hidden className="h-3.5 w-3.5"/>}>
      <ul className="space-y-1">{instant.switches.map(({ effectiveAt, from, to }) => <li key={effectiveAt}>
        {formatUTC8(effectiveAt)} · {from.name} → {to.name}
      </li>)}</ul>
    </MetadataButton>}
  </div>;
}
