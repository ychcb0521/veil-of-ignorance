import { useEffect, useMemo, useRef } from 'react';
import { useTradingContext } from '@/contexts/TradingContext';
import { useAuth } from '@/contexts/AuthContext';
import { useScreenedInstantPositions } from '@/contexts/FishQualityContext';
import { laterInstantReplayEntry, latestOpenHolding, latestSimulationClose } from '@/lib/fish/latestScreenedReplaySymbol';
import { useLatestInstantReplay } from '@/hooks/useLatestInstantReplay';

export function useHoldingDefaultSymbol(onSelectDefaultReplaySymbol?: (symbol: string) => void) {
  const ctx = useTradingContext();
  const { user } = useAuth();
  const replayDateEdited = useRef(false);
  const instant = useScreenedInstantPositions();
  const openScreenedPositions = instant?.positions;
  const openBinanceCampaigns = instant?.usdtLive?.openCampaigns;
  const livePositions = instant?.usdtLive?.snapshot?.positions;
  const liveHistories = instant?.usdtLive?.histories;
  const recentArchive = useLatestInstantReplay(user?.id, !replayDateEdited.current);
  const currentHolding = useMemo(() => latestOpenHolding(ctx.positionsMap, openScreenedPositions, openBinanceCampaigns, livePositions, liveHistories),
    [ctx.positionsMap, openScreenedPositions, openBinanceCampaigns, livePositions, liveHistories]);
  const lastSimulation = useMemo(() => latestSimulationClose(ctx.tradeHistory), [ctx.tradeHistory]);
  const replaySymbol = currentHolding?.symbol ?? laterInstantReplayEntry(lastSimulation, recentArchive)?.symbol;
  useEffect(() => {
    if (replayDateEdited.current || !replaySymbol) return;
    onSelectDefaultReplaySymbol?.(replaySymbol);
  }, [replaySymbol, onSelectDefaultReplaySymbol]);
  return replayDateEdited;
}
