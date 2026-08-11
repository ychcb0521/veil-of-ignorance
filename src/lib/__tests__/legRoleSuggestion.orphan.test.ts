import { describe, expect, it } from 'vitest';
import { suggestOrphanRecordRoles, type OrphanRecordRoleInput } from '../legRoleSuggestion';

const rec = (over: Partial<OrphanRecordRoleInput> & { id: string }): OrphanRecordRoleInput => ({
  direction: 'long',
  openTimeMs: 1000,
  closeTimeMs: 2000,
  exitMethod: 'manual',
  ...over,
});

const roleOf = (out: ReturnType<typeof suggestOrphanRecordRoles>, id: string) =>
  out.find(s => s.id === id)?.suggestedRole;

describe('suggestOrphanRecordRoles', () => {
  it('止盈1 平仓的记录建议为镜像止盈；留到最后平掉的建议为主力', () => {
    // 典型形态：M 与镜像同时开仓，镜像走止盈1 先落袋，M 留到最后手动平
    const out = suggestOrphanRecordRoles([
      rec({ id: 'mirror', openTimeMs: 1000, closeTimeMs: 5000, exitMethod: 'tp1' }),
      rec({ id: 'main', openTimeMs: 1000, closeTimeMs: 9000, exitMethod: 'manual' }),
    ], 'long');
    expect(roleOf(out, 'mirror')).toBe('mirror_tp');
    expect(roleOf(out, 'main')).toBe('main_open');
  });

  it('主力不再默认第一条记录：先开但先平的不是主力', () => {
    const out = suggestOrphanRecordRoles([
      rec({ id: 'early-closed', openTimeMs: 1000, closeTimeMs: 3000 }),
      rec({ id: 'held-longest', openTimeMs: 2000, closeTimeMs: 9000 }),
    ], 'long');
    expect(roleOf(out, 'held-longest')).toBe('main_open');
    expect(roleOf(out, 'early-closed')).toBe('main_add_1');
  });

  it('仍持有（closeTime 空/0）视为最晚平掉，即主力', () => {
    const out = suggestOrphanRecordRoles([
      rec({ id: 'closed', closeTimeMs: 9000 }),
      rec({ id: 'still-open', closeTimeMs: null }),
      rec({ id: 'zero-close', closeTimeMs: 0, exitMethod: 'tp1' }),
    ], 'long');
    // 两笔未平：先开的那笔作主力（并列取更早开仓者）
    expect(roleOf(out, 'still-open')).toBe('main_open');
    expect(roleOf(out, 'zero-close')).toBe('mirror_tp');
    expect(roleOf(out, 'closed')).toBe('main_add_1');
  });

  it('冲突时主力优先：唯一同向记录即使走了止盈1 也判为主力', () => {
    const out = suggestOrphanRecordRoles([
      rec({ id: 'only', exitMethod: 'tp1' }),
    ], 'long');
    expect(roleOf(out, 'only')).toBe('main_open');
  });

  it('反向记录仍建议滚动对冲；tp2/tp3 不冒充镜像', () => {
    const out = suggestOrphanRecordRoles([
      rec({ id: 'main', closeTimeMs: 9000 }),
      rec({ id: 'short-hedge', direction: 'short', closeTimeMs: 4000 }),
      rec({ id: 'tp2', closeTimeMs: 3000, exitMethod: 'tp2' }),
    ], 'long');
    expect(roleOf(out, 'short-hedge')).toBe('hedge_rolling');
    expect(roleOf(out, 'tp2')).toBe('main_add_1');
  });
});
