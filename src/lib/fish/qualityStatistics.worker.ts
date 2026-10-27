import { qualityStatisticsEstimate, qualityStatisticsInference, type QualityInferenceMetric } from './qualityStatisticsMath';
import type { QualityStatisticSeries } from './qualityStatistics';

export interface QualityStatisticsJob { series: QualityStatisticSeries[]; referenceId: string; paired: boolean; metric: QualityInferenceMetric }
self.onmessage = ({ data }: MessageEvent<QualityStatisticsJob>) => {
  try {
    const focused = data.series.find(s => s.id === data.referenceId);
    self.postMessage({ estimate: qualityStatisticsEstimate(focused?.trades ?? []), results: qualityStatisticsInference(data.series, data.referenceId, data.paired, data.metric) });
  } catch {
    self.postMessage({ error: '统计计算未完成，请缩小筛选范围后重试。' });
  }
};
