export type CampaignMetricSeriesInput = {
  campaignId: string;
  title: string;
  symbol: string;
  value: number | null;
  operationTime: number | null;
  /**
   * 战役已实现盈亏。与 value 相互独立：像「预期回撤」这类纯风险指标，
   * 数值本身不含盈亏方向，需要靠它把点染成盈利绿 / 亏损红。
   * null = 未结束或无数据。
   */
  pnl?: number | null;
  /**
   * 战役实际盈亏比 b = 已实现盈亏 ÷ 初始最大预期亏损。
   * 与 value 无关：像镜像止盈这种只有四个档位的指标，点上读不出赚亏了多少个 R，
   * 提示框里补一个 b 才能就地判断这一档到底值不值。null = 无有效 L。
   */
  payoffRatio?: number | null;
};

export type CampaignMetricPoint = {
  campaignId: string;
  title: string;
  symbol: string;
  value: number;
  operationTime: number;
  sequence: number;
  /** 战役已实现盈亏；null / undefined = 未结束或无数据。 */
  pnl?: number | null;
  /** 战役实际盈亏比 b；null / undefined = 无有效初始最大预期亏损。 */
  payoffRatio?: number | null;
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
