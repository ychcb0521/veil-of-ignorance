export type CampaignMetricSeriesInput = {
  campaignId: string;
  title: string;
  symbol: string;
  value: number | null;
  operationTime: number | null;
};

export type CampaignMetricPoint = {
  campaignId: string;
  title: string;
  symbol: string;
  value: number;
  operationTime: number;
  sequence: number;
};

export type CampaignMetricSeries = {
  points: CampaignMetricPoint[];
  excludedMissingValueCount: number;
  excludedMissingOperationTimeCount: number;
};

export type CampaignMetricDomain = {
  min: number;
  max: number;
};

/**
 * Fit the vertical scale to the values that are actually visible. Keeping zero
 * outside an all-positive or all-negative series avoids flattening small moves.
 */
export function createCampaignMetricDomain(values: number[]): CampaignMetricDomain {
  const finiteValues = values.filter(Number.isFinite);
  if (finiteValues.length === 0) return { min: -1, max: 1 };

  const rawMin = Math.min(...finiteValues);
  const rawMax = Math.max(...finiteValues);
  if (rawMin === rawMax) {
    const padding = rawMin === 0 ? 1 : Math.max(Math.abs(rawMin) * 0.12, 0.01);
    return { min: rawMin - padding, max: rawMax + padding };
  }

  const padding = (rawMax - rawMin) * 0.12;
  return { min: rawMin - padding, max: rawMax + padding };
}

/**
 * Build a stable, objective-time series for a single campaign metric. Card sort
 * order is deliberately ignored so changing the list sort never moves points.
 */
export function buildCampaignMetricSeries(
  samples: CampaignMetricSeriesInput[],
): CampaignMetricSeries {
  let excludedMissingValueCount = 0;
  let excludedMissingOperationTimeCount = 0;

  const eligible = samples.flatMap(sample => {
    if (sample.value == null || !Number.isFinite(sample.value)) {
      excludedMissingValueCount += 1;
      return [];
    }
    if (sample.operationTime == null || !Number.isFinite(sample.operationTime)) {
      excludedMissingOperationTimeCount += 1;
      return [];
    }
    return [{ ...sample, value: sample.value, operationTime: sample.operationTime }];
  });

  eligible.sort((left, right) => (
    left.operationTime - right.operationTime
    || left.campaignId.localeCompare(right.campaignId)
  ));

  return {
    points: eligible.map((sample, index) => ({ ...sample, sequence: index + 1 })),
    excludedMissingValueCount,
    excludedMissingOperationTimeCount,
  };
}
