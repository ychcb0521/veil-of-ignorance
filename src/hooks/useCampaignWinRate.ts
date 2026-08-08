/**
 * 当前账号的交易战役整体胜率。
 *
 * 口径与「下注规模」处一致（estimateCampaignSizingStats）：在全部已了结战役里，
 * 盈利战役所占比例；样本不足 MIN_CAMPAIGN_WINRATE_SAMPLES 时返回 null，不给虚数。
 * 只拉一次战役列表（单表查询，不逐场取腿与成交），供 P_gap 等仪表做默认值。
 */
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { listAllCampaigns } from '@/lib/journalApi';
import { estimateCampaignSizingStats, isResolvedCampaign } from '@/lib/kellySizing';

export interface CampaignWinRate {
  /** 0–1 的小数；样本不足或未登录时为 null。 */
  winRate: number | null;
  /** 已了结战役数量，用于展示样本量。 */
  resolvedCount: number;
}

export function useCampaignWinRate(): CampaignWinRate {
  const { user } = useAuth();
  const [state, setState] = useState<CampaignWinRate>({ winRate: null, resolvedCount: 0 });

  useEffect(() => {
    if (!user) {
      setState({ winRate: null, resolvedCount: 0 });
      return;
    }
    let cancelled = false;
    listAllCampaigns(user.id)
      .then(campaigns => {
        if (cancelled) return;
        setState({
          winRate: estimateCampaignSizingStats(campaigns).winRate,
          resolvedCount: campaigns.filter(isResolvedCampaign).length,
        });
      })
      .catch(() => {
        if (!cancelled) setState({ winRate: null, resolvedCount: 0 });
      });
    return () => { cancelled = true; };
  }, [user]);

  return state;
}
