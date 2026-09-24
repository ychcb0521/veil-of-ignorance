export type CampaignExportTarget = { id: string; title: string };

/** 下载队列：先按当前排序；被当前排序口径筛掉、但仍在日期范围内的已选战役排在队尾（各一次）。 */
export function orderedCampaignExportTargets(
  selected: ReadonlySet<string>, sorted: readonly CampaignExportTarget[], scope: readonly CampaignExportTarget[],
): CampaignExportTarget[] {
  const allowed = new Map(scope.map(item => [item.id, item]));
  const seen = new Set<string>();
  return [...sorted, ...scope].flatMap(item => {
    if (!selected.has(item.id) || !allowed.has(item.id) || seen.has(item.id)) return [];
    seen.add(item.id);
    return [allowed.get(item.id)!];
  });
}

export function toggleCampaignSelection(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

export function retainCampaignSelection(selected: ReadonlySet<string>, allowedIds: ReadonlySet<string>): ReadonlySet<string> {
  if ([...selected].every(id => allowedIds.has(id))) return selected;
  return new Set([...selected].filter(id => allowedIds.has(id)));
}

export function numberedCampaignPngName(fileName: string, index: number, total: number): string {
  const prefix = String(index + 1).padStart(Math.max(3, String(total).length), '0');
  // 渲染端已清理过文件名；进 ZIP 前再挡一次路径分隔符与控制字符。
  const safeName = Array.from(fileName, char => char.charCodeAt(0) < 32 || char === '/' || char === '\\' ? '_' : char).join('');
  return `${prefix}_${safeName}`;
}

/**
 * 批量下载的 ZIP 文件名：交易战役_20260924-1010_12张.zip。
 * 时间取本批的导出时刻（与图里「导出时间」同为本机时区）；只有分包时才带「第 N 包」。
 */
export function campaignZipFileName({ exportedAt, count, part, split }: {
  exportedAt: string;
  count: number;
  part: number;
  split: boolean;
}): string {
  const date = new Date(exportedAt);
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = Number.isFinite(date.getTime())
    ? `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`
    : '未知时间';
  return `交易战役_${stamp}${split ? `_第${part}包` : ''}_${count}张.zip`;
}
