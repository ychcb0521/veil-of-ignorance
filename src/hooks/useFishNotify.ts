/**
 * 新鱼邮件提醒的设置与发送（设置跟账号同步；发送结果显示在「渔」的邮件设置里）。
 * 【用户要求】2026-10-21「我希望捕捉到的新鱼能够及时发送到我的邮箱，并且邮箱地址数量可以添加」。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TradeSignal } from '@/lib/signalLibrary';
import { subscribePersistedStateHydration } from '@/lib/persistedStateStorage';
import { getUserPrefix } from '@/lib/userStoragePrefix';
import { fishVisibleCatchKey } from '@/lib/fish/records';
import { composeFishEmail, composeScreenedFishEmail, fishEmailMatches, fishEmailSourceLabel, fishTableChange, readFishNotify, saveFishNotify, saveLastFishTable, sendFishEmail, type FishNotifyConfig } from '@/lib/fish/notify';
import type { PreEntryRecord, PreEntryRound } from '@/lib/fish/preEntryMonitor';
import type { ScreenedCdaTrigger } from '@/lib/fish/screenedCda';

/** unchanged = 这一轮结束时新鱼和上一封一样，没发；skipped = 本轮有新鱼但没有一条共振，没发（count 为新鱼条数）。 */
export interface FishNotifyStatus { at: number; ok: boolean; count: number; test?: boolean; error?: string; unchanged?: boolean; skipped?: boolean }
export interface FishNotify {
  config: FishNotifyConfig; status: FishNotifyStatus | null; sending: boolean;
  screening?: boolean;
  update: (next: FishNotifyConfig) => void;
  /** 每轮结束调用：fish = 这一轮第一次捕到的；fresh = 邮件那张表（默认本轮并集）。和上一封不一样就发整张表，多出来的标「新」。 */
  send: (fish: readonly TradeSignal[], fresh?: readonly TradeSignal[]) => Promise<void>; test: () => Promise<void>;
}
/** getFresh：当前「新鱼」列表，测试邮件照它发一份（没有新鱼时发示例）。 */
export function useFishNotify(account: string | undefined, request?: typeof fetch, getFresh?: () => readonly TradeSignal[], screening = false) {
  const [config, setConfig] = useState<FishNotifyConfig>(readFishNotify);
  const [status, setStatus] = useState<FishNotifyStatus | null>(null);
  const [sending, setSending] = useState(false);
  const deliveries = useRef(0);
  const configRef = useRef(config); configRef.current = config;
  useEffect(() => {
    const refresh = () => { const next = readFishNotify(); configRef.current = next; setConfig(next); };
    refresh(); setStatus(null);
    return subscribePersistedStateHydration(`${getUserPrefix()}fish_notify_v1`, refresh);
  }, [account]);
  const update = useCallback((next: FishNotifyConfig) => { saveFishNotify(next); const saved = readFishNotify(); configRef.current = saved; setConfig(saved); }, []);
  const deliverContent = useCallback(async (content: ReturnType<typeof composeFishEmail>, c: FishNotifyConfig, test: boolean,
    delivery?: { onRecipient: (recipient: string) => void | Promise<void>; signal: AbortSignal }) => {
    if (test) { content.subject = `测试邮件 · ${content.subject}`; }
    deliveries.current++;
    setSending(true);
    try {
      await sendFishEmail(c, content, request, delivery);
      if (!delivery?.signal.aborted) setStatus({ at: Date.now(), ok: true, count: content.count, test });
      return true;
    } catch (e) {
      if (!delivery?.signal.aborted) setStatus({ at: Date.now(), ok: false, count: content.count, test, error: e instanceof TypeError ? '网络不通或被浏览器拦截' : e instanceof Error ? e.message : String(e) });
      return false;
    } finally {
      if (--deliveries.current === 0) setSending(false);
    }
  }, [request]);
  const deliver = useCallback(async (fish: readonly TradeSignal[], test: boolean, newKeys?: ReadonlySet<string>, onSent?: () => void) => {
    const c = configRef.current;
    if (await deliverContent(composeFishEmail(fish, Date.now(), newKeys, fishEmailSourceLabel(c)), c, test)) onSent?.();
  }, [deliverContent]);
  // 只发没提醒过的；发送失败不记，下次捕到再试
  // 【用户要求】2026-10-21「我希望邮件的内容是这个新鱼的截图」「新鱼只要有更新，都发一次邮件，无论是手动还是自动模式」
  // 发的是整张新鱼表；和上一封一样就不发；发送失败不记，下一轮再比
  const send = useCallback(async (fish: readonly TradeSignal[], fresh?: readonly TradeSignal[]) => {
    if (!configRef.current.enabled) return;
    const list = fresh ?? [], all = [...list, ...fish.filter(s => !list.some(f => fishVisibleCatchKey(f) === fishVisibleCatchKey(s)))];
    // 使用账号保存的来源；空选择也不发，不改上一封的记录。手动和自动捕捞共用此入口。
    const table = all.filter(signal => fishEmailMatches(signal, configRef.current));
    if (!table.length) { if (all.length) setStatus({ at: Date.now(), ok: true, count: all.length, skipped: true }); return; }
    const change = fishTableChange(table);
    if (!change.changed) { if (table.length) setStatus({ at: Date.now(), ok: true, count: table.length, unchanged: true }); return; }
    await deliver(table, false, change.added, () => saveLastFishTable(change.keys));
  }, [deliver]);
  const sendAdmission = useCallback((record: PreEntryRecord, round: PreEntryRound, recipients: string[], delivery: {
    onRecipient: (recipient: string) => void | Promise<void>; signal: AbortSignal;
  }) => {
    if (record.status !== 'matched' || !record.matchedAt || !configRef.current.enabled || !recipients.length) return Promise.resolve(false);
    return deliverContent(composeScreenedFishEmail(record, round), { ...configRef.current, emails: recipients }, false, delivery);
  }, [deliverContent]);
  const sendCdaAlert = useCallback((record: PreEntryRecord, round: PreEntryRound, trigger: ScreenedCdaTrigger, recipients: string[], delivery: {
    onRecipient: (recipient: string) => void | Promise<void>; signal: AbortSignal;
  }) => {
    if (record.status !== 'matched' || !record.matchedAt || !configRef.current.enabled || !recipients.length || !Number.isFinite(trigger.at) || !Number.isFinite(trigger.value)) return Promise.resolve(false);
    return deliverContent(composeScreenedFishEmail(record, round, trigger), { ...configRef.current, emails: recipients }, false, delivery);
  }, [deliverContent]);
  const test = useCallback(async () => {
    const now = Date.now(), source = { id: 'test', symbol: 'TESTUSDT', timeMs: now, timeLabel: '', fallbackZone: '' };
    if (screening) {
      await deliverContent(composeScreenedFishEmail({
        sample: { id: source.id, source, groups: [], enteredAt: now, basis: 'signal', importedAt: now }, matchedAt: now,
      }), configRef.current, true);
      return;
    }
    const fresh = (getFresh?.() ?? []).filter(signal => fishEmailMatches(signal, configRef.current));
    await deliver(fresh.length ? fresh : [{ ...source, fish: { average: 0, cbi2: 0, startAverage: 0, previousAverage: 0, cutoffMs: now, threshold: 0, featureShort: '示例' } }], true);
  }, [deliver, deliverContent, getFresh, screening]);
  return { config, status, sending, update, send, test, sendAdmission, sendCdaAlert, screening };
}
