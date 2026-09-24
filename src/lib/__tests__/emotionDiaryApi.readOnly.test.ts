import { beforeEach, describe, expect, it, vi } from 'vitest';

const remote = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));
vi.mock('@/integrations/supabase/client', () => {
  const query = {
    select: () => query,
    eq: () => query,
    order: async () => ({ data: remote.rows, error: null }),
  };
  return { supabase: { from: () => query } };
});
vi.mock('@/lib/simStateSync', () => ({ queueSimStatePush: vi.fn() }));

import { listDecisionEmotionDiaries } from '@/lib/emotionDiaryApi';
import { queueSimStatePush } from '@/lib/simStateSync';

const STORAGE_KEY = 'decision_emotion_diaries_v1:user-1';
const row = (diary_date: string, event_text: string) => ({
  id: `d-${diary_date}`, user_id: 'user-1', diary_date, event_text, sam_valence: null, sam_arousal: null,
  hads_anxiety_scores: [], hads_depression_scores: [], hads_anxiety_score: 3, hads_depression_score: 2,
  measurement_version: 'v', created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
});

describe('listDecisionEmotionDiaries 的只读版本（批量导出用）', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(queueSimStatePush).mockClear();
    remote.rows = [row('2026-09-02', '云端的'), row('2026-09-01', '另一天')];
  });

  it('mirror: false 只读：不回写本机镜像，也不排队推 user_sim_state', async () => {
    const diaries = await listDecisionEmotionDiaries('user-1', { mirror: false });
    expect(diaries.map(item => item.diary_date)).toEqual(['2026-09-02', '2026-09-01']);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(queueSimStatePush).not.toHaveBeenCalled();
  });

  it('只读版本照样合并本机镜像里云端还没有的日记', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([row('2026-09-03', '只在本机')]));
    const before = localStorage.getItem(STORAGE_KEY);
    const diaries = await listDecisionEmotionDiaries('user-1', { mirror: false });
    expect(diaries.map(item => item.diary_date)).toEqual(['2026-09-03', '2026-09-02', '2026-09-01']);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
    expect(queueSimStatePush).not.toHaveBeenCalled();
  });

  it('默认（日记页、详情页）照旧回写本机镜像并排队同步', async () => {
    await listDecisionEmotionDiaries('user-1');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toHaveLength(2);
    expect(queueSimStatePush).toHaveBeenCalledTimes(1);
    expect(queueSimStatePush).toHaveBeenCalledWith('user-1', 'emotion_diary_v1', expect.any(Array));
  });
});
