/**
 * 盲区（Blind Spots）—— 错题集里唯一的附加模块。
 *
 * 盲区 = 你「没预想到」的错误来源：它不在你的预案里、不在你盯的证伪信号里，
 * 所以系统也无法自动算出来 —— 只能手动记录，直到它变成可预测、可写进规则的东西。
 *
 * 存在 localStorage（按用户隔离），不进数据库：
 * 它是纯个人的手动笔记，且这样可以立刻可用，不依赖任何远端迁移。
 */
import { useCallback, useEffect, useState } from 'react';

export interface BlindSpot {
  id: string;
  title: string;
  note: string;
  createdAt: string; // ISO
}

const keyFor = (userId: string | null | undefined) => `veil:blindspots:${userId || 'anon'}`;

export function loadBlindSpots(userId: string | null | undefined): BlindSpot[] {
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is BlindSpot =>
        x && typeof x.id === 'string' && typeof x.title === 'string',
    );
  } catch {
    return [];
  }
}

export function saveBlindSpots(userId: string | null | undefined, items: BlindSpot[]): void {
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify(items));
  } catch {
    /* localStorage 不可用时静默降级 */
  }
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `bs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** React 绑定：加载 / 新增 / 删除盲区，自动持久化到 localStorage。 */
export function useBlindSpots(userId: string | null | undefined) {
  const [items, setItems] = useState<BlindSpot[]>([]);

  useEffect(() => {
    setItems(loadBlindSpots(userId));
  }, [userId]);

  const add = useCallback(
    (title: string, note: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      setItems(prev => {
        const next: BlindSpot[] = [
          { id: makeId(), title: trimmed, note: note.trim(), createdAt: new Date().toISOString() },
          ...prev,
        ];
        saveBlindSpots(userId, next);
        return next;
      });
    },
    [userId],
  );

  const remove = useCallback(
    (id: string) => {
      setItems(prev => {
        const next = prev.filter(b => b.id !== id);
        saveBlindSpots(userId, next);
        return next;
      });
    },
    [userId],
  );

  return { items, add, remove };
}
