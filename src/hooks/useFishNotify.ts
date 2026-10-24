/**
 * 新鱼邮件提醒的设置与发送（设置跟账号同步；发送结果显示在「渔」的邮件设置里）。
 * 【用户要求】2026-10-21「我希望捕捉到的新鱼能够及时发送到我的邮箱，并且邮箱地址数量可以添加」。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TradeSignal } from '@/lib/signalLibrary';
import { subscribePersistedStateHydration } from '@/lib/persistedStateStorage';
import { getUserPrefix } from '@/lib/userStoragePrefix';
import { fishVisibleKey } from '@/lib/fish/records';
import { composeFishEmail, fishTableChange, readFishNotify, saveFishNotify, saveLastFishTable, sendFishEmail, type FishNotifyConfig } from '@/lib/fish/notify';

/** unchanged = 这一轮结束时新鱼和上一封一样，没发。 */
export interface FishNotifyStatus { at: number; ok: boolean; count: number; test?: boolean; error?: string; unchanged?: boolean }
export interface FishNotify {
  config: FishNotifyConfig; status: FishNotifyStatus | null; sending: boolean;
  update: (next: FishNotifyConfig) => void;
  /** 每轮结束调用：fish = 这一轮第一次捕到的；fresh = 邮件那张表（默认本轮并集）。和上一封不一样就发整张表，多出来的标「新」。 */
  send: (fish: readonly TradeSignal[], fresh?: readonly TradeSignal[]) => Promise<void>; test: () => Promise<void>;
}
/** getFresh：当前「新鱼」列表，测试邮件照它发一份（没有新鱼时发示例）。 */
export function useFishNotify(account: string | undefined, request?: typeof fetch, getFresh?: () => readonly TradeSignal[]): FishNotify {
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
  const deliver = useCallback(async (fish: readonly TradeSignal[], test: boolean, newKeys?: ReadonlySet<string>, onSent?: () => void) => {
    const c = configRef.current, content = composeFishEmail(fish, Date.now(), newKeys);
    if (test) { content.subject = `测试邮件 · ${content.subject}`; }
    setSending(true);
    try { await sendFishEmail(c, content, request); onSent?.(); setStatus({ at: Date.now(), ok: true, count: fish.length, test }); }
    catch (e) { setStatus({ at: Date.now(), ok: false, count: fish.length, test, error: e instanceof TypeError ? '网络不通或被浏览器拦截' : e instanceof Error ? e.message : String(e) }); }
    finally { setSending(false); }
  }, [request]);
  // 只发没提醒过的；发送失败不记，下次捕到再试
  // 【用户要求】2026-10-21「我希望邮件的内容是这个新鱼的截图」「新鱼只要有更新，都发一次邮件，无论是手动还是自动模式」
  // 发的是整张新鱼表；和上一封一样就不发；发送失败不记，下一轮再比
  const send = useCallback(async (fish: readonly TradeSignal[], fresh?: readonly TradeSignal[]) => {
    if (!configRef.current.enabled) return;
    const list = fresh ?? [], table = [...list, ...fish.filter(s => !list.some(f => fishVisibleKey(f) === fishVisibleKey(s)))];
    const change = fishTableChange(table);
    if (!change.changed) { if (table.length) setStatus({ at: Date.now(), ok: true, count: table.length, unchanged: true }); return; }
    await deliver(table, false, change.added, () => saveLastFishTable(change.keys));
  }, [deliver]);
  const test = useCallback(() => { const fresh = getFresh?.() ?? []; return fresh.length ? deliver(fresh, true) : deliver([{ id: 'test', symbol: 'TESTUSDT', timeMs: Date.now(), timeLabel: '', fallbackZone: '', fish: { average: 0, cbi2: 0, startAverage: 0, previousAverage: 0, cutoffMs: Date.now(), threshold: 0, featureShort: '示例' } }], true); }, [deliver, getFresh]);
  return { config, status, sending, update, send, test };
}
