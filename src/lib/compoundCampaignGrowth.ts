export interface CompoundCampaignGrowthSample {
  /** Realized P&L for one resolved campaign, in account currency. */
  realizedPnl: number | null | undefined;
  /** Account equity captured when the campaign's initial main position opened. */
  accountEquityAtEntry: number | null | undefined;
  /** False excludes the campaign from the effective sample. */
  eligible?: boolean;
  /** True when legacy data uses current account equity instead of an entry snapshot. */
  estimated?: boolean;
}

export interface CompoundCampaignGrowthSummary {
  /** Geometric mean of the realized per-campaign capital growth factors. */
  rate: number | null;
  /** Product of every included capital growth factor. */
  totalGrowthFactor: number | null;
  sampleCount: number;
  estimatedSampleCount: number;
  /** A campaign lost at least 100% of its entry account equity. */
  wipedOut: boolean;
}

/**
 * CAGR with campaign count replacing elapsed years:
 *   CGR_N = (Π(1 + realizedPnl_i / entryEquity_i))^(1/N) - 1
 *
 * Logarithms keep long histories numerically stable. A non-positive factor
 * represents capital being wiped out, so the compound rate is fixed at -100%.
 */
export function computeCompoundCampaignGrowth(
  samples: CompoundCampaignGrowthSample[],
): CompoundCampaignGrowthSummary {
  const included = samples.filter(sample => (
    sample.eligible !== false
    && typeof sample.realizedPnl === 'number'
    && Number.isFinite(sample.realizedPnl)
    && typeof sample.accountEquityAtEntry === 'number'
    && Number.isFinite(sample.accountEquityAtEntry)
    && sample.accountEquityAtEntry > 0
  ));

  if (included.length === 0) {
    return {
      rate: null,
      totalGrowthFactor: null,
      sampleCount: 0,
      estimatedSampleCount: 0,
      wipedOut: false,
    };
  }

  let logGrowthFactor = 0;
  let wipedOut = false;
  let estimatedSampleCount = 0;

  for (const sample of included) {
    if (sample.estimated) estimatedSampleCount += 1;
    const factor = 1 + (sample.realizedPnl as number) / (sample.accountEquityAtEntry as number);
    if (factor <= 0) {
      wipedOut = true;
      continue;
    }
    logGrowthFactor += Math.log(factor);
  }

  if (wipedOut) {
    return {
      rate: -1,
      totalGrowthFactor: 0,
      sampleCount: included.length,
      estimatedSampleCount,
      wipedOut: true,
    };
  }

  return {
    rate: Math.expm1(logGrowthFactor / included.length),
    totalGrowthFactor: Math.exp(logGrowthFactor),
    sampleCount: included.length,
    estimatedSampleCount,
    wipedOut: false,
  };
}

export function formatCompoundCampaignGrowthRate(rate: number | null): string {
  if (rate == null || !Number.isFinite(rate)) return '—';
  return `${rate > 0 ? '+' : ''}${(rate * 100).toFixed(2)}%/战役`;
}
