/**
 * 【用户要求】2026-11-03 组合表下载里「比较重要的是当时组合算法的详细信息，以及买入、加仓、卖出信息」：
 * - 「组合算法」：每套方案一段，逐项写出卖出、组合切换、镜像、硬性终止、加仓（每一次的方向 / 否决 / 位置 / 卖出）与版本；
 * - 「买入·加仓·卖出」：选中的每条信号 × 每套方案一行，写明买入、镜像止盈、每次加仓、卖出及原因与各项结果。
 */
import { QUALITY_ADVANTAGE_EXPLANATION, qualityAdvantageFingerprint } from './qualityAdvantage';
import type { XlsxCell, XlsxSheet } from '@/lib/xlsxWorkbook';
import type { QualityGroup, QualityResult, QualitySample } from './quality';
import { qualityRuleText } from './quality';
import { mirrorLabel } from './qualityMirror';
import { activeHoldingVetoes, holdingVetoLabel } from './qualityVeto';
import { activeDetectorPrerequisite, additionLabel, qualityAdditionFills, qualityAdditionPrerequisites } from './qualityAddition';
import { structureAdditionLabel } from './qualityAdditionStructure';
import { activeAdditionVetoes, additionVetoLabel } from './qualityAdditionVeto';
import { qualitySellStagesLabel } from './qualitySellStages';
import { qualityVetoStagesLabel } from './qualityVetoStages';
import { qualityPlanVersions } from './qualityPlanVersions';
import { qualityGeometricPosition, qualityPayoffRatio, qualityRelativeGain } from './qualityPresentation';
import { hasPreBoxAdditionShape, isLegacyQualityPlan, LEGACY_ENGINE_LABEL } from './qualityLegacyEngine';
import type { QualityAdditionRoundRule } from './qualityAddition';

const time = (t?: number | null) => t ? new Date(t + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ') : '';
const price = (x?: number | null) => x != null && Number.isFinite(x) ? +x.toPrecision(8) : null;
const round = (x?: number | null, d = 2) => x != null && Number.isFinite(x) ? +x.toFixed(d) : null;

/** 「组合算法」：方案 · 部分 · 项目 · 设置 · 版本。 */
export function qualityPlanDetailSheet(plans: readonly QualityGroup[]): XlsxSheet {
  const rows: XlsxCell[][] = [];
  const add = (plan: QualityGroup, part: string, item: string, value: string, version = '') => rows.push([plan.label, part, item, value, version]);
  for (const plan of plans) {
    const versions = new Map(qualityPlanVersions(plan).map(v => [v.key, v]));
    if(plan.advantage){
      add(plan,'优势筛选与退出灵敏度','开关与参数',JSON.stringify({screenWeak:plan.advantage.screenWeak,beforeFirst:plan.advantage.beforeFirst,afterAddition:plan.advantage.afterAddition,confirmations:plan.advantage.confirmations}),plan.advantage.version+' #'+qualityAdvantageFingerprint(plan));
      QUALITY_ADVANTAGE_EXPLANATION.forEach((text,i)=>add(plan,'优势筛选与退出灵敏度','规则与依据 '+(i+1),text));
    }
    // 【用户要求】2026-11-04 10-31 旧方案（旧引擎或旧形态）：入场距离存在 entryBufferAtr、涨幅门槛相对持仓均价
    const legacy = isLegacyQualityPlan(plan) || hasPreBoxAdditionShape(plan);
    if (legacy) add(plan, '计算引擎', '引擎', isLegacyQualityPlan(plan) ? `${LEGACY_ENGINE_LABEL}（冻结，与原战役逐位一致）` : '10-31 时的方案形态（指标＋入场距离）', versions.get('engine')?.version ?? '');
    const entryDistance = (r: QualityAdditionRoundRule) => legacy ? r.entryBufferAtr ?? 2 : r.entryDistanceAtr;
    const position = (r: QualityAdditionRoundRule) => r.structure ? structureAdditionLabel(r.structure)
      : r.source === 'custom' ? (() => { const t = (r.conditions?.length ? r.conditions : r.condition ? [r.condition] : [])[0], d = entryDistance(r);
        return `指标 · S / T / K：${t ? `${t.label} ${t.direction} ${t.threshold}` : '未设加仓条件'}${d != null ? ` · 入场距离 T ≥ S＋${d}×ATR` : ' · 不查入场距离'} · K＝T−${r.supportOffsetAtr ?? 1.5}×ATR（S＝成本线：首次加仓为首次买入价，之后为上一次的 K）`; })()
      : '—';
    const gainText = (r: QualityAdditionRoundRule) => `${legacy || r.gainBasis === 'average' ? '相对持仓均价' : '相对最新成本线 S'} 上涨 ≥ ${r.minGainPct}%`;
    add(plan, '卖出', '卖出算法', qualityRuleText(plan), versions.get('sell')?.version ?? '');
    if (plan.combo) add(plan, '卖出', '组合切换', `涨幅 ≥ ${plan.combo.switchPct}% 后改用 ${plan.combo.after.label} ${plan.combo.after.rule.direction} ${plan.combo.after.rule.threshold}`, versions.get('combo')?.version ?? '');
    add(plan, '卖出', '执行方式', plan.execution === 'intrabar-1m' ? '盘中达标 · 1 分钟复原' : '5 分钟收盘确认', versions.get('execution')?.version ?? '');
    add(plan, '镜像', '半仓镜像', mirrorLabel(plan.mirrorTakeProfit) || '未启用', versions.get('mirror')?.version ?? '');
    const stops = activeHoldingVetoes(plan.holdingVetoes);
    add(plan, '硬性终止', '条件', stops.length ? stops.map(v => holdingVetoLabel(v)).join('；') : '未启用', versions.get('hard-stop')?.version ?? '');
    const a = plan.addition;
    if (!a?.enabled) add(plan, '加仓', '条件加仓', '未启用');
    else {
      add(plan, '加仓', '总设置', additionLabel(a), versions.get('addition')?.version ?? '');
      if (a.supportReduction?.enabled) add(plan, '加仓', '支撑线下移减仓', `下移 ≥ ${a.supportReduction.minDropAtr} ATR · 单次最多减 ${a.supportReduction.maxPct}%${a.supportReduction.exitAfterDrops != null ? ` · K 连续下移 ${a.supportReduction.exitAfterDrops} 次全仓卖出` : ''}`);
      if (a.breakevenFloor?.enabled) add(plan, '加仓', '保本底线', `F＝防守线 K − ${a.breakevenFloor.atr}×ATR：盘中碰到即按 F 卖出全部持仓，加仓量按 F 算`);
      if (a.geometricLock?.enabled) add(plan, '加仓', '保住有效涨幅', `几何仓位 > ${a.geometricLock.multiple} 时止损上移到 Kₘ＋${a.geometricLock.pct}%×首次开仓价，盘中碰线卖出全部持仓`);
      (a.rounds?.length ? a.rounds : [a]).forEach((r, i) => {
        const n = `第 ${i + 1} 次加仓`, dp = activeDetectorPrerequisite(r);
        const direction = [...qualityAdditionPrerequisites(r).map(f => `${f.label} ${f.direction} ${f.threshold}`), ...(dp ? [`${dp.featureId ?? '原探测算法（全部）'} 探测值比原门槛提高 ≥ ${dp.stricterPct}%`] : []), ...(r.minGainPct != null ? [gainText(r)] : []), ...(r.indicatorIncrease ? [r.indicatorIncrease.metrics.map(f=>f.label).join('、') + '均高于上次成交时读数'] : [])];
        add(plan, n, '方向', direction.length ? direction.join(' 且 ') : '无');
        const vetoes = activeAdditionVetoes(r.entryVetoes);
        add(plan, n, '否决', vetoes.length ? vetoes.map(additionVetoLabel).join('；') : '无');
        add(plan, n, '位置', position(r), versions.get(`box-${i + 1}`)?.version ?? versions.get(`trigger-${i + 1}`)?.version ?? '');
        const stage = plan.vetoStages?.find(s => s.afterAdditions === i + 1), sell = plan.sellStages?.find(s => s.afterAdditions === i + 1);
        add(plan, n, '卖出', ['碰到 K 卖出全部持仓', ...(stage ? [`否决：${stage.conditions.filter(c => c.enabled).map(c => holdingVetoLabel(c)).join(' 或 ')}`] : []), ...(sell ? [`改用 ${sell.label} ${sell.rule.direction} ${sell.rule.threshold}`] : [])].join('；'));
      });
    }
    if (plan.vetoStages?.length) add(plan, '加仓后切换', '否决条件', qualityVetoStagesLabel(plan), versions.get('veto-stages')?.version ?? '');
    if (plan.sellStages?.length) add(plan, '加仓后切换', '卖出算法', qualitySellStagesLabel(plan), versions.get('sell-stages')?.version ?? '');
    for (const v of qualityPlanVersions(plan)) add(plan, '版本清单', `${v.part} · ${v.name}`, v.summary, v.version);
  }
  return { name: '组合算法', columns: [{ header: '方案', width: 18 }, { header: '部分', width: 16 }, { header: '项目', width: 30 }, { header: '设置', width: 80 }, { header: '版本', width: 40 }], rows };
}

/** 「买入·加仓·卖出」：每条信号 × 每套方案一行。resultOf 取该行该方案当前显示的那份结果。 */
export function qualityTradeDetailSheet(members: readonly QualitySample[], plans: readonly QualityGroup[], resultOf: (row: QualitySample, plan: QualityGroup) => QualityResult | undefined): XlsxSheet {
  const rows: XlsxCell[][] = [];
  for (const row of members) for (const plan of plans) {
    const r = resultOf(row, plan), fills = qualityAdditionFills(r ?? {}), m = r?.mirrorFill;
    rows.push([row.source.symbol, time(row.source.timeMs), plan.label, r?.status ?? '未运行',
      time(r?.entryTime), price(r?.entryPrice),
      m ? time(m.at) : '', m ? price(m.price) : null, m ? round(m.fraction * 100) : null,
      fills.length, fills.map((a, i) => `第${i + 1}次 ${time(a.at)} T ${price(a.price)} K ${price(a.sizing?.support)} 买入 ${round(a.notional)} U`).join('；'),
      round(r?.totalInvested), time(r?.endTime), price(r?.endPrice), r?.reason ?? '',
      round(r?.pnl, 4), round(r?.returnPct), round(qualityPayoffRatio(plan, r).value), round(qualityRelativeGain(plan, r).value), round(qualityGeometricPosition(r)),
      round(r?.peakPct), round(r?.drawdownPct), round(r?.heldHours)]);
  }
  const headers = ['标的', '信号时间', '方案', '状态', '买入时间', '买入价', '镜像止盈时间', '镜像止盈价', '镜像卖出 %', '加仓次数', '各次加仓', '累计投入 USDT', '卖出 / 估值时间', '卖出 / 估值价', '卖出原因', '盈亏 USDT', '收益率 %', '盈亏比 R', '相对涨幅 %', '几何仓位 ×', '峰值涨幅 %', '动态最大回撤 %', '持仓小时'];
  return { name: '买入·加仓·卖出', columns: headers.map(header => ({ header, width: header === '各次加仓' || header === '卖出原因' ? 60 : Math.max(10, header.length * 2 + 4) })), rows };
}
