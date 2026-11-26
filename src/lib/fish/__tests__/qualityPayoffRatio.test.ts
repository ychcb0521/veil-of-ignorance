// 【用户要求】2026-11-02 组合表「相对涨幅」后加「盈亏比」，与交易战役同口径：已实现净盈亏 ÷ L₀（初始仓位 × 静态回撤%）
import { expect, it } from 'vitest';
import { qualityPayoffRatio, qualityPayoffRatioText } from '../qualityPresentation';
import { qualityCampaignStaticRisk } from '../qualityCampaignRisk';
import { L0_DBL5, LIMITED_STATIC_DRAWDOWN_VETO_VERSION } from '../qualityVeto';
import type { QualityHoldingVeto } from '../qualityVeto';
const veto = (threshold: number, enabled = true): QualityHoldingVeto => ({ id: `s${threshold}`, label: '持仓过程静态最大回撤', kind: 'static-drawdown', direction: '>=', threshold, enabled } as QualityHoldingVeto);
const closed = (pnl: number) => ({ key: 'k', sampleId: 's', groupId: 'g', evaluatedAt: 0, status: 'closed' as const, pnl, initialNotional: 100 });
it('divides realized PnL by the initial risk from the tightest enabled static stop, in R', () => {
  expect(qualityPayoffRatio({ holdingVetoes: [veto(5), veto(8)] }, closed(28.21)).value).toBeCloseTo(5.642);
  expect(qualityPayoffRatioText(qualityPayoffRatio({ holdingVetoes: [veto(5)] }, closed(-5)).value)).toBe('-1.00R');
  expect(qualityPayoffRatioText(qualityPayoffRatio({ holdingVetoes: [veto(5)] }, closed(12.72)).value)).toBe('+2.54R');
  expect(qualityPayoffRatio({ holdingVetoes: [veto(5, false)] }, closed(10)).value).toBeNull();
  expect(qualityPayoffRatio({ holdingVetoes: [veto(5)] }, { ...closed(3), status: 'open' }).reason).toContain('持有中');
  expect(qualityPayoffRatioText(null)).toBe('—');
});
it('uses the same L₀ as the campaign page for monitored campaigns', () => {
  const risk = qualityCampaignStaticRisk({ initial_main_size_usdt: 100, comparison: { sellEvidence: { holdingVetoes: [veto(5)] }, holdingMetrics: { initialNotional: 100, entryPrice: 4 } } } as never);
  expect(risk?.loss).toBe(5); expect(qualityPayoffRatio({ holdingVetoes: [veto(5)] }, closed(10)).value).toBe(10 / risk!.loss);
});

it('uses the frozen opening DBL-5 seller distance for reported R even with a static veto',()=>{
 const plan={holdingVetoes:[veto(5)]};
 expect(qualityPayoffRatio(plan,{...closed(5.6),dbl5SellerRiskPctV1:2.8}).value).toBeCloseTo(2);
 expect(qualityPayoffRatio(plan,{...closed(5.6),dbl5SellerRiskPctV1:null}).value).toBeNull();
 expect(qualityCampaignStaticRisk({comparison:{monitorPlan:plan,sellEvidence:{dbl5SellerRiskPctV1:2.8,initialStaticStopPct:5},holdingMetrics:{initialNotional:100,entryPrice:100}}} as never)?.loss).toBeCloseTo(2.8);
});
it('prefers the opening limited static drawdown to the DBL-5 distance',()=>{
 const stop=5;
 const plan:{holdingVetoes:QualityHoldingVeto[]}={holdingVetoes:[{...veto(stop),limitedStaticVersion:LIMITED_STATIC_DRAWDOWN_VETO_VERSION}]};
 expect(qualityPayoffRatio(plan,{...closed(10),dbl5SellerRiskPctV1:2.8}).value).toBe(2);
 expect(qualityPayoffRatio(plan,{...closed(10),dbl5SellerRiskPctV1:null}).value).toBe(2);
 expect(qualityCampaignStaticRisk({comparison:{monitorPlan:plan,sellEvidence:{dbl5SellerRiskPctV1:2.8},holdingMetrics:{initialNotional:100,entryPrice:100}}} as never)?.loss).toBe(stop);
 const selected={...plan,payoffRiskVersion:L0_DBL5} as const;
 for(const risk of [2,null]){
   const result={...closed(10),selectedL0Pct:risk,dbl5SellerRiskPctV1:2.8};
   expect(qualityPayoffRatio(selected,result).value).toBe(risk===null?null:5);
   expect(qualityCampaignStaticRisk({comparison:{monitorPlan:selected,sellEvidence:{selectedL0Pct:risk,dbl5SellerRiskPctV1:2.8},holdingMetrics:{initialNotional:100,entryPrice:100}}} as never)?.loss).toBe(risk??undefined);
 }
});
