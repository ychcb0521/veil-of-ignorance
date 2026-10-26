/**
 * 交易战役的板块。【用户要求】2026-10-26「比较卖出和比较探测没必要分开，合并到一起（包括交易战役那里），统一叫做卖出与探测（控制变量法）」。
 * 旧链接里的 section=sell / section=detect 一律落到合并后的板块。
 */
export const CAMPAIGN_SECTIONS = [{ id: 'personal', label: '亲自交易' }, { id: 'quality', label: '卖出与探测（控制变量法）' }] as const;
export type CampaignSection = typeof CAMPAIGN_SECTIONS[number]['id'];
export function campaignSection(search: string): CampaignSection {
  const value = new URLSearchParams(search).get('section');
  return value === 'quality' || value === 'sell' || value === 'detect' ? 'quality' : 'personal';
}
/** 战役编号仍按来源区分（固定卖出方案做探测的那场为 detect，其余为 sell），两种都能打开同一场。 */
export function qualityCampaignId(key: string, section: 'sell' | 'detect' = 'sell') { return `fish-${section}-${key}`; }
export const isQualityCampaignId = (id?: string) => /^fish-(sell|detect)-[\w-]+$/.test(id ?? '');
export function qualityCampaignPath(key: string, section: 'sell' | 'detect' = 'sell') { return `/journal/campaigns/${qualityCampaignId(key, section)}?section=quality`; }
