/**
 * 新鱼邮件提醒的设置与发送（设置跟账号同步；发送结果显示在「渔」的邮件设置里）。
 * 【用户要求】2026-10-21「我希望捕捉到的新鱼能够及时发送到我的邮箱，并且邮箱地址数量可以添加」。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TradeSignal } from '@/lib/signalLibrary';
import { subscribePersistedStateHydration } from '@/lib/persistedStateStorage';
import { getUserPrefix } from '@/lib/userStoragePrefix';
import { composeFishEmail, markFishNotified, readFishNotify, saveFishNotify, sendFishEmail, unnotifiedFish, type FishNotifyConfig } from '@/lib/fish/notify';

export interface FishNotifyStatus { at: number; ok: boolean; count: number; test?: boolean; error?: string }
export interface FishNotify {
  config: FishNotifyConfig; status: FishNotifyStatus | null; sending: boolean;
  update: (next: FishNotifyConfig) => void; send: (fish: readonly TradeSignal[]) => Promise<void>; test: () => Promise<void>;
}
export function useFishNotify(account: string | undefined, request?: typeof fetch): FishNotify {
  const [config, setConfig] = useState<FishNotifyConfig>(readFishNotify);
  const [status, setStatus] = useState<FishNotifyStatus | null>(null);
  const [sending, setSending] = useState(false);
  const configRef = useRef(config); configRef.current = config;
  useEffect(() => {
    const refresh = () => { const next = readFishNotify(); configRef.current = next; setConfig(next); };
    refresh(); setStatus(null);
    return subscribePersistedStateHydration(`${getUserPrefix()}fish_notify_v1`, refresh);
  }, [account]);
  const update = useCallback((next: FishNotifyConfig) => { saveFishNotify(next); const saved = readFishNotify(); configRef.current = saved; setConfig(saved); }, []);
  const deliver = useCallback(async (fish: readonly TradeSignal[], test: boolean) => {
    const c = configRef.current, content = composeFishEmail(fish);
    if (test) { content.subject = `【渔】测试邮件 · ${content.subject.replace('【渔】', '')}`; }
    setSending(true);
    try { await sendFishEmail(c, content, request); if (!test) markFishNotified(fish); setStatus({ at: Date.now(), ok: true, count: fish.length, test }); }
    catch (e) { setStatus({ at: Date.now(), ok: false, count: fish.length, test, error: e instanceof TypeError ? '网络不通或被浏览器拦截' : e instanceof Error ? e.message : String(e) }); }
    finally { setSending(false); }
  }, [request]);
  // 只发没提醒过的；发送失败不记，下次捕到再试
  const send = useCallback(async (fish: readonly TradeSignal[]) => { if (!configRef.current.enabled) return; const pending = unnotifiedFish(fish); if (pending.length) await deliver(pending, false); }, [deliver]);
  const test = useCallback(() => deliver([{ id: 'test', symbol: 'TESTUSDT', timeMs: Date.now(), timeLabel: '', fallbackZone: '', fish: { average: 0, cbi2: 0, startAverage: 0, previousAverage: 0, cutoffMs: Date.now(), threshold: 0, featureShort: '示例' } }], true), [deliver]);
  return { config, status, sending, update, send, test };
}
