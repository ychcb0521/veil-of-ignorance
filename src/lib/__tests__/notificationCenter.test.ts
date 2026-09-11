// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sonnerMock = vi.hoisted(() => {
  const fn = vi.fn(() => 'sonner-id') as unknown as ((...args: unknown[]) => string) & Record<string, ReturnType<typeof vi.fn>>;
  for (const level of ['success', 'error', 'warning', 'info', 'message', 'dismiss']) {
    (fn as Record<string, unknown>)[level] = vi.fn(() => `sonner-${level}`);
  }
  return fn;
});
vi.mock('sonner', () => ({ toast: sonnerMock }));

import {
  NOTIFICATION_HISTORY_LIMIT,
  __resetNotificationCenterForTests,
  clearNotificationHistory,
  getNotificationSnapshot,
  markAllNotificationsRead,
  setNotificationPopupsEnabled,
  subscribeNotifications,
  toast,
} from '@/lib/notificationCenter';

/**
 * 消息中心：提示不再弹在屏幕右上角（那里是倍速条与模拟时钟），
 * 而是汇总进「历史消息」，点开才看。
 */
describe('notificationCenter', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetNotificationCenterForTests();
    vi.clearAllMocks();
  });
  afterEach(() => {
    __resetNotificationCenterForTests();
  });

  it('【用户要求】默认不弹出：每一级提示都只记入历史，不交给 sonner 渲染', () => {
    toast.success('开多成交');
    toast.error('下单失败', { description: '余额不足' });
    toast.warning('随单止盈/止损未挂出');
    toast.info('资金费率结算');
    toast.message('已切换到直接交易模式', { description: '下单不再弹出快照' });
    toast('裸调用也要记');

    for (const level of ['success', 'error', 'warning', 'info', 'message']) {
      expect(sonnerMock[level]).not.toHaveBeenCalled();
    }
    expect(sonnerMock).not.toHaveBeenCalled();

    const { entries } = getNotificationSnapshot();
    expect(entries.map(e => e.level)).toEqual(['message', 'message', 'info', 'warning', 'error', 'success']);
    expect(entries[4]).toMatchObject({ title: '下单失败', description: '余额不足' });
    expect(entries[1]).toMatchObject({ title: '已切换到直接交易模式', description: '下单不再弹出快照' });
  });

  it('打开「弹出提示」后照常交给 sonner，并且仍记入历史', () => {
    setNotificationPopupsEnabled(true);
    toast.error('下单失败', { description: '余额不足' });
    expect(sonnerMock.error).toHaveBeenCalledWith('下单失败', { description: '余额不足' });
    expect(getNotificationSnapshot().entries).toHaveLength(1);
  });

  it('开关按用户持久化：刷新后仍是上次的选择', () => {
    setNotificationPopupsEnabled(true);
    __resetNotificationCenterForTests();          // 模拟刷新：模块状态清空，只剩 localStorage
    toast.info('刷新后');
    expect(getNotificationSnapshot().popupsEnabled).toBe(true);
    expect(sonnerMock.info).toHaveBeenCalledTimes(1);
  });

  it('新的在前；未读计数只算上次打开之后的，报错单独计数（角标据此变红）', () => {
    toast.success('a');
    toast.error('b');
    expect(getNotificationSnapshot()).toMatchObject({ unreadCount: 2, unreadErrorCount: 1 });

    markAllNotificationsRead();
    expect(getNotificationSnapshot()).toMatchObject({ unreadCount: 0, unreadErrorCount: 0 });

    toast.info('c');
    const snap = getNotificationSnapshot();
    expect(snap.entries.map(e => e.title)).toEqual(['c', 'b', 'a']);
    expect(snap).toMatchObject({ unreadCount: 1, unreadErrorCount: 0 });
  });

  it('同一毫秒内的两条也分得开已读/未读（按序号而不是按时间戳）', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    toast.info('x');
    markAllNotificationsRead();
    toast.info('y');                              // 与 x 同一毫秒
    expect(getNotificationSnapshot().unreadCount).toBe(1);
    now.mockRestore();
  });

  it('历史跨刷新保留', () => {
    toast.warning('刷新前的消息');
    __resetNotificationCenterForTests();
    const snap = (subscribeNotifications(() => {})(), getNotificationSnapshot());
    expect(snap.entries.map(e => e.title)).toEqual(['刷新前的消息']);
  });

  it(`只保留最近 ${NOTIFICATION_HISTORY_LIMIT} 条`, () => {
    for (let i = 0; i < NOTIFICATION_HISTORY_LIMIT + 25; i += 1) toast.info(`#${i}`);
    const { entries } = getNotificationSnapshot();
    expect(entries).toHaveLength(NOTIFICATION_HISTORY_LIMIT);
    expect(entries[0].title).toBe(`#${NOTIFICATION_HISTORY_LIMIT + 24}`);
  });

  it('清空后新消息仍能正确判定为未读', () => {
    toast.info('旧');
    clearNotificationHistory();
    expect(getNotificationSnapshot().entries).toHaveLength(0);
    toast.info('新');
    expect(getNotificationSnapshot()).toMatchObject({ unreadCount: 1 });
  });

  it('非字符串标题不崩：记一个占位标题，原样交给 sonner', () => {
    setNotificationPopupsEnabled(true);
    const node = { type: 'span' } as unknown as string;
    toast.success(node);
    expect(getNotificationSnapshot().entries[0].title).toBe('（无标题提示）');
    expect(sonnerMock.success).toHaveBeenCalledWith(node, undefined);
  });

  it('订阅者在微任务里收到通知（避免在别的组件渲染途中触发更新）', async () => {
    const listener = vi.fn();
    subscribeNotifications(listener);
    await Promise.resolve();
    listener.mockClear();
    toast.info('a');
    toast.info('b');
    expect(listener).not.toHaveBeenCalled();     // 同步阶段不打扰
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);   // 连发两条合成一次
  });
});
