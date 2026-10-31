import { useEffect, useState } from 'react';
import { Info, SlidersHorizontal, Table2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CAMPAIGN_SECTIONS, type CampaignSection } from '@/lib/campaignSections';

interface MonitoringOptions {
  sellFilter: string;
  detectorFilter: string;
  categoryFilter: string;
  plans: readonly (readonly [string, string])[];
  detectors: readonly (readonly [string, string])[];
  categories: readonly string[];
  buyFilterLabel?: string | null;
  statsOpen: boolean;
  onFilterChange: (key: 'sell' | 'detector' | 'category', value: string) => void;
  onStatsToggle: () => void;
}

export function CampaignSectionControls({ section, onSectionChange, monitoring }: {
  section: CampaignSection;
  onSectionChange: (section: CampaignSection) => void;
  monitoring: MonitoringOptions;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [section]);
  const filtered = Boolean(monitoring.sellFilter || monitoring.detectorFilter || monitoring.categoryFilter);
  const field = 'h-8 w-full min-w-0 rounded border border-border bg-card px-2 text-[11px]';
  return <div className="mb-4 flex flex-wrap items-center gap-2" data-testid="campaign-section-controls">
    <nav className="inline-flex rounded-md bg-muted/60 p-0.5 font-sans text-[12px] font-medium leading-5" aria-label="交易战役板块">
      {CAMPAIGN_SECTIONS.map(item => <button type="button" key={item.id} aria-current={section === item.id ? 'page' : undefined}
        className={`rounded px-3 py-1.5 ${section === item.id ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
        onClick={() => { setOpen(false); onSectionChange(item.id); }}>{item.label}</button>)}
    </nav>
    {section === 'quality' && <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><button type="button" aria-label="持仓监测筛选与说明" title={filtered ? '持仓监测筛选与说明（已筛选）' : '持仓监测筛选与说明'}
        className={`inline-flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${filtered ? 'text-primary/70' : 'text-muted-foreground/30 hover:text-muted-foreground'}`}>
        <SlidersHorizontal aria-hidden strokeWidth={1.4} className="h-3.5 w-3.5" />
      </button></PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} collisionPadding={12} aria-label="持仓监测筛选与说明"
        className="w-80 max-w-[calc(100vw_-_24px)] max-h-[min(80vh,var(--radix-popover-content-available-height))] space-y-3 overflow-y-auto overscroll-contain p-3 text-[11px]">
        <p className="font-medium text-foreground">持仓监测</p>
        <label className="grid gap-1.5 text-muted-foreground">卖出方案<select aria-label="战役卖出方案" className={field} value={monitoring.sellFilter} onChange={e => monitoring.onFilterChange('sell', e.target.value)}><option value="">全部卖出方案</option>{monitoring.plans.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="grid gap-1.5 text-muted-foreground">探测算法<select aria-label="战役探测算法" className={field} value={monitoring.detectorFilter} onChange={e => monitoring.onFilterChange('detector', e.target.value)}><option value="">全部探测算法</option>{monitoring.detectors.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="grid gap-1.5 text-muted-foreground">信号类别<select aria-label="战役探测信号类别" className={field} value={monitoring.categoryFilter} onChange={e => monitoring.onFilterChange('category', e.target.value)}><option value="">全部探测信号类别</option>{monitoring.categories.map(category => <option key={category} value={category}>{category}</option>)}</select></label>
        <div className="flex items-center justify-between border-t border-border/60 pt-2">
          <Popover><PopoverTrigger asChild><button type="button" aria-label="持仓监测说明" className="inline-flex h-7 items-center gap-1.5 rounded px-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><Info aria-hidden className="h-3.5 w-3.5" />使用说明</button></PopoverTrigger>
            <PopoverContent align="start" collisionPadding={12} aria-label="持仓监测说明" className="w-80 max-w-[calc(100vw_-_24px)] max-h-[min(80vh,var(--radix-popover-content-available-height))] space-y-2 overflow-y-auto p-3 text-[11px] leading-relaxed">
              <p className="font-medium">持仓监测</p>
              <p className="text-muted-foreground">按卖出方案、探测算法和信号类别筛选持仓监测战役；同一笔交易命中多个探测算法时只统计一次。条件与结果沿用保存时的记录。</p>
              {monitoring.buyFilterLabel && <p className="text-muted-foreground" data-testid="comparison-buy-filter">买入过滤：{monitoring.buyFilterLabel}</p>}
              <p className="text-muted-foreground">未设价格保护线或未加仓的风险指标，沿用原战役口径显示「—」。完整算法条件可从战役标题旁的备注图标查看。</p>
            </PopoverContent>
          </Popover>
          <button type="button" aria-label={monitoring.statsOpen ? '收起监测统计' : '展开监测统计'} aria-expanded={monitoring.statsOpen} aria-controls="comparison-campaign-overview"
            onClick={() => { monitoring.onStatsToggle(); setOpen(false); }} className="inline-flex h-7 items-center gap-1.5 rounded px-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><Table2 aria-hidden className="h-3.5 w-3.5" />监测统计</button>
        </div>
      </PopoverContent>
    </Popover>}
  </div>;
}
