import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_POSITION_LIMIT_MODE, UNLIMITED_MAX_LEVERAGE } from '@/lib/positionLimitMode';

/**
 * 指南里的持仓限制模式（无限制 / 币安标准）必须与实现对得上：开关在哪、默认是哪个、
 * 无限制放开了什么，以及第 8 节写的币安规则都只在币安标准下生效。
 */
const read = (rel: string) => readFileSync(join(process.cwd(), 'src', rel), 'utf8');

const rowOf = (guide: string, title: string) => {
  const at = guide.indexOf(`${title}</td>`);
  expect(at).toBeGreaterThan(-1);
  return guide.slice(at, guide.indexOf('</tr>', at));
};

describe('指南：持仓限制模式', () => {
  const guide = read('pages/GuidePage.tsx');
  const s31 = guide.slice(guide.indexOf('<section id="s3-0"'), guide.indexOf('<section id="s3-1"'));

  it('3.1 写明开关在「直接交易」右边、默认无限制、两档各自是什么', () => {
    expect(DEFAULT_POSITION_LIMIT_MODE).toBe('unlimited');
    expect(UNLIMITED_MAX_LEVERAGE).toBe(150);
    expect(s31).toContain('3.1 交易模式与持仓限制');
    expect(s31).toContain('紧挨在「直接交易」右边');
    expect(s31).toContain('<strong>持仓限制模式</strong>');
    expect(s31).toContain('系统默认 <strong>无限制</strong>');
    expect(s31).toContain('无限制（默认）');
    expect(s31).toContain('<strong>无任何杠杆限制、无任何仓位大小限制</strong>');
    expect(s31).toContain(`杠杆 <strong>1–${UNLIMITED_MAX_LEVERAGE}x</strong>`);
    expect(s31).toContain('<strong>统一 0.4%</strong>');
    expect(s31).toContain('<strong>都只在币安标准模式下生效</strong>');
    expect(s31).toContain('<strong>切换不改写任何现有仓位与挂单</strong>');
    expect(s31).toContain('<strong>每一次判定都按那一刻的模式</strong>');
    // 时间模式图标不再「紧挨着」交易模式
    expect(s31).not.toContain('紧挨着它右侧那个极小、近乎隐形的符号');
    expect(s31).toContain('再往右那个极小、近乎隐形的符号');
  });

  it('第 8 节的三行币安规则开头都写明只在币安标准下生效，并指回 3.1', () => {
    for (const title of ['调整杠杆', '杠杆分层与仓位上限', '单笔数量上限（市价单）']) {
      const row = rowOf(guide, title);
      const body = row.slice(row.indexOf('<td', 1));
      expect(body.slice(0, 200)).toMatch(/只在「币安标准」持仓限制模式下生效/);
      expect(row).toContain('见 3.1');
    }
    expect(rowOf(guide, '调整杠杆')).toContain('有持仓也能降杠杆');
    expect(rowOf(guide, '杠杆分层与仓位上限')).toContain('无限制模式下开的仓位切到币安标准之后与下文「更新前的仓位」同等对待');
  });

  it('【复核】3.1 写准：标记在当前委托里、手机只沿用不切换、无限制下加仓并进分层仓位、进无限制时杠杆不解夹、悬停说明与切换警告', () => {
    // 「触发时将超限」之类的标记在当前委托列表里，不在下单面板
    expect(s31).toContain('当前委托里也不标「触发时将超限」「触发时将超单笔上限」');
    expect(s31).not.toContain('下单面板不显示杠杆分层、单笔上限小字与「触发时将超限」之类的标记');
    // 手机：没有开关、只能在电脑上切；底部那一行只有无限制模式写模式名
    expect(s31).toContain('只能在电脑上切换，手机上沿用上次选的模式（从没选过就是无限制）');
    expect(s31).toContain('币安标准模式下那里是「杠杆分层」');
    expect(s31).not.toContain('下单面板底部写着当前是哪一种');
    // 设计第 3 条：加仓并进现有仓位的模型
    expect(s31).toContain('无限制模式下往币安标准下开的（按分层计的）仓位上加仓，照样<strong>并进去</strong>');
    expect(s31).not.toContain('那一笔按 0.4% 单独成仓、不并进去');
    // 进无限制时有仓位标的的杠杆保持不变
    expect(s31).toContain('<strong>有持仓或开仓挂单的标的杠杆保持切换前仓位用的那一个</strong>');
    // 悬停说明、切换警告、一成交就会被强平的红框
    expect(s31).toContain('鼠标停在两段上，按钮正下方会显示这一档的说明');
    expect(s31).toContain('这一条升为警告并写出张数');
    expect(s31).toContain('下单面板在按钮前标红「一成交就会被强平」——只提醒，不拦');
    const toggle = read('components/SessionModeControls.tsx');
    expect(toggle).toContain('side="bottom"');
    expect(toggle).toContain('ordersRefusedUnderBinance(ctx.ordersMap, ctx.positionsMap, ctx.priceMap)');
    expect(read('components/OrderPanel.tsx')).toContain('data-testid="opening-liquidation-warning"');
  });

  it('【复核】第 8 节「调整杠杆」：无限制模式保留的拒绝是三道，含可用余额补不上', () => {
    const row = rowOf(guide, '调整杠杆');
    expect(row).toContain('只保留三道：立即触发强平则拒绝、取不到标记价则拒绝、降杠杆要追加的保证金可用余额补不上则拒绝');
    expect(row).not.toContain('两道');
    expect(read('lib/leverageRestatement.ts')).toContain("'insufficient-balance',");
  });

  it('加仓计算器与默认杠杆偏好也注明模式', () => {
    expect(guide).toContain('默认的无限制模式没有分层上限与单笔上限，只受 Plan B 约束');
    expect(guide).toContain('无限制模式下最高 150x，偏好的 1–50x 照原值生效');
    expect(read('components/TradingPreferencesDrawer.tsx')).toContain('无限制模式下最高 150x');
  });

  it('界面上开关的位置与指南一致：SessionModeControls 里紧跟在「直接交易」按钮后面', () => {
    const src = read('components/SessionModeControls.tsx');
    const direct = src.indexOf('<Zap className="w-3 h-3" /> 直接交易');
    const toggle = src.indexOf('data-testid="position-limit-mode"');
    const timeMode = src.indexOf('{/* 时间模式：折叠进一个极小、近乎隐形的符号');
    expect(direct).toBeGreaterThan(-1);
    expect(toggle).toBeGreaterThan(direct);
    expect(timeMode).toBeGreaterThan(toggle);
  });
});
