/**
 * Deep RSA · 第 2 步：从一场战役的完整数据算出分组要用的标签量与锚点。
 *
 * 不另写一套口径：盈亏比、L₀、理论 b 全部复用应用现有函数（buildCampaignCardData 及其依赖），
 * 与战役列表 / Excel 同一个数。区别只在于这里同时交出「这个数有多硬」的标记
 * （结算来源、是否全部结算、校正是否拉齐、多主力 L₀ 是否是下限），供分组判「待判定」。
 * 口径冻结：标签量随代码版本变化（2026-10-14 理论 G 刚改过），每次产出都写明 CODE_VERSION。
 */
import { buildCampaignCardData } from '@/lib/campaignListCache';
import { resolveMainRiskAnchors } from '@/lib/campaignAnalysis';
import { computeMagicB } from '@/lib/campaignGeometricMetrics';
import { campaignHasMainAdd } from '@/lib/campaignMainPriceChange';
import type { LegExitPriceCorrections } from '@/lib/campaignLegExecution';
import { BUILD_STAMP } from '@/lib/buildStamp';
import type { CampaignLabelInput, PayoffBasis } from '@/lib/deepRsa/grouping';

type CampaignDetails = Parameters<typeof buildCampaignCardData>[0];

/** 产出标签时的代码口径版本（构建标记）：分组结果必须连同它一起保存。 */
export const CODE_VERSION = BUILD_STAMP;

export type AnchorSource = 'B' | 'A' | 'D';

export interface CampaignAnchors {
  /** B（主口径）：最早一条成交过的 main_open 腿的 pre_simulated_time（live 腿 = 决策时刻；回填腿 = 成交开仓时刻）。 */
  B: number | null;
  /** A：库里的 trade_campaigns.opened_at（最早任意腿，可能是对冲或挂单；会被改写）。 */
  A: number | null;
  /** D：main_open 腿认领到的成交记录里最早的 openTime（缺 openTime 的记录不退回 closeTime）。 */
  D: number | null;
}

export interface CampaignLabelRecord {
  input: CampaignLabelInput;
  anchors: CampaignAnchors;
  /** 主口径锚点用的是哪一个（B 取不到时不自动换口径，记为 null）。 */
  anchorSource: AnchorSource | null;
  /** 神奇的 b（实际），仅供对照，不进分组。 */
  magicB: number | null;
  mainOpenCount: number;
  /** 多主力且有锚不出保护线的敞口：L₀ 是下限，盈亏比偏高。 */
  l0IsLowerBound: boolean;
  codeVersion: string;
}

function parseMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function minOrNull(values: (number | null)[]): number | null {
  const finite = values.filter((v): v is number => v != null && Number.isFinite(v));
  return finite.length ? Math.min(...finite) : null;
}

export function resolveCampaignAnchors(details: CampaignDetails, recordsByLeg: Map<string, { openTime: number }[]>): CampaignAnchors {
  const unfilled = new Set(details.unfilledOrderIds ?? []);
  const mainOpens = details.legs.filter(leg => leg.leg_role === 'main_open'
    && !(leg.trade_record_id && unfilled.has(leg.trade_record_id)));
  return {
    B: minOrNull(mainOpens.map(leg => parseMs(leg.pre_simulated_time))),
    A: parseMs(details.campaign.opened_at),
    D: minOrNull(mainOpens.flatMap(leg => (recordsByLeg.get(leg.id) ?? [])
      .map(record => (record.openTime > 0 ? record.openTime : null)))),
  };
}

/**
 * 一场战役 → 分组输入。corrections 是平仓价校正表；correctionsComplete 说明它是否拉齐
 * （离线复刻时由取 K 线的一方给出；不知道就传 null，分组会判「待判定」）。
 */
export function buildCampaignLabelRecord(
  details: CampaignDetails,
  corrections: LegExitPriceCorrections,
  correctionsComplete: boolean | null,
): CampaignLabelRecord {
  const card = buildCampaignCardData(details, corrections);
  const anchors = resolveCampaignAnchors(details, card.settlement.recordsByLeg);
  const theoreticalB = computeMagicB(card.effectivePriceChangePct, card.positionGeometricMultipleTheoretical);
  const risk = resolveMainRiskAnchors(details.campaign, details.legs, details.tradeRecords, details.reverseHedgeOrders);
  const mainOpenCount = details.legs.filter(leg => leg.leg_role === 'main_open').length;
  return {
    input: {
      campaignId: details.campaign.id,
      symbol: details.campaign.symbol,
      direction: details.campaign.direction,
      deleted: details.campaign.deleted_at != null,
      status: card.campaign.status,
      settled: card.settlement.settled,
      payoffBasis: card.settlement.basis as PayoffBasis,
      correctionsComplete,
      anchorMs: anchors.B,
      theoreticalB,
      theoreticalBApplicable: details.campaign.direction === 'main_long' && campaignHasMainAdd(details.legs),
      // 直接用 已实现 ÷ L₀：不走 profitCaptureRatio 的 ×100 / ÷100 往返（阈值恰为 3 时可能差 1 ulp），
      // 也不吃它「分子缺失记 0」的兜底——分子缺失就是 null（缺失不当作 0）
      payoffRatio: card.settlement.total != null && Number.isFinite(card.initialExpectedMaxLoss) && card.initialExpectedMaxLoss > 0
        ? card.settlement.total / card.initialExpectedMaxLoss
        : null,
      initialExpectedMaxLoss: card.initialExpectedMaxLoss,
    },
    anchors,
    anchorSource: anchors.B != null ? 'B' : null,
    magicB: card.magicB ?? null,
    mainOpenCount,
    l0IsLowerBound: mainOpenCount >= 2 && risk.unanchoredExposureNotional > 0,
    codeVersion: CODE_VERSION,
  };
}
