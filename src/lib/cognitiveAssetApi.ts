import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import {
  DEFAULT_COGNITIVE_ASSET_CONTENT,
  DEFAULT_COGNITIVE_ASSET_TITLE,
} from '@/lib/defaultCognitiveAsset';

export type CognitiveAsset = Database['public']['Tables']['cognitive_assets']['Row'];

function toCognitiveAsset(row: unknown): CognitiveAsset {
  return row as CognitiveAsset;
}

async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    throw new Error(`读取当前用户失败：${error.message}`);
  }
  const userId = data.user?.id;
  if (!userId) {
    throw new Error('用户未登录');
  }
  return userId;
}

async function createDefaultAsset(userId: string): Promise<CognitiveAsset> {
  const { data, error } = await supabase
    .from('cognitive_assets' as never)
    .insert({
      user_id: userId,
      title: DEFAULT_COGNITIVE_ASSET_TITLE,
      content: DEFAULT_COGNITIVE_ASSET_CONTENT,
    } as never)
    .select()
    .single();

  if (error) {
    throw new Error(`创建默认认知资产失败：${error.message}`);
  }

  return toCognitiveAsset(data);
}

async function hydrateEmptyAsset(asset: CognitiveAsset): Promise<CognitiveAsset> {
  const nextTitle = asset.title.trim() || DEFAULT_COGNITIVE_ASSET_TITLE;
  const nextContent = asset.content.trim() || DEFAULT_COGNITIVE_ASSET_CONTENT;
  const { data, error } = await supabase
    .from('cognitive_assets' as never)
    .update({
      title: nextTitle,
      content: nextContent,
    } as never)
    .eq('id', asset.id)
    .select()
    .single();

  if (error) {
    throw new Error(`补写默认认知资产失败：${error.message}`);
  }

  return toCognitiveAsset(data);
}

export async function getOrCreateCognitiveAsset(): Promise<CognitiveAsset> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from('cognitive_assets' as never)
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`读取认知资产失败：${error.message}`);
  }

  if (data) {
    const asset = toCognitiveAsset(data);
    if (!asset.content.trim() || !asset.title.trim()) {
      return hydrateEmptyAsset(asset);
    }
    return asset;
  }

  return createDefaultAsset(userId);
}

export async function updateCognitiveAsset(content: string, title?: string): Promise<CognitiveAsset> {
  const nextContent = content.trim();
  if (!nextContent) {
    throw new Error('认知资产内容不能为空');
  }

  const current = await getOrCreateCognitiveAsset();
  const { data, error } = await supabase
    .from('cognitive_assets' as never)
    .update({
      content: nextContent,
      title: title?.trim() || current.title,
    } as never)
    .eq('id', current.id)
    .select()
    .single();

  if (error) {
    throw new Error(`保存认知资产失败：${error.message}`);
  }

  return toCognitiveAsset(data);
}

export async function resetCognitiveAssetToDefault(): Promise<CognitiveAsset> {
  const current = await getOrCreateCognitiveAsset();
  const { data, error } = await supabase
    .from('cognitive_assets' as never)
    .update({
      title: DEFAULT_COGNITIVE_ASSET_TITLE,
      content: DEFAULT_COGNITIVE_ASSET_CONTENT,
    } as never)
    .eq('id', current.id)
    .select()
    .single();

  if (error) {
    throw new Error(`恢复默认模板失败：${error.message}`);
  }

  return toCognitiveAsset(data);
}
