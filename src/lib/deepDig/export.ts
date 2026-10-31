import { mbi2KeysOf } from '@/lib/mbi2';
import { featureTemplateId, featureUsesMbi, featureUsesMbi2, featureParams } from '@/lib/deepDig/features';
import { formulaVariables } from './features';
import { DEEP_DIG_GROUPS, describeGroup, fmtValue, groupLabel, type DeepDigData } from './analysis';
import { formatSeriesOffset } from './series';

const cell = (value: unknown) => {
  const text = value == null || (typeof value === 'number' && !Number.isFinite(value)) ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** Raw doubles, never display-rounded values. Includes every named formula output. */
export function deepDigCsv(data: DeepDigData): string {
  const { names } = formulaVariables(data.definition.formula);
  const columns = [...new Set(featureUsesMbi2(data.definition)?[...mbi2KeysOf(data.definition),...names]:names)];
  const params = featureUsesMbi2(data.definition)?['MBI2_T_HOURS','MBI2_N','MBI2_Z0','MBI2_BAND','MBI2_CONFIRM']:featureUsesMbi(data.definition) ? ['MBI_N', 'MBI_Z0'] : [];
  const values=featureUsesMbi2(data.definition)?featureParams(data.definition):data.definition;
  const prsColumns=featureTemplateId(data.definition)==='prs6h'?['PRS6H_state','PRS6H_market_ready','PRS6H_config_hash','PRS6H_reasons','PRS6H_details','PRS6H_checkpoint']:[];
  const atiColumns=featureTemplateId(data.definition)==='ati6h'?['ATI6H_shortboard','ATI6H_data_status','ATI6H_reason_codes','ATI6H_volume_mode','ATI6H_version','ATI6H_structure_id','ATI6H_structure_status','ATI6H_nearest_resistance_type','ATI6H_breakout_cross_now','ATI6H_parameters','ATI6H_details','ATI6H_archive','ATI6H_dependency']:[];
  const rows: unknown[][] = [['事件ID', '标的', '锚点UTC', '取样偏移小时', '分组', '结果原值', ...columns, '24h期末收益', '24h最大涨幅', '24h最大跌幅', ...params,...prsColumns,...atiColumns]];
  for (const row of data.rows) rows.push([
    row.id, row.symbol, new Date(row.anchorMs).toISOString(), (data.sampleOffsetMs ?? 0) / 3600000, groupLabel(row.group, data.definition.source), row.v,
    ...columns.map(name => row.vars?.[name]), row.endRet, row.maxUp, row.maxDown,
    ...params.map(name => (values as Record<string,unknown>)[name]),
    ...prsColumns.map(name=>{const value=name==='PRS6H_details'?row.PRS6H_details:name==='PRS6H_checkpoint'?row.PRS6H_checkpoint:row.PRS6H_details?.[name as keyof typeof row.PRS6H_details];return typeof value==='object'?JSON.stringify(value):value;}),
    ...atiColumns.map(name=>{const value=name==='ATI6H_details'?row.ATI6H_details:name==='ATI6H_archive'?row.ATI6H_archive:name==='ATI6H_dependency'?data.definition.ATI6H_dependency:row.ATI6H_details?.[name];return typeof value==='object'?JSON.stringify(value):value;}),
  ]);
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n');
}

/** A compact image report shares exactly the same group summaries as the UI. */
export function deepDigImageRows(data: DeepDigData) {
  const core = data.definition.chartCore ?? 'MBI';
  const names = featureUsesMbi2(data.definition)?[...mbi2KeysOf(data.definition)]:featureUsesMbi(data.definition) ? [core, 'avg_' + core + '_2'] : [formulaVariables(data.definition.formula).result];
  return names.flatMap(name => DEEP_DIG_GROUPS.map(group => {
    const values = data.rows.filter(r => r.group === group).map(r => (featureUsesMbi(data.definition)||featureUsesMbi2(data.definition)) ? r.vars?.[name] : r.v).filter((v): v is number => v != null && Number.isFinite(v));
    return { name, ...describeGroup(group, values) };
  }));
}

export async function downloadDeepDigPng(data: DeepDigData): Promise<void> {
  await document.fonts?.ready;
  const rows = deepDigImageRows(data), width = 1060, height = 258 + rows.length * 38;
  const canvas = document.createElement('canvas'); canvas.width = width * 2; canvas.height = height * 2;
  const ctx = canvas.getContext('2d'); if (!ctx) throw Error('无法创建统计图片');
  ctx.scale(2, 2); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height);
  const text = (value: string, x: number, y: number, color = '#667085', size = 13) => {
    ctx.fillStyle = color; ctx.font = `${size}px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`; ctx.fillText(value, x, y);
  };
  text('无知之幕 · Deep Dig', 36, 38, '#b98700', 13);
  text(data.definition.name, 36, 76, '#17212f', 24);
  text(`描述统计 · ${formatSeriesOffset(data.sampleOffsetMs ?? 0)} · ${data.rows.length} 个样本`, 36, 104);
  text(`实验组：${data.definition.positive}`, 36, 133); text(`对照组：${data.definition.control}`, 36, 155);
  if (featureUsesMbi(data.definition)) text(`MBI_N = ${data.definition.MBI_N ?? 25} · MBI_Z0 = ${data.definition.MBI_Z0 ?? 1.25} · 预热值为空`, 36, 180);
  const columns = [36, 245, 415, 510, 635, 765, 895];
  ['变量', '分组', 'n', '均值', '标准差', '中位数', '> 0 占比'].forEach((label, i) => text(label, columns[i], 215));
  rows.forEach((row, i) => {
    const y = 244 + i * 38;
    ctx.fillStyle = i % 2 ? '#f7f8fa' : '#ffffff'; ctx.fillRect(30, y - 20, 1000, 36);
    const color = row.mean == null ? '#667085' : row.mean > 0 ? '#0b9f66' : row.mean < 0 ? '#f6465d' : '#667085';
    [row.name, groupLabel(row.group, data.definition.source), String(row.n), fmtValue(data.definition, row.mean), fmtValue(data.definition, row.sd), fmtValue(data.definition, row.median), row.sharePositive == null ? '—' : `${(100 * row.sharePositive).toFixed(2)}%`]
      .forEach((value, k) => text(value, columns[k], y, k === 3 ? color : '#344054'));
  });
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(Error('统计图片生成失败')), 'image/png'));
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = `deep-dig-${data.definition.id}.png`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadDeepDigCsv(data: DeepDigData): void {
  const url = URL.createObjectURL(new Blob([deepDigCsv(data)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `deep-dig-${data.definition.id}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
