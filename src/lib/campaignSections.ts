export const CAMPAIGN_SECTIONS = [{ id: 'personal', label: '亲自交易' }, { id: 'sell', label: '卖出比较' }, { id: 'detect', label: '探测比较' }] as const;
export type CampaignSection = typeof CAMPAIGN_SECTIONS[number]['id'];
export function campaignSection(search: string): CampaignSection {
  const value = new URLSearchParams(search).get('section');
  return value === 'sell' || value === 'detect' ? value : 'personal';
}
export function qualityCampaignId(key: string, section: 'sell' | 'detect' = 'sell') { return `fish-${section}-${key}`; }
export const isQualityCampaignId = (id?: string) => /^fish-(sell|detect)-[\w-]+$/.test(id ?? '');
export function qualityCampaignPath(key: string, section: 'sell' | 'detect' = 'sell') { return `/journal/campaigns/${qualityCampaignId(key, section)}?section=${section}`; }
