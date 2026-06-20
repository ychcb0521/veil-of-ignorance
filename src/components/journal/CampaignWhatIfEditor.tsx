import { useMemo } from 'react';
import { TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { buildActualSimulationParams, buildPureSopParams } from '@/lib/campaignSimulationEngine';
import type { KlineData } from '@/hooks/useBinanceData';
import type { TradeCampaign, TradeJournal } from '@/types/journal';

interface Props {
  campaign: TradeCampaign;
  legs: TradeJournal[];
  klines: KlineData[];
  klinesLoading: boolean;
  pureRunning: boolean;
  onRunPureSop: () => void;
}

export function CampaignWhatIfEditor({
  campaign,
  legs,
  klines,
  klinesLoading,
  pureRunning,
  onRunPureSop,
}: Props) {
  const actualDefaults = useMemo(() => buildActualSimulationParams(campaign, legs), [campaign, legs]);
  const sopDefaults = useMemo(() => buildPureSopParams(campaign, legs), [campaign, legs]);
  const baseDefaults = actualDefaults ?? sopDefaults;
  const canRun = !klinesLoading && klines.length > 0;

  if (!baseDefaults) {
    return (
      <div className="rounded border border-border bg-muted/40 px-4 py-4 text-[13px] text-muted-foreground">
        无法从该战役推断主力开仓数据，暂不能运行反事实模拟。
      </div>
    );
  }

  return (
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
  );
}
