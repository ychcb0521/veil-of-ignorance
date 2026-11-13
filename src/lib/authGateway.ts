/** Keep the SDK's backend URL/storage key intact; route only auth HTTP traffic. */
export const AUTH_BACKEND_ORIGIN='https://elynuzxnvjzypjgzkemc.supabase.co';
export const INSTANT_CAMPAIGN_HEADER = 'x-veil-instant-campaign';
export function instantCampaignGatewayUrl(url: string, siteOrigin?: string): string | null {
  if (!siteOrigin) return null;
  const target = new URL(url), site = new URL(siteOrigin);
  if (!authGatewayUrl(target.origin + '/auth/v1/user', siteOrigin) || target.pathname !== '/rest/v1/user_sim_state') return null;
  return site.origin + '/instant-campaign-api' + target.search;
}
export function authGatewayUrl(url:string,siteOrigin?:string):string|null {
 if(!siteOrigin)return null;
 const target=new URL(url),site=new URL(siteOrigin);
 const hosted=site.hostname==='veil-of-ignorance-ten.vercel.app'||site.hostname.startsWith('veil-of-ignorance-')&&site.hostname.endsWith('.vercel.app');
 if(site.protocol!=='https:'||!hosted||target.origin!==AUTH_BACKEND_ORIGIN||!target.pathname.startsWith('/auth/v1/'))return null;
 return site.origin+'/auth-api'+target.pathname.slice('/auth/v1'.length)+target.search;
}
export function productionAuthOrigin():string|undefined {
 return import.meta.env.PROD&&typeof window!=='undefined'?window.location.origin:undefined;
}
