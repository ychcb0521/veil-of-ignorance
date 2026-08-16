// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: vi.fn(), auth: { getUser: vi.fn() } },
}));

import { appendUntriggeredMirrorTpLeg } from '@/lib/journalApi';
import type { CampaignEvent, TradeCampaign, TradeJournal } from '@/types/journal';

function campaign(events: Partial<CampaignEvent>[]): TradeCampaign {
  return {
    id: 'c1', user_id: 'u1', symbol: 'TAKEUSDT', direction: 'main_long',
    initial_leverage: 10, closed_at: null,
    actual_evolution: events.map((e, i) => ({
      id: `e${i}`, timestamp: `2026-08-05T0${i + 1}:00:00Z`, ...e,
    })) as CampaignEvent[],
  } as TradeCampaign;
}

const mainLeg = { id: 'm1', leg_role: 'main_open' } as TradeJournal;

describe('appendUntriggeredMirrorTpLeg', () => {
  it('挂出但未触发的镜像止盈会补进 legs——否则这场战役看不出挂过 TP', () => {
    const c = campaign([
      { event_type: 'main_opened', leg_role: 'main_open' },
      { event_type: 'mirror_tp_placed', leg_role: 'mirror_tp', price: 0.0452, size_usdt: 8000 },
    ]);
    const out = appendUntriggeredMirrorTpLeg(c, [mainLeg]);
    expect(out).toHaveLength(2);
    const tp = out.find(leg => leg.leg_role === 'mirror_tp');
    expect(tp).toBeDefined();
    expect(tp?.campaign_id).toBe('c1');
  });

  it('已存在 mirror_tp leg 时不重复补——已触发的那笔本就有 DB 行', () => {
    const c = campaign([{ event_type: 'mirror_tp_placed', leg_role: 'mirror_tp' }]);
    const existing = { id: 'tp1', leg_role: 'mirror_tp' } as TradeJournal;
    const out = appendUntriggeredMirrorTpLeg(c, [mainLeg, existing]);
    expect(out).toHaveLength(2);
    expect(out.filter(leg => leg.leg_role === 'mirror_tp')).toHaveLength(1);
  });

  it('有触发事件却缺 DB leg 时不臆造——那是另一类问题', () => {
    const c = campaign([
      { event_type: 'mirror_tp_placed', leg_role: 'mirror_tp' },
      { event_type: 'mirror_tp_triggered', leg_role: 'mirror_tp' },
    ]);
    expect(appendUntriggeredMirrorTpLeg(c, [mainLeg])).toHaveLength(1);
  });

  it('从未挂过镜像止盈的战役保持原样', () => {
    const c = campaign([{ event_type: 'main_opened', leg_role: 'main_open' }]);
    expect(appendUntriggeredMirrorTpLeg(c, [mainLeg])).toHaveLength(1);
  });

  it('没有 actual_evolution 也不炸', () => {
    const c = { id: 'c1', user_id: 'u1', symbol: 'X', direction: 'main_long' } as TradeCampaign;
    expect(appendUntriggeredMirrorTpLeg(c, [mainLeg])).toHaveLength(1);
  });
});
