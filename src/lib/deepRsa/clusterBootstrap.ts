import { mulberry32 } from './grouping';

/** 按簇（标的）整簇有放回重抽样的百分位区间；同一个币的事件一起进出，区间不会因同币相关而偏窄。 */
export function clusterBootstrapCi(
  stat: (idx: readonly number[]) => number,
  clusters: readonly string[],
  options: { reps: number; seed: number },
): [number, number] | null {
  const byCluster = new Map<string, number[]>();
  clusters.forEach((c, i) => { const list = byCluster.get(c) ?? []; list.push(i); byCluster.set(c, list); });
  const groups = [...byCluster.values()];
  if (groups.length < 3 || options.reps <= 0) return null;
  const rand = mulberry32(options.seed);
  const stats: number[] = [];
  for (let t = 0; t < options.reps; t++) {
    const idx: number[] = [];
    for (let k = 0; k < groups.length; k++) idx.push(...groups[Math.floor(rand() * groups.length)]);
    const s = stat(idx);
    if (Number.isFinite(s)) stats.push(s);
  }
  if (stats.length < 10) return null;
  stats.sort((a, b) => a - b);
  const at = (q: number) => stats[Math.min(stats.length - 1, Math.max(0, Math.floor(q * (stats.length - 1))))];
  return [at(0.025), at(0.975)];
}

