/**
 * 存储覆盖审计：确保「跟账号走」的数据没有漏掉云端同步。
 *
 * 这条测试是给未来的自己设的闸门——新增一处 localStorage 写入却忘了推送时，
 * 它会失败并指出文件，而不是等到用户换浏览器才发现数据没了。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');

/** 已知不需要同步的写入点，附豁免理由。 */
const EXEMPT: Record<string, string> = {
  'contexts/ThemeContext.tsx': '主题偏好属设备级，跨浏览器不必统一',
  'hooks/useTheme.ts': '同上',
  'hooks/useTimeSimulator.ts': '__tm_live_time 是崩溃恢复用的心跳，重启即重建',
  'lib/simStateSync.ts': '同步层自身（写影子时间戳与水化回写）',
  'hooks/usePersistedState.ts': '已在 setState 里接入推送',
  'pages/JournalCampaignDetailPage.tsx': '反事实/反向委托的「本地隐藏」是查看偏好，非数据',
  'lib/signalLibrary.ts': '已在 saveSignals 里接入推送',
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      return name === '__tests__' || name === 'node_modules' ? [] : walk(full);
    }
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

describe('云端同步的存储覆盖', () => {
  it('每个 localStorage 写入点，要么接了推送，要么在豁免表里说明了理由', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = file.slice(SRC.length + 1).replace(/\\/g, '/');
      const content = readFileSync(file, 'utf8');
      if (!/localStorage\.setItem/.test(content)) continue;
      if (EXEMPT[rel]) continue;
      if (/queueSimStatePush/.test(content)) continue;
      offenders.push(rel);
    }
    expect(
      offenders,
      `以下文件写了 localStorage 却没有接入 queueSimStatePush，也不在豁免表里：\n${offenders.join('\n')}\n`
        + '若确实不需要同步，请把它加进 EXEMPT 并写明理由。',
    ).toEqual([]);
  });

  it('引擎状态的关键键都不在排除表里——账户资产由它们推导', () => {
    const sync = readFileSync(join(SRC, 'lib/simStateSync.ts'), 'utf8');
    const excluded = /EXCLUDED_KEYS = new Set\(\[([^\]]*)\]\)/.exec(sync)?.[1] ?? '';
    // 账户资产 = initial_capital(服务端) + balance + positionsMap + tradeHistory
    for (const key of ['balance', 'positions_map', 'trade_history', 'orders_map',
                       'filled_orders', 'cancelled_orders', 'coin_timelines_v2',
                       'symbol_leverage']) {
      expect(excluded).not.toContain(`'${key}'`);
    }
  });
});
