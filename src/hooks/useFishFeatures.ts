import { useMemo } from 'react';
import { useFeatureDefinitions } from './useFeatureDefinitions';
import { fishFeatureDefinitions } from '@/lib/fish/features';

export function useFishFeatures() {
  const defs = useFeatureDefinitions();
  return useMemo(() => fishFeatureDefinitions(defs), [defs]);
}
