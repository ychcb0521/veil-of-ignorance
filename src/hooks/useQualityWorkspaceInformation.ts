import { useCallback, useEffect, useRef, useState } from 'react';
import type { FishQualityStudy } from '@/lib/fish/quality';
import { importQualityWorkspaceInformation, readQualityWorkspace, updateQualityWorkspace } from '@/lib/fish/qualityWorkspaceStore';

/** A small working table can be used while the historical research archive stays unopened. */
export function useQualityWorkspaceInformation(owner: string | undefined, enabled: boolean) {
  const [value,setValue] = useState<{owner?:string;study:FishQualityStudy}>();
  const current = useRef(value); current.current = value;
  const account = useRef(owner); account.current = owner;
  const revision = useRef(0);
  const publish = useCallback((savedOwner: string | undefined, study: FishQualityStudy) => {
    if (account.current !== savedOwner) return false;
    current.current = {owner:savedOwner,study}; setValue(current.current); return true;
  },[]);
  useEffect(() => {
    if (!enabled) return;
    let active = true; const attempt = ++revision.current;
    void readQualityWorkspace(owner).then(study => {
      if (active && attempt === revision.current && study) publish(owner,study);
    }).catch(() => { /* An explicit import retries storage and reports any failure. */ });
    return () => { active = false; };
  },[owner,enabled,publish]);
  const importRows = useCallback(async (snapshot: FishQualityStudy, ids: readonly string[], fallback?: FishQualityStudy) => {
    const savedOwner = account.current; ++revision.current;
    const study = await importQualityWorkspaceInformation(savedOwner,snapshot,ids,fallback);
    return publish(savedOwner,study) ? study : undefined;
  },[publish]);
  const change = useCallback((apply: (study:FishQualityStudy)=>FishQualityStudy) => {
    const savedOwner = account.current, previous = current.current;
    if (!previous || previous.owner !== savedOwner) return;
    const next = {...apply(previous.study),workspaceUpdatedAt:Math.max(Date.now(),(previous.study.workspaceUpdatedAt ?? 0)+1)};
    ++revision.current; publish(savedOwner,next);
    void updateQualityWorkspace(savedOwner,apply,previous.study).catch(() => {});
  },[publish]);
  return {study:value?.owner===owner?value?.study:undefined,current,importRows,change};
}
