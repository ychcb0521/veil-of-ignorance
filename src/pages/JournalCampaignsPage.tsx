import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Layers } from 'lucide-react';
import { BackButton } from '@/components/journal/BackButton';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { listAllCampaigns, getCampaignWithLegs } from '@/lib/journalApi';
import { LEG_ROLE_LABELS, STRATEGY_TEMPLATES } from '@/lib/strategyTemplates';
import type { CampaignStatus, LegRole, TradeCampaign, TradeJournal } from '@/types/journal';

type CampaignCardData = {
  campaign: TradeCampaign;
  legs: TradeJournal[];
};

const STATUS_OPTIONS: Array<{ value: CampaignStatus | 'all'; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'active', label: 'active' },
  { value: 'closed_profit', label: 'closed_profit' },
  { value: 'closed_loss', label: 'closed_loss' },
  { value: 'abandoned', label: 'abandoned' },
];

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-[#F0B90B]/15 text-[#F0B90B]',
  closed_profit: 'bg-[#0ECB81]/15 text-[#0ECB81]',
  closed_loss: 'bg-[#F6465D]/15 text-[#F6465D]',
  closed_breakeven: 'bg-muted text-muted-foreground',
  planned: 'bg-muted text-muted-foreground',
  abandoned: 'bg-[#848E9C]/15 text-[#848E9C]',
};

const DIRECTION_STYLES: Record<string, string> = {
  main_long: 'bg-[#0ECB81]/10 text-[#0ECB81]',
  main_short: 'bg-[#F6465D]/10 text-[#F6465D]',
};

const LEG_ABBR: Record<LegRole, string> = {
  main_open: 'M',
  hedge_initial_a: 'Ha',
  hedge_initial_b: 'Hb',
  hedge_rolling: 'R',
  mirror_tp: 'TP',
  reentry_main: 'RM',
  reentry_hedge: 'RH',
  standalone: 'S',
};

const LEG_CHIP_CLASS: Record<LegRole, string> = {
  main_open: 'bg-[#0ECB81]/10 text-[#0ECB81]',
  hedge_initial_a: 'bg-[#F6465D]/10 text-[#F6465D]',
  hedge_initial_b: 'bg-[#F6465D]/10 text-[#F6465D]',
  hedge_rolling: 'bg-[#B080FF]/10 text-[#B080FF]',
  mirror_tp: 'bg-[#F0B90B]/10 text-[#F0B90B]',
  reentry_main: 'bg-[#0ECB81]/10 text-[#0ECB81]',
  reentry_hedge: 'bg-[#B080FF]/10 text-[#B080FF]',
  standalone: 'bg-muted text-muted-foreground',
};

const fmtTime = (iso: string | null) => (iso ? iso.replace('T', ' ').slice(0, 16) : '进行中');

function durationLabel(openedAt: string, closedAt: string | null) {
  const end = closedAt ? new Date(closedAt).getTime() : Date.now();
  const start = new Date(openedAt).getTime();
  const mins = Math.max(0, Math.floor((end - start) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const restMins = mins % 60;
  if (hours < 24) return `${hours}h ${restMins}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export default function JournalCampaignsPage() {
  const nav = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [status, setStatus] = useState<CampaignStatus | 'all'>('all');
  const [symbol, setSymbol] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<CampaignCardData[]>([]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const campaigns = await listAllCampaigns(user.id, {
          status,
          symbol: symbol.trim() || undefined,
          dateFrom: dateFrom ? `${dateFrom}T00:00:00.000Z` : undefined,
          dateTo: dateTo ? `${dateTo}T23:59:59.999Z` : undefined,
        });
        const full = await Promise.all(
          campaigns.map(async campaign => {
            const details = await getCampaignWithLegs(campaign.id);
            return { campaign, legs: details.legs };
          }),
        );
        if (!cancelled) setRows(full);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, status, symbol, dateFrom, dateTo]);

  const activeCount = useMemo(
    () => rows.filter((row: CampaignCardData) => row.campaign.status === 'active').length,
    [rows],
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="px-6 py-3 max-w-[1600px] mx-auto flex items-center gap-3">
          <BackButton />
          <div>
            <h1 className="text-[14px] font-medium">交易战役</h1>
            <p className="text-[11px] text-muted-foreground">复盘的高层单位</p>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-6 py-4">
        {activeCount > 0 && (
          <div className="mb-4 bg-[#F0B90B]/10 border border-[#F0B90B]/30 rounded px-3 py-2 text-[11px] text-[#F0B90B]">
            你有 {activeCount} 个进行中的战役。每个战役都应该有明确的退出条件——不要让它无限期 active。
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
          <select
            value={status}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setStatus(e.target.value as CampaignStatus | 'all')}
            className="h-9 rounded-md border border-border bg-card px-3 text-[12px]"
          >
            {STATUS_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <Input
            value={symbol}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setSymbol(e.target.value.toUpperCase())}
            placeholder="标的，例如 BTCUSDT"
            className="h-9 text-[12px]"
          />
          <Input
            type="date"
            value={dateFrom}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setDateFrom(e.target.value)}
            className="h-9 text-[12px]"
          />
          <Input
            type="date"
            value={dateTo}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setDateTo(e.target.value)}
            className="h-9 text-[12px]"
          />
        </div>

        {loading ? (
          <div className="border border-border rounded p-10 text-center text-[12px] text-muted-foreground">加载中…</div>
        ) : rows.length === 0 ? (
          <div className="border border-border rounded p-10 text-center space-y-2">
            <div className="mx-auto w-10 h-10 rounded-full bg-accent flex items-center justify-center">
              <Layers className="w-5 h-5 text-muted-foreground" />
            </div>
            <div className="text-[13px] font-medium">尚无战役</div>
            <div className="text-[12px] text-muted-foreground">你下次开主力单时会自动创建第一个战役</div>
          </div>
        ) : (
          rows.map(({ campaign, legs }) => {
            const statusLabel = campaign.status === 'active'
              ? '进行中'
              : campaign.status === 'closed_profit'
                ? '盈利结束'
                : campaign.status === 'closed_loss'
                  ? '亏损结束'
                  : campaign.status === 'abandoned'
                    ? '已放弃'
                    : campaign.status;
            return (
              <div
                key={campaign.id}
                onClick={() => nav(`/journal/campaigns/${campaign.id}${location.search}`)}
                className="bg-card border border-border rounded p-4 mb-3 cursor-pointer hover:bg-accent transition-colors"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`inline-flex h-2.5 w-2.5 rounded-full ${STATUS_STYLES[campaign.status] || 'bg-muted'}`} />
                    <div className="text-[13px] font-medium">{campaign.title}</div>
                    <span className={`px-2 py-0.5 rounded text-[10px] ${DIRECTION_STYLES[campaign.direction] || 'bg-muted text-muted-foreground'}`}>
                      {campaign.direction === 'main_short' ? '主空' : '主多'}
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] bg-muted text-muted-foreground">{campaign.symbol}</span>
                    <span className="text-[11px] text-muted-foreground">{STRATEGY_TEMPLATES[campaign.strategy_template].name}</span>
                  </div>
                  <div className={`px-2 py-0.5 rounded text-[11px] ${STATUS_STYLES[campaign.status] || 'bg-muted text-muted-foreground'}`}>
                    {statusLabel}
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-2 text-[11px] font-mono text-muted-foreground">
                  <div>{fmtTime(campaign.opened_at)} → {fmtTime(campaign.closed_at)}</div>
                  <div>含 {legs.length} legs · 持续 {durationLabel(campaign.opened_at, campaign.closed_at)}</div>
                  <div>
                    已实现 P&L：{campaign.final_realized_pnl == null ? '—' : campaign.final_realized_pnl.toFixed(2)}
                  </div>
                  <div>峰值浮盈：{campaign.status === 'active' ? '批次 17 计算' : (campaign.peak_unrealized_pnl ?? '—')}</div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {legs.length === 0 ? (
                    <span className="text-[10px] text-muted-foreground">暂无 legs</span>
                  ) : (
                    legs.map((leg: TradeJournal) => (
                      <span
                        key={leg.id}
                        title={leg.leg_role ? LEG_ROLE_LABELS[leg.leg_role] : '未归类'}
                        className={`px-2 py-0.5 rounded text-[10px] ${leg.leg_role ? LEG_CHIP_CLASS[leg.leg_role] : 'bg-muted text-muted-foreground'}`}
                      >
                        {leg.leg_role ? LEG_ABBR[leg.leg_role] : '?'}
                      </span>
                    ))
                  )}
                </div>
              </div>
            );
          })
        )}
      </main>
    </div>
  );
}
