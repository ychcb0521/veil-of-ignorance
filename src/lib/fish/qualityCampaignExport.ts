/**
 * 【用户要求】2026-11-04「持仓监测产生的交易战役的『持仓监测』点开之后，也可以导出详细信息。
 * 导出的这份文件用于跨币种的适配性分析和泛化应用」。
 *
 * 一场战役一个 Excel：概要、组合算法、加仓逐次、未加仓与否决、减仓、交易事件、方案参数（原文）。
 * 跨币种可比：价格距离一律另给「ATR 倍数」与「占价格 %」两种口径（不同币价位、波动差几个数量级，只看绝对价格没法比）。
 * 只读战役里冻结的证据（运行当时的结果与方案），不重新计算，导出的就是这场战役当时的样子。
 */
import type { CampaignEvent, TradeCampaign } from '@/types/journal';
import type { QualityAdditionFill } from './qualityAddition';
import { buildXlsx, type XlsxCell, type XlsxSheet } from '@/lib/xlsxWorkbook';
import { qualityPlanDetailSheet } from './qualityExportDetails';

const time = (t?: number | string | null) => {
  const ms = typeof t === 'string' ? Date.parse(t) : t;
  return ms && Number.isFinite(ms) ? new Date(ms + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ') : '';
};
const ms = (t?: string | null) => t ? Date.parse(t) : NaN;
const p8 = (x?: number | null) => x != null && Number.isFinite(x) ? +x.toPrecision(8) : null;
const r = (x?: number | null, d = 2) => x != null && Number.isFinite(x) ? +x.toFixed(d) : null;
const pct = (a?: number | null, b?: number | null) => a != null && b ? r((a / b - 1) * 100, 4) : null;
const hours = (a?: number, b?: number) => a != null && b != null && Number.isFinite(a) && Number.isFinite(b) ? r((b - a) / 3600000, 2) : null;
const sheet = (name: string, headers: readonly string[], rows: XlsxCell[][], wide: readonly string[] = []): XlsxSheet =>
  ({ name, columns: headers.map(header => ({ header, width: wide.includes(header) ? 60 : Math.max(10, header.length * 2 + 4) })), rows });

const EVENT_LABELS: Partial<Record<CampaignEvent['event_type'], string>> = {
  main_opened: '买入', main_partial_closed: '部分卖出', main_fully_closed: '全部卖出',
};

/** 把方案逐字段展开成「路径 · 值」：可原样搬到别的币种上复现，也方便程序读取。 */
export function flattenPlan(value: unknown, path = ''): [string, XlsxCell][] {
  if (value == null || typeof value !== 'object') return [[path || '(值)', typeof value === 'boolean' ? String(value) : value as XlsxCell]];
  if (Array.isArray(value)) return value.length ? value.flatMap((v, i) => flattenPlan(v, `${path}[${i}]`)) : [[path, '[]']];
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
  return entries.length ? entries.flatMap(([k, v]) => flattenPlan(v, path ? `${path}.${k}` : k)) : [[path, '{}']];
}

function additionRows(fills: readonly QualityAdditionFill[], entryPrice?: number, entryAt?: number): XlsxCell[][] {
  let invested = 0;
  return fills.map((f, i) => {
    const z = f.sizing, T = f.price, S = z?.previousSupport, K = z?.support, atr = z?.atr;
    invested += f.notional;
    const ev = f.structureEvidence;
    return [i + 1, time(f.at), hours(entryAt, f.at), p8(T), pct(T, entryPrice),
      p8(S), p8(K), p8(atr), atr && T ? r(atr / T * 100, 4) : null,
      atr && S != null ? r((T - S) / atr, 4) : null, atr && K != null ? r((T - K) / atr, 4) : null, K != null ? r((1 - K / T) * 100, 4) : null,
      z?.requiredBufferAtr ?? null, z?.supportOffsetAtr ?? null,
      ev ? `${ev.algorithm === 'dbl5' ? 'DBL-5' : 'SBS-5M'} · 支撑 C ${p8(ev.supportPrice)} · K 基准 ${p8(ev.basePrice)}${z?.guardK != null ? ` · 防守线 ${p8(z.guardK)}` : ''}` : '指标 · S / T / K',
      p8(f.quantity), r(f.notional, 4), r(invested, 4), p8(z?.coinsBefore), p8(z?.realAverageBefore), r(z?.mirrorAvailableBefore, 4), r(z?.mirrorUsed, 4),
      f.priceGate ? `${f.priceGate.basis === 'real-average' ? '相对持仓均价' : '相对成本线 S'} ${p8(f.priceGate.referencePrice)}：涨 ${r(f.priceGate.gainPct)}%（要求 ≥ ${f.priceGate.thresholdPct}%）` : '',
      f.label ? `${f.label} ${f.direction} ${f.threshold}（读数 ${p8(f.reading)}）` : '',
      (f.conditions ?? []).map(c => `${c.label} ${c.direction} ${c.threshold}（读数 ${p8(c.reading)}）`).join('；')];
  });
}

export function qualityCampaignSheets(campaign: TradeCampaign): XlsxSheet[] {
  const c = campaign.comparison, ev = c?.sellEvidence, plan = c?.monitorPlan, m = c?.holdingMetrics;
  const fills = ev?.additionFills ?? (ev?.additionFill ? [ev.additionFill] : []);
  const events = campaign.actual_evolution ?? [];
  const entryAt = ms(campaign.opened_at), endAt = ms(campaign.closed_at), entryPrice = m?.entryPrice ?? events.find(e => e.event_type === 'main_opened')?.price ?? undefined;
  const exit = [...events].reverse().find(e => e.event_type === 'main_fully_closed'), exitPrice = exit?.price ?? undefined, mirror = ev?.mirrorFill;
  const firstAtr = fills[0]?.sizing?.atr;
  const signalLine = (campaign.notes ?? '').split('\n')[0];

  const summary: XlsxCell[][] = [
    ['标的', campaign.symbol, ''], ['方案', plan?.label ?? c?.planLabel ?? '', ''], ['战役编号', campaign.campaign_code, ''],
    ['信号', signalLine, '来源 · 信号时间（UTC）'], ['探测算法', (c?.detectors ?? []).map(d => d.label).join('；'), ''], ['信号类别', c?.category ?? '', ''],
    ['买入时间', time(entryAt), 'UTC+8'], ['买入价', p8(entryPrice), ''], ['首仓 USDT', campaign.initial_main_size_usdt, ''],
    ['镜像止盈', mirror ? `${time(mirror.at)} @ ${p8(mirror.price)} · 卖出 ${r(mirror.fraction * 100)}% · 涨 ${r(mirror.gainPct)}%` : '未成交', ''],
    ['加仓次数', fills.length, ''], ['累计投入 USDT', r(ev?.totalInvested ?? m?.totalInvested, 4), ''], ['持仓均价', p8(ev?.averageEntryPrice), ''],
    ['卖出时间', time(endAt), 'UTC+8'], ['卖出价', p8(exitPrice), ''], ['卖出原因', ev?.exitReason ?? '', ''],
    ['触发条件', ev?.triggerCause ? `${ev.triggerCause.label ?? ''}${ev.triggerCause.direction ? ` ${ev.triggerCause.direction} ${ev.triggerCause.threshold}` : ''}` : '', ''],
    ['已实现盈亏 USDT', r(campaign.final_realized_pnl, 4), ''], ['收益率 %', r(m?.returnPct, 4), '总盈亏 ÷ 累计投入'],
    ['卖出价相对买入价 %', pct(exitPrice, entryPrice), '跨币种可比'], ['峰值涨幅 %', r(m?.peakPct, 4), '持仓期间最高价相对买入价'],
    ['持仓时长 小时', hours(entryAt, endAt), ''], ['首次加仓时 ATR 占价格 %', firstAtr && fills[0] ? r(firstAtr / fills[0].price * 100, 4) : null, '5 分钟 ATR(14)，衡量这个币的波动；跨币种比较距离时先除以它'],
    ['导出时间', time(Date.now()), 'UTC+8'],
  ];
  const sheets: XlsxSheet[] = [{ name: '概要', columns: [{ header: '项目', width: 22 }, { header: '数值', width: 60 }, { header: '说明', width: 44 }], rows: summary }];
  if (plan) sheets.push(qualityPlanDetailSheet([plan]));
  sheets.push(sheet('加仓逐次', ['次', '时间', '距买入 小时', '加仓价 T', 'T 相对买入价 %', '成本线 S', 'K', 'ATR', 'ATR 占价格 %', 'T−S（ATR）', 'T−K（ATR）', 'T−K（%）', '要求入场距离 ATR', 'K＝T−m ATR 的 m', '位置',
    '新增币数', '加仓金额 USDT', '累计加仓金额 USDT', '加仓前币数 Q', '加仓前持仓均价', '可用落袋利润 P', '用掉落袋利润', '涨幅门槛', '加仓条件读数', '同时满足的条件'],
    additionRows(fills, entryPrice, entryAt), ['位置', '涨幅门槛', '加仓条件读数', '同时满足的条件']));
  sheets.push(sheet('未加仓与否决', ['时间', '第几次加仓', '类型', '原因', '读数', '支撑 C'],
    [...(ev?.additionSkips ?? []).map(s => ({ ...s, type: '未加仓' })), ...(ev?.additionVetoes ?? []).map(v => ({ ...v, type: '否决', support: undefined }))]
      .sort((a, b) => a.at - b.at).map(s => [time(s.at), s.round, s.type, s.label, s.reading, p8(s.support)]), ['读数']));
  sheets.push(sheet('减仓', ['时间', '价格', '减仓比例 %', '减仓币数', '实现盈亏 USDT', '原 K', '新 K', '原支撑', '新支撑', 'ATR'],
    (ev?.additionReductions ?? []).map(x => [time(x.at), p8(x.price), r(x.fraction * 100, 4), p8(x.quantity), r(x.realizedPnl, 4), p8(x.previousK), p8(x.newK), p8(x.previousSupport), p8(x.newSupport), p8(x.atr)])));
  sheets.push(sheet('交易事件', ['时间', '事件', '价格', '金额 USDT', '实现盈亏 USDT', '备注'],
    events.map(e => [time(e.timestamp), EVENT_LABELS[e.event_type] ?? e.event_type, p8(e.price), r(e.size_usdt, 4), r(e.realized_pnl, 4), e.notes ?? '']), ['备注']));
  if (plan) sheets.push({ name: '方案参数（原文）', columns: [{ header: '字段路径', width: 60 }, { header: '值', width: 80 }], rows: flattenPlan(plan) });
  return sheets;
}

export function qualityCampaignExportName(campaign: TradeCampaign, at = Date.now()) {
  const label = (campaign.comparison?.monitorPlan?.label ?? campaign.comparison?.planLabel ?? '持仓监测').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
  return `持仓监测-${campaign.symbol}-${label}-${time(ms(campaign.opened_at)).replace(/\D/g, '').slice(0, 12)}-导出${time(at).replace(/\D/g, '').slice(0, 12)}.xlsx`;
}
export function downloadQualityCampaignDetail(campaign: TradeCampaign, at = Date.now()): string {
  const filename = qualityCampaignExportName(campaign, at);
  const url = URL.createObjectURL(buildXlsx(qualityCampaignSheets(campaign))), link = document.createElement('a');
  try { link.href = url; link.download = filename; document.body.appendChild(link); link.click(); }
  finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
  return filename;
}
