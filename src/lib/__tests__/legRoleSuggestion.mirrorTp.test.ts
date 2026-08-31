import { describe, expect, it } from 'vitest';
import { suggestOrphanRecordRoles, type OrphanRecordRoleInput } from '@/lib/legRoleSuggestion';

/**
 * 实盘 TURBOUSDT 2025-04-23（用户截图）。三条裸 record，都没有 exit_method——
 * 从币安导入的历史成交本来就没有这个字段，而原算法只认 `exitMethod === 'tp1'`，
 * 于是镜像止盈整批掉进兜底分支被当成加仓。
 *
 * 而 mirror_tp 是**计入 ex-ante 开仓敞口**的，判错这一条，加仓的名义就会从这扇错门
 * 混进预期最大亏损。
 */
const t = (s: string) => Date.parse(`2025-04-23T${s}+08:00`);
const OPEN = t('11:31:07');

const rec = (over: Partial<OrphanRecordRoleInput> & { id: string }): OrphanRecordRoleInput => ({
  direction: 'long', openTimeMs: OPEN, closeTimeMs: null, entryPrice: 0.0034, size: 1, ...over,
});

// 主力 40% 留到最后平；镜像 60% 先落袋。同刻、同价。
const MAIN = rec({ id: 'main', closeTimeMs: t('15:08:06'), size: 548_620 });
const MIRROR = rec({ id: 'mirror', closeTimeMs: t('12:19:24'), size: 822_920 });
const HEDGE = rec({
  id: 'hedge', direction: 'short', openTimeMs: t('14:31:26'),
  closeTimeMs: t('15:08:06'), entryPrice: 0.0041, size: 629_560,
});

const roleOf = (out: ReturnType<typeof suggestOrphanRecordRoles>, id: string) =>
  out.find(s => s.id === id);

describe('镜像止盈要认得出来——裸 record 没有 exit_method', () => {
  it('【回归】同刻同价开出、先平的那笔是镜像，不是加仓', () => {
    const out = suggestOrphanRecordRoles([MAIN, MIRROR, HEDGE], 'long');
    expect(roleOf(out, 'main')?.suggestedRole).toBe('main_open');
    expect(roleOf(out, 'mirror')?.suggestedRole).toBe('mirror_tp');
    expect(roleOf(out, 'hedge')?.suggestedRole).toBe('hedge_rolling');
  });

  it('60/40 分割对上时给高置信度', () => {
    // 822920 / (822920 + 548620) = 60.0%，正是策略写死的比例
    expect(822_920 / (822_920 + 548_620)).toBeCloseTo(0.6, 3);
    expect(roleOf(suggestOrphanRecordRoles([MAIN, MIRROR], 'long'), 'mirror')?.confidence).toBe('high');
  });

  it('比例对不上仍判镜像，但降一档并提示确认', () => {
    const odd = { ...MIRROR, size: 100_000 };
    const s = roleOf(suggestOrphanRecordRoles([MAIN, odd], 'long'), 'mirror');
    expect(s?.suggestedRole).toBe('mirror_tp');
    expect(s?.confidence).toBe('medium');
    expect(s?.reason).toContain('请确认');
  });

  it('【判据】后开、异价的才是加仓——镜像的分水岭是「什么时候开的」', () => {
    const add = rec({ id: 'add', openTimeMs: t('13:40:00'), entryPrice: 0.0041, closeTimeMs: t('14:00:00') });
    const out = suggestOrphanRecordRoles([MAIN, MIRROR, add], 'long');
    expect(roleOf(out, 'mirror')?.suggestedRole).toBe('mirror_tp');
    expect(roleOf(out, 'add')?.suggestedRole).toBe('main_add_1');
  });

  it('同刻但**异价** → 是加仓不是镜像', () => {
    const sameTimeDifferentPrice = rec({ id: 'x', entryPrice: 0.0050, closeTimeMs: t('12:00:00') });
    expect(roleOf(suggestOrphanRecordRoles([MAIN, sameTimeDifferentPrice], 'long'), 'x')?.suggestedRole)
      .toBe('main_add_1');
  });

  it('同价但**晚开很久** → 是加仓不是镜像', () => {
    const lateSamePrice = rec({ id: 'y', openTimeMs: OPEN + 3_600_000, closeTimeMs: t('13:00:00') });
    expect(roleOf(suggestOrphanRecordRoles([MAIN, lateSamePrice], 'long'), 'y')?.suggestedRole)
      .toBe('main_add_1');
  });

  it('【判据】镜像必须比主力先平——后平的那笔才是主力', () => {
    // 主力按定义活得比镜像久；若把先平的判成主力，整场战役的风险锚都会读错腿。
    const out = suggestOrphanRecordRoles([MAIN, MIRROR], 'long');
    expect(roleOf(out, 'main')?.suggestedRole).toBe('main_open');
    expect(roleOf(out, 'mirror')?.suggestedRole).not.toBe('main_open');
  });

  it('exit_method 是 tp1 时仍然优先按它判（有明确证据就不用猜）', () => {
    const tagged = rec({ id: 'z', openTimeMs: OPEN + 7_200_000, entryPrice: 0.009,
      closeTimeMs: t('14:00:00'), exitMethod: 'tp1' });
    expect(roleOf(suggestOrphanRecordRoles([MAIN, tagged], 'long'), 'z')?.suggestedRole).toBe('mirror_tp');
  });

  it('【回归】不传开仓价时不乱判——退回原来的行为', () => {
    const noPrice = [
      { ...MAIN, entryPrice: null, size: null },
      { ...MIRROR, entryPrice: null, size: null },
    ];
    const out = suggestOrphanRecordRoles(noPrice, 'long');
    expect(roleOf(out, 'main')?.suggestedRole).toBe('main_open');
    expect(roleOf(out, 'mirror')?.suggestedRole).toBe('main_add_1');
  });

  it('两笔主力各带自己的镜像', () => {
    const OPEN2 = t('16:00:00');
    const m2 = rec({ id: 'm2', openTimeMs: OPEN2, entryPrice: 0.0050, closeTimeMs: t('20:00:00'), size: 400 });
    const tp2 = rec({ id: 'tp2', openTimeMs: OPEN2, entryPrice: 0.0050, closeTimeMs: t('17:00:00'), size: 600 });
    const out = suggestOrphanRecordRoles([MAIN, MIRROR, m2, tp2], 'long');
    expect(roleOf(out, 'mirror')?.suggestedRole).toBe('mirror_tp');
    expect(roleOf(out, 'tp2')?.suggestedRole).toBe('mirror_tp');
    // 留到最后平掉的那笔才是主力；另一笔主力退成加仓（战役只允许一个 main_open 建议）
    expect(roleOf(out, 'm2')?.suggestedRole).toBe('main_open');
  });
});
