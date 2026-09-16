import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 指南「盈亏概览」一段里的峰值浮盈口径，与战役页的实际还原方式必须对得上：
 * 分几刀平掉的腿逐刀还原，只在本地有成交记录时成立；没有成交记录时主力 / 镜像按 Leg 快照整条持有，
 * 这台浏览器上的峰值可能偏高。指南不能无条件许诺「每一刀都计入」。
 */
const guide = readFileSync(join(process.cwd(), 'src', 'pages/GuidePage.tsx'), 'utf8');

describe('指南：峰值浮盈的分刀口径与扫描窗口', () => {
  it('「每一刀都计入峰值浮盈」带着「本地有成交记录时」的前提，并写明没有成交记录时的样子', () => {
    expect(guide).not.toContain('一条腿分几刀平掉时（M 减仓、并仓后的镜像止盈），每一刀都计入峰值浮盈');
    const at = guide.indexOf('每一刀都计入峰值浮盈');
    expect(at).toBeGreaterThan(-1);
    expect(guide.slice(at - 60, at)).toContain('本地有成交记录时，一条腿分几刀平掉');
    const after = guide.slice(at, at + 200);
    expect(after).toContain('本地没有成交记录时');
    expect(after).toContain('按 Leg 快照整条还原');
    expect(after).toContain('峰值浮盈可能高于实际峰值');
  });

  it('已结束战役的扫描窗口不早于最后一次平仓；反事实一段同样带着前提与这几类形状', () => {
    expect(guide).toContain('已结束的战役从开仓扫到结束时间，但<strong>不早于最后一次平仓</strong>');
    expect(guide).toContain('本地有成交记录时，<strong>分几刀平掉的腿按每一刀还原</strong>');
    expect(guide).toContain('腿上存的是委托 id、本地委托记录显示它已撤单或仍挂着的，也算');
    expect(guide).toContain('开平时间与价格取这条腿自己认领到的收盘那一刀');
  });
});
