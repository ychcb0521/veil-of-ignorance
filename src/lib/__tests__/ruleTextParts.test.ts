import { describe, expect, it } from 'vitest';
import { parseRuleTextParts } from '@/lib/ruleTextParts';

describe('【用户要求】规则文字拆成 阶段 / 违规 / 修正', () => {
  it('去掉【战役偏离】，按「修正后的规则」分行，拆出阶段', () => {
    expect(parseRuleTextParts('【战役偏离】违规操作：1:1 镜像止盈之后的阶段：止损线上移得太慢。修正后的规则：止损线要紧紧追随')).toEqual({
      phase: '1:1 镜像止盈之后的阶段',
      violation: '止损线上移得太慢',
      fix: '止损线要紧紧追随',
    });
  });

  it('阶段是腿角色代号时换成中文名', () => {
    const parts = parseRuleTextParts('【战役偏离】违规操作：main_open：加仓之后的对冲触发之后硬拆。修正后的规则：加仓之后对冲触发之后就不要动了');
    expect(parts.phase).not.toBe('main_open');
    expect(parts.phase).not.toMatch(/[a-z_]{4,}/);
    expect(parts.violation).toBe('加仓之后的对冲触发之后硬拆');
    expect(parts.fix).toBe('加仓之后对冲触发之后就不要动了');
  });

  it('阶段太长（第一个冒号离得太远）时不拆，违规开头的代号仍换成中文', () => {
    const parts = parseRuleTextParts('【战役偏离】违规操作：hedge_initial_a新的支撑位产生的时候（虽然还是低于成本位）：新的扎实的支撑位产生。修正后的规则：要用好支撑位');
    expect(parts.phase).toBeNull();
    expect(parts.violation?.startsWith('hedge_initial_a')).toBe(false);
    expect(parts.violation).toContain('新的支撑位产生的时候');
  });

  it('只有修正、没有违规；手写规则整段当规则', () => {
    expect(parseRuleTextParts('【战役偏离】修正后的规则：别追高')).toEqual({ phase: null, violation: null, fix: '别追高' });
    expect(parseRuleTextParts('开仓前确认止损线距离')).toEqual({ phase: null, violation: null, fix: '开仓前确认止损线距离' });
  });
});
