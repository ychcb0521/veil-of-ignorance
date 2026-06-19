import { type ChangeEvent, useEffect, useMemo, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ReplayKlineChart } from '@/components/journal/ReplayKlineChart';
import { type AnalysisDraggablePriceLine } from '@/components/CandlestickChart';
import { intervalToMs, type KlineData } from '@/hooks/useBinanceData';
import { buildPureSopParams } from '@/lib/campaignSimulationEngine';
import type { CampaignCounterfactualParams, TradeCampaign, TradeJournal } from '@/types/journal';

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

/** The three price-anchored legs the engine models (besides the dynamic rolling hedges). */
type PriceLegKey = 'hedge_a' | 'hedge_b' | 'mirror_tp';

const PRICE_LEGS: Array<{ key: PriceLegKey; label: string; color: string }> = [
  { key: 'hedge_a', label: '对冲 A', color: '#2B80FF' },
  { key: 'hedge_b', label: '对冲 B', color: '#5BA3FF' },
  { key: 'mirror_tp', label: '镜像止盈', color: '#F0B90B' },
];

function defaultOffset(key: PriceLegKey, isLong: boolean): number {
  if (key === 'mirror_tp') return isLong ? 2 : -2;
  if (key === 'hedge_b') return isLong ? -4 : 4;
  return isLong ? -2 : 2;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
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
  const sopDefaults = useMemo(() => buildPureSopParams(campaign, legs), [campaign, legs]);
  const [params, setParams] = useState<CampaignCounterfactualParams | null>(sopDefaults);
  const [label, setLabel] = useState('');

  // 战役/腿变化时，把编辑器重置回该战役的 SOP 默认（也是「一键运行」用的基线）。
  useEffect(() => {
    setParams(sopDefaults);
  }, [sopDefaults]);

  const entryPrice = params?.entry.price ?? 0;
  const isLong = params?.entry.direction !== 'short';
  const pricePrecision = useMemo(() => {
    if (entryPrice >= 100) return 2;
    if (entryPrice >= 1) return 4;
    if (entryPrice >= 0.1) return 6;
    return 8;
  }, [entryPrice]);

  const offsetToPrice = (offsetPct: number) => entryPrice * (1 + offsetPct / 100);
  const priceToOffset = (price: number) => (entryPrice > 0 ? round1((price / entryPrice - 1) * 100) : 0);

  const setPriceLeg = (key: PriceLegKey, patch: Partial<{ offset_pct: number; size_pct: number }>) => {
    setParams(prev => (prev ? { ...prev, [key]: { ...prev[key], ...patch } } : prev));
  };

  const togglePriceLeg = (key: PriceLegKey, enabled: boolean) => {
    setPriceLeg(key, enabled
      ? { size_pct: 50, offset_pct: params ? params[key].offset_pct || defaultOffset(key, isLong) : defaultOffset(key, isLong) }
      : { size_pct: 0 });
  };

  const setRolling = (patch: Partial<CampaignCounterfactualParams['rolling']>) => {
    setParams(prev => (prev ? { ...prev, rolling: { ...prev.rolling, ...patch } } : prev));
  };

  // 盘面可拖动的横线：仅渲染「已启用」（仓位 > 0）的价格腿；拖动结束→反算 offset。
  const draggableLines = useMemo<AnalysisDraggablePriceLine[]>(() => {
    if (!params || entryPrice <= 0) return [];
    return PRICE_LEGS
      .filter(leg => params[leg.key].size_pct > 0)
      .map(leg => ({
        id: leg.key,
        price: offsetToPrice(params[leg.key].offset_pct),
        color: leg.color,
        label: `${leg.label} ${offsetToPrice(params[leg.key].offset_pct).toFixed(pricePrecision)}`,
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, entryPrice, pricePrecision]);

  const handleDragLine = (id: string, price: number) => {
    if (PRICE_LEGS.some(leg => leg.key === id)) {
      setPriceLeg(id as PriceLegKey, { offset_pct: priceToOffset(price) });
    }
  };

  const chartCurrentTime = klines.length > 0
    ? klines[klines.length - 1].time + intervalToMs(interval)
    : Date.now();

  if (!params) {
    return (
      <div className="rounded border border-border bg-muted/40 px-4 py-4 text-[13px] text-muted-foreground">
        无法从该战役推断主力开仓数据，暂不能运行反事实模拟。
      </div>
    );
  }

  const canRun = !klinesLoading && klines.length > 0;

  return (
    <div className="space-y-4">
      {/* 一键运行：用冷静时的 SOP 默认参数跑一遍 */}
      <div className="bg-[#0ECB81]/5 border border-[#0ECB81]/30 rounded p-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-full bg-[#0ECB81]/15 flex items-center justify-center text-[#0ECB81]">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-[14px] font-medium">一键运行（标准 SOP）</div>
            <div className="text-[11px] text-muted-foreground">
              用标准 SOP 默认参数 + 这场战役实际的市场数据跑一遍，无需任何设置。
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

      {/* 自定义：基于 Legs 的对冲编辑 + 盘面拖动 */}
      <div className="bg-card border border-border rounded p-4 space-y-4">
        <div className="space-y-1">
          <div className="text-[14px] font-medium">自定义对冲方案</div>
          <div className="text-[11px] text-muted-foreground">
            改对冲/止盈的触发价（直接填数值，或在下方盘面拖动竖线）和仓位，再「运行分析」。主力开仓固定为这场战役的真实开仓。
          </div>
        </div>

        {/* 腿配置表 */}
        <div className="border border-border rounded overflow-hidden">
          <div className="grid grid-cols-[110px_1fr_1fr_1fr_84px] bg-muted/40 text-[10px] text-muted-foreground px-3 py-2">
            <div>角色</div>
            <div>触发价</div>
            <div>距开仓 %</div>
            <div>仓位 %</div>
            <div>操作</div>
          </div>

          {/* 主力开仓（只读） */}
          <div className="grid grid-cols-[110px_1fr_1fr_1fr_84px] items-center text-[11px] font-mono px-3 py-2 border-t border-border/40">
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center rounded bg-[#0ECB81]/15 text-[#0ECB81] px-1.5 py-0.5 text-[10px]">主力开仓</span>
            </div>
            <div>{entryPrice.toFixed(pricePrecision)}</div>
            <div className="text-muted-foreground">0.0</div>
            <div>100</div>
            <div className="text-muted-foreground text-[10px]">固定</div>
          </div>

          {/* 三条价格腿 */}
          {PRICE_LEGS.map(leg => {
            const enabled = params[leg.key].size_pct > 0;
            return (
              <div key={leg.key} className={`grid grid-cols-[110px_1fr_1fr_1fr_84px] items-center text-[11px] font-mono px-3 py-2 border-t border-border/40 ${enabled ? '' : 'opacity-50'}`}>
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: leg.color }} />
                  <span>{leg.label}</span>
                </div>
                {enabled ? (
                  <>
                    <Input
                      type="number"
                      value={Number(offsetToPrice(params[leg.key].offset_pct).toFixed(pricePrecision))}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => setPriceLeg(leg.key, { offset_pct: priceToOffset(Number(e.target.value)) })}
                      className="h-7 text-[11px]"
                    />
                    <Input
                      type="number"
                      value={params[leg.key].offset_pct}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => setPriceLeg(leg.key, { offset_pct: Number(e.target.value) })}
                      className="h-7 text-[11px]"
                    />
                    <Input
                      type="number"
                      value={params[leg.key].size_pct}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => setPriceLeg(leg.key, { size_pct: Number(e.target.value) })}
                      className="h-7 text-[11px]"
                    />
                  </>
                ) : (
                  <div className="col-span-3 text-[11px] text-muted-foreground">未启用</div>
                )}
                <div>
                  <button
                    type="button"
                    onClick={() => togglePriceLeg(leg.key, !enabled)}
                    className={`text-[10px] ${enabled ? 'text-muted-foreground hover:text-[#F6465D]' : 'text-[#0ECB81] hover:underline'}`}
                  >
                    {enabled ? '删除' : '+ 启用'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* 滚动对冲 */}
        <div className="border border-border rounded px-3 py-3 space-y-3">
          <div className="flex items-center justify-between text-[12px]">
            <div>
              <div className="font-medium">滚动对冲</div>
              <div className="text-[10px] text-muted-foreground">价格每涨一定幅度就自动补一条对冲（动态加仓）。</div>
            </div>
            <Switch checked={params.rolling.enabled} onCheckedChange={(checked: boolean) => setRolling({ enabled: checked })} />
          </div>
          {params.rolling.enabled && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <label className="space-y-1 text-[10px] text-muted-foreground">
                <span>每涨 % 触发</span>
                <Input type="number" value={params.rolling.trigger_rise_pct} onChange={(e: ChangeEvent<HTMLInputElement>) => setRolling({ trigger_rise_pct: Number(e.target.value) })} className="h-7 text-[11px]" />
              </label>
              <label className="space-y-1 text-[10px] text-muted-foreground">
                <span>最小间隔(分)</span>
                <Input type="number" value={params.rolling.min_interval_minutes} onChange={(e: ChangeEvent<HTMLInputElement>) => setRolling({ min_interval_minutes: Number(e.target.value) })} className="h-7 text-[11px]" />
              </label>
              <label className="space-y-1 text-[10px] text-muted-foreground">
                <span>新对冲距现价 %</span>
                <Input type="number" value={params.rolling.new_hedge_offset_pct} onChange={(e: ChangeEvent<HTMLInputElement>) => setRolling({ new_hedge_offset_pct: Number(e.target.value) })} className="h-7 text-[11px]" />
              </label>
              <label className="space-y-1 text-[10px] text-muted-foreground">
                <span>滚动对冲仓位 %</span>
                <Input type="number" value={params.rolling.rolling_hedge_size_pct} onChange={(e: ChangeEvent<HTMLInputElement>) => setRolling({ rolling_hedge_size_pct: Number(e.target.value) })} className="h-7 text-[11px]" />
              </label>
            </div>
          )}
        </div>

        {/* 出场规则 */}
        <div className="flex items-center gap-3 text-[12px]">
          <span className="text-muted-foreground">触发对冲后</span>
          <select
            value={params.exit_rule}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => {
              const exit_rule = e.target.value as CampaignCounterfactualParams['exit_rule'];
              setParams(prev => {
                if (!prev) return prev;
                // 选「平仓后重入」时补一份默认 reentry，否则引擎会因缺参数而不重入。
                if (exit_rule === 'reenter_after_hedge_trigger' && !prev.reentry) {
                  return { ...prev, exit_rule, reentry: { delay_minutes: 30, size_pct: 100 } };
                }
                return { ...prev, exit_rule };
              });
            }}
            className="h-8 rounded border border-border bg-background px-2 text-[11px]"
          >
            <option value="close_all_on_hedge_trigger">全部平仓</option>
            <option value="reenter_after_hedge_trigger">平仓后重入</option>
            <option value="manual_only">不自动处理</option>
          </select>
        </div>

        {/* 盘面：拖动竖线调整对冲位置 */}
        <div>
          <div className="text-[11px] text-muted-foreground mb-1">盘面（拖动彩色横线即可调整对应触发价）</div>
          <div className="h-[300px] border border-border rounded overflow-hidden">
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
                draggablePriceLines={draggableLines}
                onDragPriceLine={handleDragLine}
                timezone={timezone}
              />
            )}
          </div>
        </div>

        {/* 运行 */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            value={label}
            placeholder="给这个方案起个名，例如「对冲更宽」「不滚动」"
            onChange={(e: ChangeEvent<HTMLInputElement>) => setLabel(e.target.value)}
            className="h-9 text-[12px] flex-1"
          />
          <Button
            variant="outline"
            className="h-9 text-[12px]"
            onClick={() => setParams(sopDefaults)}
          >
            重置为标准 SOP
          </Button>
          <Button
            className="bg-[#F0B90B] text-black hover:bg-[#F0B90B]/90 h-9 text-[12px]"
            disabled={whatIfRunning || !canRun || !label.trim()}
            onClick={() => onRunWhatIf(label.trim(), params)}
          >
            {whatIfRunning ? '运行中…' : '运行分析'}
          </Button>
        </div>
      </div>
    </div>
  );
}
