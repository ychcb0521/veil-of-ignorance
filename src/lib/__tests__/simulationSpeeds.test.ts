import { describe, expect, it } from 'vitest';
import {
  MAX_SIMULATION_SPEED,
  QUICK_SIMULATION_SPEEDS,
  SIMULATION_SPEED_OPTIONS,
} from '../simulationSpeeds';
import { REPLAY_SPEEDS } from '@/contexts/ReplayContext';

describe('时间机器倍速档位', () => {
  it('严格升序且唯一——移动端快捷栏取前 4 档，依赖「最前面的最慢」', () => {
    for (let i = 1; i < SIMULATION_SPEED_OPTIONS.length; i++) {
      expect(SIMULATION_SPEED_OPTIONS[i]).toBeGreaterThan(SIMULATION_SPEED_OPTIONS[i - 1]);
    }
    expect(new Set(SIMULATION_SPEED_OPTIONS).size).toBe(SIMULATION_SPEED_OPTIONS.length);
  });

  it('含 1800x / 3600x，且最高档就是 3600x（余量公式与文案都以它为基准）', () => {
    expect(SIMULATION_SPEED_OPTIONS).toContain(1800);
    expect(SIMULATION_SPEED_OPTIONS).toContain(3600);
    expect(MAX_SIMULATION_SPEED).toBe(3600);
  });

  it('只追加不删改：九个旧档位原序仍在最前面', () => {
    expect(SIMULATION_SPEED_OPTIONS.slice(0, 9)).toEqual([1, 2, 5, 10, 30, 60, 180, 300, 900]);
  });

  it('移动端快捷档位仍是 1/2/5/10——追加不该动紧凑栏', () => {
    expect(QUICK_SIMULATION_SPEEDS).toEqual([1, 2, 5, 10]);
  });

  it('不含 50x：那是日志回放 REPLAY_SPEEDS 的档位，两套列表不得合并', () => {
    // 合并会同时改掉复盘 scrubber 的 UI，并让它的 ReplaySpeed 联合类型失效。
    expect(SIMULATION_SPEED_OPTIONS).not.toContain(50);
    expect(REPLAY_SPEEDS).toContain(50);
  });
});
