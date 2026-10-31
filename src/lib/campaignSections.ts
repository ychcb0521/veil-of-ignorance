/**
 * 交易战役的两个板块：亲自交易、持仓监测。
 * 持仓监测沿用 quality 标识；旧链接 section=sell / section=detect 继续打开同一板块。
 */
export const CAMPAIGN_SECTIONS = [{ id: 'personal', label: '亲自交易' }, { id: 'quality', label: '持仓监测' }] as const;
export type CampaignSection = typeof CAMPAIGN_SECTIONS[number]['id'];
export function campaignSection(search: string): CampaignSection {
  const value = new URLSearchParams(search).get('section');
  return value === 'quality' || value === 'sell' || value === 'detect' ? 'quality' : 'personal';
}
/** 战役编号仍按来源区分（固定卖出方案做探测的那场为 detect，其余为 sell），两种都能打开同一场。 */
export function qualityCampaignId(key: string, section: 'sell' | 'detect' = 'sell') { return `fish-${section}-${key}`; }
export const isQualityCampaignId = (id?: string) => /^fish-(sell|detect)-[\w-]+$/.test(id ?? '');
export function qualityCampaignPath(key: string, section: 'sell' | 'detect' = 'sell') { return `/journal/campaigns/${qualityCampaignId(key, section)}?section=quality`; }
