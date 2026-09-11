import { useEffect, useState } from 'react';
import {
  NOTIFICATION_HISTORY_LIMIT,
  clearNotificationHistory,
  getNotificationSnapshot,
  markAllNotificationsRead,
  refreshNotifications,
  useNotificationCenter,
  type NotificationLevel,
} from '@/lib/notificationCenter';

const LEVEL_DOT: Record<NotificationLevel, string> = {
  success: 'bg-[#0ECB81]',
  error: 'bg-[#F6465D]',
  warning: 'bg-[#F0B90B]',
  info: 'bg-[#2B7FFF]',
  message: 'bg-muted-foreground/60',
};

const LEVEL_LABEL: Record<NotificationLevel, string> = {
  success: '成功',
  error: '错误',
  warning: '警告',
  info: '信息',
  message: '提示',
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 本地时间 MM-DD HH:mm:ss —— 记录的是真实发生时刻，不是回放里的模拟时间。 */
function formatAt(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * 历史消息：全站提示的汇总。打开即视为全部已读。
 * 未读的那几条在左侧有一道细竖线，方便一眼看出「刚才错过了什么」。
 */
export function NotificationHistoryPanel() {
  const { entries } = useNotificationCenter();

  /**
   * 「上次读到哪」只在打开这一刻取一次并冻结。
   * 若每次渲染都读 lastReadSeq，下面那个 effect 一标记已读就触发重渲染，
   * 高亮会在用户看清之前就全部消失——等于从来没有高亮过。
   */
  const [unreadFrom] = useState(() => {
    refreshNotifications();
    return getNotificationSnapshot().lastReadSeq;
  });
  useEffect(() => {
    refreshNotifications();
    markAllNotificationsRead();
    // 只在打开这一刻标记；列表之后新增的消息等下次打开再算已读。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (entries.length === 0) {
    return (
      <div data-testid="notification-history-empty" className="p-6 text-center text-[12px] text-muted-foreground">
        暂无消息。成交、触发、资金费结算、报错等提示都会记在这里。
      </div>
    );
  }

  return (
    <div data-testid="notification-history">
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-2 text-[11px] text-muted-foreground">
        <span>共 {entries.length} 条 · 最多保留最近 {NOTIFICATION_HISTORY_LIMIT} 条</span>
        <button
          type="button"
          onClick={() => clearNotificationHistory()}
          className="rounded px-1.5 py-0.5 transition-colors hover:bg-secondary hover:text-foreground"
        >
          清空
        </button>
      </div>
      <ul>
        {entries.map(entry => {
          const unread = entry.seq > unreadFrom;
          return (
            <li
              key={entry.id}
              data-testid="notification-history-item"
              data-level={entry.level}
              data-unread={unread ? 'true' : 'false'}
              className={`relative flex gap-2.5 border-b border-border/40 px-4 py-2.5 ${unread ? 'bg-secondary/40' : ''}`}
            >
              {unread && <span aria-hidden className="absolute inset-y-2 left-0 w-0.5 rounded-r bg-primary" />}
              <span
                aria-label={LEVEL_LABEL[entry.level]}
                className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${LEVEL_DOT[entry.level]}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="break-words text-[12px] text-foreground">{entry.title}</span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{formatAt(entry.at)}</span>
                </div>
                {entry.description && (
                  <p className="mt-0.5 break-words text-[11px] leading-relaxed text-muted-foreground">
                    {entry.description}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
