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
  let excludedMissingOddsCount = 0;
  let excludedMissingOperationTimeCount = 0;

  const eligible = samples.flatMap(sample => {
    if (sample.odds == null || !Number.isFinite(sample.odds)) {
      excludedMissingOddsCount += 1;
      return [];
    }
    if (sample.operationTime == null || !Number.isFinite(sample.operationTime)) {
      excludedMissingOperationTimeCount += 1;
      return [];
    }
    return [{ ...sample, odds: sample.odds, operationTime: sample.operationTime }];
  });

  eligible.sort((left, right) => (
    left.operationTime - right.operationTime
    || left.campaignId.localeCompare(right.campaignId)
  ));

  return {
    points: eligible.map((sample, index) => ({ ...sample, sequence: index + 1 })),
    excludedMissingOddsCount,
    excludedMissingOperationTimeCount,
  };
}
