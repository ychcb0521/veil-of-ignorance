import { buildCampaignMetricSeries } from '@/lib/campaignMetricSeries';

export type CampaignOddsSeriesInput = {
  campaignId: string;
  title: string;
  symbol: string;
  odds: number | null;
  operationTime: number | null;
};

export type CampaignOddsPoint = {
  campaignId: string;
  title: string;
  symbol: string;
  odds: number;
  operationTime: number;
  sequence: number;
};

export type CampaignOddsSeries = {
  points: CampaignOddsPoint[];
  excludedMissingOddsCount: number;
  excludedMissingOperationTimeCount: number;
};

/**
 * Build a stable, objective-time series. The incoming list order is intentionally
 * ignored so changing the campaign-card sort never moves the scatter points.
 */
export function buildCampaignOddsSeries(samples: CampaignOddsSeriesInput[]): CampaignOddsSeries {
  const series = buildCampaignMetricSeries(samples.map(sample => ({
    campaignId: sample.campaignId,
    title: sample.title,
    symbol: sample.symbol,
    value: sample.odds,
    operationTime: sample.operationTime,
  })));

  return {
    points: series.points.map(point => ({
      campaignId: point.campaignId,
      title: point.title,
      symbol: point.symbol,
      odds: point.value,
      operationTime: point.operationTime,
      sequence: point.sequence,
    })),
    excludedMissingOddsCount: series.excludedMissingValueCount,
    excludedMissingOperationTimeCount: series.excludedMissingOperationTimeCount,
  };
}
