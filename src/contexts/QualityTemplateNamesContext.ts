import {createContext,useContext} from 'react';
import type {qualityTemplateNames} from '@/lib/fish/qualityTemplateNames';
import type {TradeCampaign} from '@/types/journal';

type Names=ReturnType<typeof qualityTemplateNames>;
export const QualityTemplateNamesContext=createContext<{owner?:string;resolver:Names}|null>(null);

export function useQualityTemplateNames() {
  return useContext(QualityTemplateNamesContext)?.resolver;
}

export function useCampaignTemplateNames(campaign?:Pick<TradeCampaign,'user_id'>) {
  const context=useContext(QualityTemplateNamesContext);
  return !campaign||campaign.user_id===context?.owner?context?.resolver:undefined;
}
