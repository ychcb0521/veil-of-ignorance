import type { CampaignBoardExportSections } from '@/lib/campaignLegsPngExport';
import type { CampaignChartInterval } from '@/lib/campaignChartContentSpan';
import type { CampaignPerformanceSummary } from '@/lib/kellySizing';
import type { AsymmetricRiskMetricsSummary } from '@/lib/asymmetricRiskMetrics';
import type { getCampaignFullData, UserLocalSnapshot } from '@/lib/journalApi';
import type { DecisionEmotionDiary } from '@/types/emotionDiary';

export type CampaignBatchAccountMetrics = {
  performance: CampaignPerformanceSummary;
  asymmetricRisk: AsymmetricRiskMetricsSummary;
  /**
   * 重读一次仍读不出的账户战役（标题）：样本按其余场次汇总，图里「盈亏概览」下注明。
   * 一场坏数据不能让整批每一张图都失败——详情页本身也是略过读不出的样本照常显示。
   */
  missingSampleTitles?: string[];
  /**
   * 同一批读不出的战役 id。某场自己就在里面（当时读不出、后来重试读出来了）时，这份样本不能用在它自己的图上：
   * 图会写「样本缺本场」、占比的分母也不含它自己，与详情页对不上。
   */
  missingSampleIds?: string[];
  /** 汇总实际用到的样本场数。 */
  sampleCount?: number;
};

/** 一批导出独占一份缓存：账户数据不会带进下一批导出或另一个登录账号。 */
export type CampaignBatchExportSnapshot = {
  exportedAt: string;
  currentAccountEquity: number | null;
  accountMetrics: Map<string, Promise<CampaignBatchAccountMetrics>>;
  effectiveTimes: Map<string, number>;
  localSnapshots: Map<string, UserLocalSnapshot>;
  campaignData: Map<string, Promise<Awaited<ReturnType<typeof getCampaignFullData>>>>;
  /** 操作日情绪日记：按账户一批只读一次整份（只读，不回写本机镜像、不推云端同步）。 */
  emotionDiaries: Map<string, Promise<DecisionEmotionDiary[]>>;
};

export function createCampaignBatchExportSnapshot(input: {
  exportedAt: string;
  currentAccountEquity: number | null;
}): CampaignBatchExportSnapshot {
  return {
    ...input,
    accountMetrics: new Map(), effectiveTimes: new Map(), localSnapshots: new Map(), campaignData: new Map(), emotionDiaries: new Map(),
  };
}

/** 一场战役的导出结果。 */
export type CampaignBatchExportResult = {
  blob: Blob;
  fileName: string;
  /** 勾了 K 线盘面、但交易所没有这段 K 线：图里改画这段说明。 */
  chartOmitted?: string;
  /**
   * 没勾 K 线盘面、画了盈亏概览，而交易所没有这段 K 线：「峰值浮盈」按已实现盈亏兜底的说明（图里写在盈亏概览下）。
   * 弹窗据此与 chartOmitted 一样在队列里标「无 K 线」、进度区报场数。
   */
  peakFallback?: string;
  /** 盘面实际用的 K 线周期（画了盘面才有）；指定周期对这一场过细而放宽时，与所选的不同。 */
  chartInterval?: CampaignChartInterval;
  /** 账户样本有读不出的战役时的说明（与图里「盈亏概览」下的注明同一句）。 */
  sampleNote?: string;
};

export type CampaignBatchExportWorkerProps = {
  campaignId: string;
  userId: string;
  options: {
    interval: 'auto' | CampaignChartInterval;
    sections: CampaignBoardExportSections;
  };
  snapshot: CampaignBatchExportSnapshot;
  onComplete: (result: CampaignBatchExportResult) => void;
  onError: (error: Error) => void;
};
