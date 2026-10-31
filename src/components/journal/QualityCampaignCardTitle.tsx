import {MessageSquareText} from 'lucide-react';
import {Popover,PopoverContent,PopoverTrigger} from '@/components/ui/popover';
import type {TradeCampaign} from '@/types/journal';
/** Legacy generated titles stay intact in storage; the cover uses a compact name. */
export function qualityCampaignCoverTitle(campaign:Pick<TradeCampaign,'title'|'symbol'|'comparison'>){
 if(!campaign.comparison)return campaign.title;
 const source=campaign.comparison.planLabel??campaign.comparison.sellLabel??campaign.title.replace(campaign.symbol,'').replace(/^\s*·\s*/,''),standard=/^(卖出算法(?:组合)?\s*\d+)/.exec(source);
 const name=standard?.[1]??source.split(/\s*·\s*/)[0].replace(/（在组合1的基础上有加仓）/g,'').trim();
 return `${campaign.symbol} · ${name||'卖出方案'}`;
}
export function QualityCampaignCardTitle({campaign,className,highlight,as:Heading='h2'}:{campaign:TradeCampaign;className?:string;highlight?:string;as?:'h1'|'h2'}){
 const sections=[campaign.title,campaign.comparison?.sellLabel&&!campaign.title.includes(campaign.comparison.sellLabel)?campaign.comparison.sellLabel:undefined,campaign.notes].filter((v,i,a)=>v&&a.indexOf(v)===i);
 return <div className="group flex min-w-0 max-w-full items-center gap-1"><Heading data-sort-highlight={highlight} className={(className??'')+' min-w-0 truncate'} data-testid={Heading==='h1'?'campaign-detail-title':'campaign-cover-title'}>{qualityCampaignCoverTitle(campaign)}</Heading>{campaign.comparison&&<Popover><PopoverTrigger asChild><button type="button" aria-label="查看战役备注" title="战役备注" onClick={e=>e.stopPropagation()} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-70 group-focus-within:opacity-70 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:opacity-100 [@media(hover:none)]:opacity-60"><MessageSquareText className="h-3.5 w-3.5"/></button></PopoverTrigger><PopoverContent align="start" collisionPadding={12} className="w-96 max-w-[calc(100vw_-_24px)] space-y-3 text-xs" onClick={e=>e.stopPropagation()}><p className="font-medium">战役备注</p><div className="max-h-[min(60vh,420px)] space-y-3 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-muted-foreground">{sections.map((text,i)=><p key={i}>{text}</p>)}</div></PopoverContent></Popover>}</div>;
}
