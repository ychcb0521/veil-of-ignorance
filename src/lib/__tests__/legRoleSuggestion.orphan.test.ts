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

describe('加仓槽用尽后的溢出兜底', () => {
  it('第 7 笔起退到 reentry_main，而不是把所有溢出的都叫「加仓6」', () => {
    // 原实现用 MAIN_ADD_ROLES[Math.min(n, len-1)] 夹逼索引，
    // ?? 'reentry_main' 这条溢出兜底因此永远不触发：第 7、8、9… 笔全被标成加仓6。
    // 一个对多行都相同的「建议」不含信息，还把「我不知道」伪装成了具体答案。
    const records: OrphanRecordRoleInput[] = [
      // 留到最后平掉的那笔是主力
      rec({ id: 'main', openTimeMs: 100, closeTimeMs: 99_000 }),
      ...Array.from({ length: 8 }, (_, i) =>
        rec({ id: `add-${i + 1}`, openTimeMs: 1_000 + i, closeTimeMs: 2_000 })),
    ];
    const out = suggestOrphanRecordRoles(records, 'long');
    expect(roleOf(out, 'main')).toBe('main_open');
    expect(roleOf(out, 'add-1')).toBe('main_add_1');
    expect(roleOf(out, 'add-6')).toBe('main_add_6');
    // 越过第 6 个槽后不再重复 main_add_6
    expect(roleOf(out, 'add-7')).toBe('reentry_main');
    expect(roleOf(out, 'add-8')).toBe('reentry_main');
  });

  it('六个加仓槽各不相同——建议要能区分出第几笔', () => {
    const records: OrphanRecordRoleInput[] = [
      rec({ id: 'main', openTimeMs: 100, closeTimeMs: 99_000 }),
      ...Array.from({ length: 6 }, (_, i) =>
        rec({ id: `add-${i + 1}`, openTimeMs: 1_000 + i, closeTimeMs: 2_000 })),
    ];
    const roles = suggestOrphanRecordRoles(records, 'long')
      .filter(s => s.id.startsWith('add-'))
      .map(s => s.suggestedRole);
    expect(new Set(roles).size).toBe(6);
  });
});
