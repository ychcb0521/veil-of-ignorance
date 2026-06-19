import { type ChangeEvent, useEffect, useMemo, useState } from 'react';
import { Plus, RotateCcw, Trash2, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ReplayKlineChart } from '@/components/journal/ReplayKlineChart';
import { type AnalysisDraggableVerticalLine } from '@/components/CandlestickChart';
import { intervalToMs, type KlineData } from '@/hooks/useBinanceData';
import { buildActualSimulationParams, buildPureSopParams } from '@/lib/campaignSimulationEngine';
import { LEG_ROLE_LABELS } from '@/lib/strategyTemplates';
import type {
  CampaignCounterfactualManualLeg,
  CampaignCounterfactualParams,
  LegRole,
  TradeCampaign,
  TradeJournal,
} from '@/types/journal';

interface Props {
  campaign: TradeCampaign;
  legs: TradeJournal[];
  klines: KlineData[];
  klinesLoading: boolean;
  interval: string;
  timezone?: string;
  pureRunning: boolean;
  whatIfRunning: boolean;
  onRunPureSop: () => void;
  onRunWhatIf: (label: string, params: CampaignCounterfactualParams) => void;
}

const LONG_LINE = '#002FA7'; // Klein blue
const SHORT_LINE = '#3B0764'; // deep purple

const ROLE_OPTIONS: LegRole[] = [
  'main_open',
  'main_add_1',
  'main_add_2',
  'main_add_3',
  'main_add_4',
  'main_add_5',
  'main_add_6',
  'hedge_initial_a',
  'hedge_initial_b',
  'hedge_rolling',
  'mirror_tp',
  'reentry_main',
  'reentry_hedge',
  'standalone',
];

function round(value: number, digits: number = 4) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function roleLabel(role: string) {
  return LEG_ROLE_LABELS[role as LegRole] ?? role;
}

function shortRoleLabel(role: string) {
  if (role === 'main_open') return 'M';
  if (role.startsWith('main_add_')) return `加${role.replace('main_add_', '')}`;
  if (role === 'hedge_initial_a') return 'H-A';
  if (role === 'hedge_initial_b') return 'H-B';
  if (role === 'hedge_rolling') return 'Hr';
  if (role === 'mirror_tp') return 'TP';
  if (role === 'reentry_main') return '再M';
  if (role === 'reentry_hedge') return '再H';
  return roleLabel(role).slice(0, 4);
}

function toLocalInputValue(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => `${value}`.padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-') + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInputValue(value: string, fallback: string) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function validTimeMs(value: string) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function nearestKline(klines: KlineData[], time: number): KlineData | null {
  if (klines.length === 0) return null;
  return klines.reduce((best, item) => (
    Math.abs(item.time - time) < Math.abs(best.time - time) ? item : best
  ), klines[0]);
}

function defaultCloseTime(params: CampaignCounterfactualParams, klines: KlineData[]) {
  const last = klines[klines.length - 1];
  return last ? new Date(last.time).toISOString() : params.entry.time;
}

function buildManualLegs(
  params: CampaignCounterfactualParams,
  legs: TradeJournal[],
  klines: KlineData[],
): CampaignCounterfactualManualLeg[] {
  const fallbackClose = defaultCloseTime(params, klines);
  const ordered = [...legs].sort((a, b) => {
    const seqA = a.leg_sequence ?? 9999;
    const seqB = b.leg_sequence ?? 9999;
    if (seqA !== seqB) return seqA - seqB;
    return new Date(a.pre_simulated_time).getTime() - new Date(b.pre_simulated_time).getTime();
  });

  return ordered
    .map((leg, index) => {
      const openTime = leg.pre_simulated_time || params.entry.time;
      const closeTime = leg.post_real_close_time || fallbackClose;
      const closeMs = validTimeMs(closeTime) ?? validTimeMs(fallbackClose) ?? validTimeMs(openTime) ?? Date.now();
      const openMs = validTimeMs(openTime) ?? closeMs;
      const normalizedClose = closeMs >= openMs ? closeTime : new Date(openMs).toISOString();
      const entryPrice = leg.pre_entry_price ?? params.entry.price;
      return {
        id: leg.id || `leg-${index}`,
        leg_role: leg.leg_role ?? 'standalone',
        direction: leg.direction === 'short' ? 'short' : 'long',
        open_time: openTime,
        close_time: normalizedClose,
        entry_price: entryPrice,
        exit_price: leg.post_exit_price_snapshot ?? entryPrice,
        size_usdt: leg.pre_position_size ?? params.entry.size_usdt,
        leverage: leg.leverage ?? params.entry.leverage ?? 1,
        enabled: true,
      } satisfies CampaignCounterfactualManualLeg;
    })
    .filter(leg => leg.entry_price > 0 && leg.size_usdt > 0);
}

export function CampaignWhatIfEditor({
  campaign,
  legs,
  klines,
  klinesLoading,
  interval,
  timezone,
  pureRunning,
  whatIfRunning,
  onRunPureSop,
  onRunWhatIf,
}: Props) {
  const actualDefaults = useMemo(() => buildActualSimulationParams(campaign, legs), [campaign, legs]);
  const sopDefaults = useMemo(() => buildPureSopParams(campaign, legs), [campaign, legs]);
  const baseDefaults = actualDefaults ?? sopDefaults;
  const [params, setParams] = useState<CampaignCounterfactualParams | null>(baseDefaults);
  const [manualLegs, setManualLegs] = useState<CampaignCounterfactualManualLeg[]>([]);
  const [label, setLabel] = useState('');

  useEffect(() => {
    setParams(baseDefaults);
    if (baseDefaults) setManualLegs(buildManualLegs(baseDefaults, legs, klines));
  }, [baseDefaults, legs, klines]);

  const canRun = !klinesLoading && klines.length > 0;
  const chartCurrentTime = klines.length > 0
    ? klines[klines.length - 1].time + intervalToMs(interval)
    : Date.now();

  const updateManualLeg = (id: string, patch: Partial<CampaignCounterfactualManualLeg>) => {
    setManualLegs(prev => prev.map(leg => (leg.id === id ? { ...leg, ...patch } : leg)));
  };

  const addHedgeLeg = () => {
    if (!params) return;
    const now = params.entry.time;
    const lastTime = defaultCloseTime(params, klines);
    const lastPrice = klines[klines.length - 1]?.close ?? params.entry.price;
    setManualLegs(prev => [
      ...prev,
      {
        id: `manual-${Date.now()}`,
        leg_role: 'hedge_rolling',
        direction: params.entry.direction === 'long' ? 'short' : 'long',
        open_time: now,
        close_time: lastTime,
        entry_price: params.entry.price,
        exit_price: lastPrice,
        size_usdt: round(params.entry.size_usdt * 0.5, 2),
        leverage: params.entry.leverage,
        enabled: true,
      },
    ]);
  };

  const resetManualLegs = () => {
    if (!baseDefaults) return;
    setManualLegs(buildManualLegs(baseDefaults, legs, klines));
    setParams(baseDefaults);
  };

  const activeManualLegs = manualLegs.filter(leg => leg.enabled);

  const verticalLines = useMemo<AnalysisDraggableVerticalLine[]>(() => {
    return activeManualLegs.flatMap(leg => {
      const color = leg.direction === 'long' ? LONG_LINE : SHORT_LINE;
      const openMs = validTimeMs(leg.open_time);
      const closeMs = validTimeMs(leg.close_time);
      const labelPrefix = shortRoleLabel(leg.leg_role);
      return [
        openMs == null ? null : {
          id: `${leg.id}:open`,
          time: openMs,
          color,
          dashed: false,
          label: `${labelPrefix} 开`,
        },
        closeMs == null ? null : {
          id: `${leg.id}:close`,
          time: closeMs,
          color,
          dashed: true,
          label: `${labelPrefix} 平`,
        },
      ].filter(Boolean) as AnalysisDraggableVerticalLine[];
    });
  }, [activeManualLegs]);

  const handleDragVerticalLine = (id: string, time: number) => {
    const [legId, endpoint] = id.split(':');
    const kline = nearestKline(klines, time);
    const iso = new Date(time).toISOString();
    if (endpoint === 'open') {
      updateManualLeg(legId, {
        open_time: iso,
        entry_price: kline ? round(kline.close, 8) : undefined,
      });
    }
    if (endpoint === 'close') {
      updateManualLeg(legId, {
        close_time: iso,
        exit_price: kline ? round(kline.close, 8) : undefined,
      });
    }
  };

  const runManualScenario = () => {
    if (!params) return;
    const runLabel = label.trim() || 'Legs 调整方案';
    onRunWhatIf(runLabel, {
      ...params,
      manual_legs: activeManualLegs,
    });
  };

  if (!params) {
    return (
      <div className="rounded border border-border bg-muted/40 px-4 py-4 text-[13px] text-muted-foreground">
        无法从该战役推断主力开仓数据，暂不能运行反事实模拟。
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-[#0ECB81]/5 border border-[#0ECB81]/30 rounded p-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-full bg-[#0ECB81]/15 flex items-center justify-center text-[#0ECB81]">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-[14px] font-medium">一键运行（标准 SOP）</div>
            <div className="text-[11px] text-muted-foreground">
              用这场战役的真实市场数据，按标准参数跑一遍。
            </div>
          </div>
        </div>
        <div className="flex-1" />
        <Button
          className="bg-[#0ECB81] text-black hover:bg-[#0ECB81]/90 h-9 text-[12px]"
          disabled={pureRunning || !canRun}
          onClick={onRunPureSop}
        >
          {pureRunning ? '运行中…' : '一键运行'}
        </Button>
      </div>

      <div className="bg-card border border-border rounded p-4 space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
          <div className="space-y-1 min-w-0">
            <div className="text-[14px] font-medium">Legs 副本 · 手动反事实</div>
            <div className="text-[11px] text-muted-foreground">
              复制当前 Legs 后再调整。你可以改开/平时间、价格、仓位，也可以删除或增加对冲；拖动盘面竖线会同步回写时间与价格。
            </div>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <Button variant="outline" className="h-8 text-[11px]" onClick={resetManualLegs}>
              <RotateCcw className="w-3.5 h-3.5 mr-1" />
              还原 Legs
            </Button>
            <Button variant="outline" className="h-8 text-[11px]" onClick={addHedgeLeg}>
              <Plus className="w-3.5 h-3.5 mr-1" />
              增加对冲
            </Button>
          </div>
        </div>

        <div className="h-[320px] border border-border rounded overflow-hidden">
          {klinesLoading ? (
            <div className="h-full flex items-center justify-center text-[12px] text-muted-foreground">加载 K 线…</div>
          ) : klines.length === 0 ? (
            <div className="h-full flex items-center justify-center text-[12px] text-muted-foreground">暂无 K 线数据</div>
          ) : (
            <ReplayKlineChart
              klines={klines}
              currentTime={chartCurrentTime}
              intervalMs={intervalToMs(interval)}
              symbol={campaign.symbol}
              fitAll
              showLastPriceLine={false}
              draggableVerticalLines={verticalLines}
              onDragVerticalLine={handleDragVerticalLine}
              timezone={timezone}
            />
          )}
        </div>

        <div className="border border-border rounded overflow-x-auto">
          <table className="w-full min-w-[980px] text-[11px]">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 w-10">#</th>
                <th className="text-left px-3 py-2">角色</th>
                <th className="text-left px-3 py-2">方向</th>
                <th className="text-left px-3 py-2">开仓时间</th>
                <th className="text-left px-3 py-2">平仓时间</th>
                <th className="text-left px-3 py-2">开仓价</th>
                <th className="text-left px-3 py-2">平仓价</th>
                <th className="text-left px-3 py-2">仓位</th>
                <th className="text-right px-3 py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {manualLegs.map((leg, index) => (
                <tr key={leg.id} className={`border-t border-border ${leg.enabled ? '' : 'opacity-45'}`}>
                  <td className="px-3 py-2 font-mono">{index + 1}</td>
                  <td className="px-3 py-2">
                    <select
                      className="h-8 w-full rounded border border-border bg-background px-2"
                      value={leg.leg_role}
                      onChange={(e: ChangeEvent<HTMLSelectElement>) => updateManualLeg(leg.id, { leg_role: e.target.value })}
                    >
                      {ROLE_OPTIONS.map(role => (
                        <option key={role} value={role}>{roleLabel(role)}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      className="h-8 w-full rounded border border-border bg-background px-2"
                      value={leg.direction}
                      onChange={(e: ChangeEvent<HTMLSelectElement>) => updateManualLeg(leg.id, { direction: e.target.value as 'long' | 'short' })}
                    >
                      <option value="long">多</option>
                      <option value="short">空</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="datetime-local"
                      className="h-8 text-[11px]"
                      value={toLocalInputValue(leg.open_time)}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => updateManualLeg(leg.id, { open_time: fromLocalInputValue(e.target.value, leg.open_time) })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="datetime-local"
                      className="h-8 text-[11px]"
                      value={toLocalInputValue(leg.close_time)}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => updateManualLeg(leg.id, { close_time: fromLocalInputValue(e.target.value, leg.close_time) })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      className="h-8 text-[11px]"
                      value={leg.entry_price}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => updateManualLeg(leg.id, { entry_price: Number(e.target.value) })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      className="h-8 text-[11px]"
                      value={leg.exit_price}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => updateManualLeg(leg.id, { exit_price: Number(e.target.value) })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      className="h-8 text-[11px]"
                      value={leg.size_usdt}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => updateManualLeg(leg.id, { size_usdt: Number(e.target.value) })}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => updateManualLeg(leg.id, { enabled: !leg.enabled })}
                      className="text-[11px] text-muted-foreground hover:text-foreground mr-3"
                    >
                      {leg.enabled ? '停用' : '启用'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setManualLegs(prev => prev.filter(item => item.id !== leg.id))}
                      className="inline-flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:bg-[#F6465D]/10 hover:text-[#F6465D]"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {manualLegs.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-5 text-center text-[12px] text-muted-foreground">
                    还没有可模拟的 leg。先点“增加对冲”，或回到归类页补全 Legs。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            value={label}
            placeholder="方案名，例如「对冲提前 20 分钟」「删除第二条对冲」"
            onChange={(e: ChangeEvent<HTMLInputElement>) => setLabel(e.target.value)}
            className="h-9 text-[12px] flex-1"
          />
          <Button
            className="bg-[#F0B90B] text-black hover:bg-[#F0B90B]/90 h-9 text-[12px]"
            disabled={whatIfRunning || !canRun || activeManualLegs.length === 0}
            onClick={runManualScenario}
          >
            {whatIfRunning ? '运行中…' : '运行分析'}
          </Button>
        </div>
      </div>
    </div>
  );
}
