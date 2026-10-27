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
  'lib/signalTurnover.ts': '用户要求统计信号库每个信号前 24 小时的 USDT 成交额：结果是可重算的统计，只存浏览器本机（按账号分区、只留最新一份），不改信号库、不上传云端；使用独立 veil:signal-turnover 键，不进入交易状态同步',
  'lib/fish/roundSummary.ts': '用户要求「捕捞过程」：每轮捕捞的逐币结论摘要只在浏览器本机保存（按账号分区、只留最近 40 轮），是可重算的说明，不改鱼的记录、不上传云端；使用独立 veil:fish-rounds 键，不进入交易状态同步。',
  'lib/notificationCenter.ts': '历史消息与「弹出提示」开关：本机的界面日志与显示偏好，封顶 300 条，按用户前缀分区；不属于交易状态，账户资产不由它推导，不需要跨设备同步。',
  'contexts/ThemeContext.tsx': '主题偏好属设备级，跨浏览器不必统一',
  'hooks/useTheme.ts': '同上',
  'hooks/useTimeSimulator.ts': '__tm_live_time 是崩溃恢复用的心跳，重启即重建',
  'lib/simStateSync.ts': '同步层自身（写影子时间戳与水化回写）',
  'hooks/usePersistedState.ts': '已在 setState 里接入推送',
  'lib/persistedStateStorage.ts': 'usePersistedState / 同步水化共用的原子读写与配额兜底；云端推送仍由调用方负责，仅回收可重建图表缓存，不删除交易数据。',
  'pages/JournalCampaignDetailPage.tsx': '反事实/反向委托的「本地隐藏」是查看偏好，非数据',
  'lib/signalLibrary.ts': '已在 saveSignals 里接入推送',
  'hooks/useCampaignPricePaths.ts': '每场战役的峰值涨幅 / 动态最大回撤是由历史 K 线算出来的可重算缓存（按用户分区）：换设备重算一遍即可，不属于交易状态，账户资产不由它推导。',
  'hooks/useDeepDigRun.ts': 'Deep dig 各特征值的最近一次研究结果：只读研究的展示缓存（按用户分区），可随时重跑重算；不进交易状态，账户资产与战役读数都不由它推导，不需要跨设备同步。特征值定义与手动修改的「规律提取」走 usePersistedState，跟账号同步。',
  'components/journal/deepDig/PatternView.tsx': 'Deep dig「总体模式识别」里写的筛选条件：本机的浏览偏好，按特征值分区；只影响这块描述怎么切，不进交易状态，也不改描述统计、推断统计的数据，不需要跨设备同步。',
  'components/journal/deepDig/SeriesChart.tsx': 'Deep dig 时间序列图「组别」勾选（哪些组画出来）：本机的显示偏好，按特征值分区；不进交易状态，账户资产与研究结果都不由它推导，不需要跨设备同步。',
  'hooks/useUnrealizedChartSnapshot.ts': '涨幅未兑现散点图的展示快照：只用来在行情重算期间先画上次的读数，不进卡片、排序、统计与导出；可重算，按用户与回收站视图分区，不需要跨设备同步。',
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
      // 大块数据（鱼质量、扫描结果、复原扫描）走 accountBlobSync 存到账号，同样算接上了云端。
      if (/queueSimStatePush|noteAccountBlobSaved/.test(content)) continue;
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
