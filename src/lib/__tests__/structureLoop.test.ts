import { describe, it, expect } from 'vitest';
import { classifyDeathDoor, deriveLoopReadout, type LoopReadoutInput } from '@/lib/structureLoop';

describe('classifyDeathDoor · 死法门口径', () => {
  it('赢单不判死法门（止损本不必触发）', () => {
    expect(classifyDeathDoor('win', 'not_triggered')).toBeNull();
  });
  it('亏 + 按预案触发并执行 → 前门', () => {
    expect(classifyDeathDoor('loss', 'triggered_reacted')).toBe('front');
  });
  it('亏 + 触发了但反应晚 → 晚门', () => {
    expect(classifyDeathDoor('loss', 'triggered_late')).toBe('late');
  });
  it('亏 + 未触发主观平 → 后门（死法不在预案内）', () => {
    expect(classifyDeathDoor('loss', 'not_triggered')).toBe('back');
  });
  it('亏但未评价证伪状态 → null（不下结论）', () => {
    expect(classifyDeathDoor('loss', null)).toBeNull();
  });
  it('保本不判', () => {
    expect(classifyDeathDoor('breakeven', 'triggered_reacted')).toBeNull();
  });
});

const base: LoopReadoutInput = {
  outcome: 'loss',
  quadrant: null,
  oddsReview: null,
  premortemReviewFilled: false,
  falsificationStatus: null,
  hasFalsificationPlan: true,
};

describe('deriveLoopReadout · 闭环裁决', () => {
  it('赢 → 闭环完整；正兑现、止未触发', () => {
    const r = deriveLoopReadout({ ...base, outcome: 'win' });
    expect(r.verdict).toBe('intact');
    expect(r.zheng.tone).toBe('good');
    expect(r.zhi.tone).toBe('good');
    expect(r.zhi.status).toContain('盈利离场');
  });

  it('亏 + 前门 → 完整（真死时按预案死）', () => {
    const r = deriveLoopReadout({ ...base, falsificationStatus: 'triggered_reacted' });
    expect(r.verdict).toBe('intact');
    expect(r.deathDoor).toBe('front');
    expect(r.zhi.tone).toBe('good');
  });

  it('亏 + 晚门 → 迟滞（执行差）', () => {
    const r = deriveLoopReadout({ ...base, falsificationStatus: 'triggered_late' });
    expect(r.verdict).toBe('lagged');
    expect(r.deathDoor).toBe('late');
    expect(r.zhi.tone).toBe('warn');
  });

  it('亏 + 后门 → 有缺口（必须迭代）', () => {
    const r = deriveLoopReadout({ ...base, falsificationStatus: 'not_triggered' });
    expect(r.verdict).toBe('gap');
    expect(r.deathDoor).toBe('back');
    expect(r.zhi.tone).toBe('bad');
    expect(r.zhi.status).toContain('后门');
  });

  it('亏 + 止未核验 + 有预案 → 待判读', () => {
    const r = deriveLoopReadout({ ...base, falsificationStatus: null });
    expect(r.verdict).toBe('pending');
    expect(r.zhi.status).toContain('待核验');
  });

  it('亏 + 止未核验 + 无预案 → 待判读，提示本笔未设止', () => {
    const r = deriveLoopReadout({ ...base, falsificationStatus: null, hasFalsificationPlan: false });
    expect(r.verdict).toBe('pending');
    expect(r.zhi.status).toContain('未设止');
    expect(r.zhi.tone).toBe('muted');
  });

  it('反：结构破坏复核 wrong → 反成立（bad）', () => {
    const r = deriveLoopReadout({ ...base, falsificationStatus: 'triggered_reacted', oddsReview: 'wrong' });
    expect(r.fan.tone).toBe('bad');
    expect(r.fan.status).toContain('结构破了');
  });

  it('反：结构守住 right → 反未成立（good）', () => {
    const r = deriveLoopReadout({ ...base, outcome: 'win', oddsReview: 'right' });
    expect(r.fan.tone).toBe('good');
  });

  it('反：无结构化代理但已填 premortem 复核 → 已核验（muted）', () => {
    const r = deriveLoopReadout({ ...base, premortemReviewFilled: true });
    expect(r.fan.status).toBe('已核验');
    expect(r.fan.tone).toBe('muted');
  });

  it('正：结构对但亏（correct_loss）→ warn（属方差，不是真错）', () => {
    const r = deriveLoopReadout({ ...base, falsificationStatus: 'triggered_reacted', quadrant: 'correct_loss' });
    expect(r.zheng.tone).toBe('warn');
    expect(r.zheng.status).toContain('结构对');
  });

  it('正：结构错且亏 → bad', () => {
    const r = deriveLoopReadout({ ...base, falsificationStatus: 'not_triggered', quadrant: 'deserved_loss' });
    expect(r.zheng.tone).toBe('bad');
  });
});
