/**
 * 「合并所有平行时间轴」确认框的文案守卫。
 *
 * 这是全系统唯一一个不可撤销的破坏性确认框，用户按下去之前只能读这段字判断后果。
 * 它曾经写着「各币种的独立资金」「所有独立沙盒账户将被销毁」——而 isolatedBalances
 * 早已被换成空对象 + 空操作 setter（TradingContext.tsx），资金一直是单一全局池。
 * 在这种地方夸大后果和瞒报后果一样有害：前者会吓得人不敢切，后者会让人误删东西。
 *
 * 因此这条测试把文案钉在 confirmStopAllAndSwitch 的实际行为上。
 * 改动那个 handler 时，这里会跟着红——那正是提醒去同步文案的时刻。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const indexSrc = () => readFileSync(join(process.cwd(), 'src/pages/Index.tsx'), 'utf8');

/** 截出 confirmStopAllAndSwitch 的函数体，用来核对文案与行为是否对得上。 */
function confirmHandlerBody(): string {
  const src = indexSrc();
  const start = src.indexOf('const confirmStopAllAndSwitch');
  expect(start).toBeGreaterThan(-1);
  return src.slice(start, src.indexOf('toast.success', start));
}

function dialogCopy(): string {
  const src = indexSrc();
  const start = src.indexOf('合并所有平行时间轴');
  expect(start).toBeGreaterThan(-1);
  // 剥掉 JSX 注释：守卫要看的是用户读到的字，注释里复述旧文案不该判红。
  return src
    .slice(start, src.indexOf('</DialogFooter>', start))
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

describe('时间轴合并确认框', () => {
  it('不再声称存在「独立资金」或「独立沙盒账户」——资金早已是单一全局池', () => {
    const copy = dialogCopy();
    expect(copy).not.toContain('独立资金');
    expect(copy).not.toContain('独立沙盒账户');
    expect(copy).not.toContain('全局共享账户'); // 账户一直就是全局的，这句暗示切换后才变
  });

  it('逐条列出 handler 真正会做的四件事', () => {
    const body = confirmHandlerBody();
    const copy = dialogCopy();

    // 1. 强制平仓
    expect(body).toContain('handleClosePosition');
    expect(copy).toContain('强制结算');
    // 2. 撤单
    expect(body).toContain('handleCancelOrder');
    expect(copy).toContain('挂单将被撤销');
    // 3. 清各币种时钟
    expect(body).toContain('setCoinTimelines({})');
    expect(copy).toContain('独立时钟');
    // 4. 停时间机器
    expect(body).toContain('stopSimulation');
    expect(copy).toContain('时间机器停止');
  });

  it('说明强制平仓是真结算而不是抹除——盈亏会落进余额', () => {
    // 平仓走的是正常成交路径，会产生 CLOSE 记录；文案不能让人以为仓位凭空消失。
    expect(dialogCopy()).toContain('会产生成交记录');
  });

  it('写明哪些数据不受影响——只讲会毁掉什么，等于让人以为全没了', () => {
    const copy = dialogCopy();
    expect(copy).toContain('不受影响');
    for (const kept of ['账户余额', '成交与仓位历史', '交易战役', '复盘记录', '信号库']) {
      expect(copy).toContain(kept);
    }
  });

  it('handler 只清时间机器状态，不碰余额与成交历史', () => {
    const body = confirmHandlerBody();
    // clearSimState 只删 sim_state 这一个键；出现 setBalance / setTradeHistory 就说明
    // 行为已经超出文案承诺的范围，必须先改文案再改代码。
    expect(body).toContain('clearSimState()');
    expect(body).not.toContain('setBalance(');
    expect(body).not.toContain('setTradeHistory(');
  });
});
