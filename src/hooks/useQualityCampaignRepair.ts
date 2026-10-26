import { useCallback, useEffect, useRef, useState } from 'react';
import { accountFeatureDefs } from '@/lib/featureSource';
import { FishScanner } from '@/lib/fishScanner';
import { loadQualityStudy, saveQualityStudy } from '@/lib/fish/qualityStore';
import { archiveQualityStudy } from '@/lib/fish/qualityCampaignArchive';
import { syncQualitySellDefinitions } from '@/lib/fish/qualityComparison';
import { applyQualityRepair, finishQualityRepair, prepareQualityRepair, type QualityRepairBatch } from '@/lib/fish/qualityRepair';
import { beginHistoryOnlyNotifications } from '@/lib/notificationCenter';
import type { FishQualityStudy } from '@/lib/fish/quality';

function announceRepair(owner: string) {
  window.dispatchEvent(new CustomEvent('fish-quality-repaired',{detail:{owner}}));
  if (typeof window.BroadcastChannel === 'function') {
    const channel = new window.BroadcastChannel('veil-quality-repair');
    channel.postMessage({owner}); channel.close();
  }
}
export function useQualityCampaignRepair(owner?: string) {
  const [batch,setBatch] = useState<QualityRepairBatch>(), [running,setRunning] = useState(false);
  const [error,setError] = useState(''), [symbol,setSymbol] = useState('');
  const control = useRef<AbortController>(), generation = useRef(0), scanner = useRef<FishScanner>();
  useEffect(() => {
    const epoch = ++generation.current; setBatch(undefined); setRunning(false); setError('');
    if (!owner) return;
    void loadQualityStudy(owner).then(value => { if (epoch === generation.current) setBatch(value.study.campaignRepair); });
    return () => { generation.current = epoch + 1; control.current?.abort(); };
  },[owner]);
  const start = useCallback(async () => {
    if (!owner || control.current) return;
    const epoch = generation.current, aborter = new AbortController(); control.current = aborter;
    setRunning(true); setError('');
    const execute = async () => {
      const loaded = await loadQualityStudy(owner);
      if (aborter.signal.aborted) return;
      const definitions = accountFeatureDefs();
      const prepared = prepareQualityRepair(syncQualitySellDefinitions(archiveQualityStudy(loaded.study),definitions),definitions,Date.now());
      let current: FishQualityStudy = prepared.study;
      const persist = async () => {
        // Another worker may advance `current` while this save is pending. Report
        // only this exact durable checkpoint, including the final complete state.
        const checkpoint = current;
        if (!await saveQualityStudy(owner,checkpoint,{repairOnly:true})) throw new Error('纠错结果未能保存到本机，已停止。原记录保留，请恢复存储后继续纠错。');
        if (epoch === generation.current) setBatch(checkpoint.campaignRepair);
        announceRepair(owner);
      };
      await persist();
      const release = beginHistoryOnlyNotifications();
      let paused = false;
      try {
        if (prepared.tasks.length) {
          scanner.current ??= new FishScanner();
          await scanner.current.repairQuality({tasks:prepared.tasks,signal:aborter.signal,onResult:async (task,result) => {
            if (aborter.signal.aborted) throw new DOMException('已暂停','AbortError');
            current = applyQualityRepair(current,prepared.batch.id,task,result,Date.now());
            if (epoch === generation.current) setSymbol(task.sample.source.symbol);
            try { await persist(); } catch (e) { aborter.abort(); throw e; }
          }});
        }
      } catch (e) { paused = true; if (!aborter.signal.aborted) { aborter.abort(); throw e; } }
      finally {
        release(); current = finishQualityRepair(current,prepared.batch.id,paused || aborter.signal.aborted,Date.now());
        await persist();
      }
    };
    try {
      if (navigator.locks?.request) {
        await navigator.locks.request(`veil-quality-repair:${owner}`,{ifAvailable:true},async lock => {
          if (!lock) throw new Error('另一个标签页正在纠错此账号，请在那个页面查看进度。');
          await execute();
        });
      } else await execute();
    } catch (e) { if (epoch === generation.current) setError(e instanceof Error ? e.message : '纠错失败'); }
    finally { if (control.current === aborter) control.current = undefined; if (epoch === generation.current) { setRunning(false); setSymbol(''); } }
  },[owner]);
  return { batch,running,error,symbol,start,pause:() => control.current?.abort() };
}
