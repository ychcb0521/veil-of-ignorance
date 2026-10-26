/**
 * 列表勾选的 Shift 连选：先点一行，再按住 Shift 点另一行，两行之间（含两端）按后点这一行的新状态一起勾上或取消。
 * 【用户要求】2026-10-26「鱼质量那里卖出比较的列表，我希望可以批量选中，比如按住 shift 就可以进行连续选择」
 * order 是屏幕上的行序（筛选、排序之后的全部行，不只是滚动窗口里画出来的那几行）。
 * 没有起点、起点已不在当前列表里、或没按 Shift 时，只切换这一行。
 */
export function rangeSelect(order: readonly string[], selected: ReadonlySet<string>, anchor: string | null, target: string, checked: boolean, shift: boolean): string[] {
  const next = new Set(selected);
  const from = shift && anchor != null ? order.indexOf(anchor) : -1, to = order.indexOf(target);
  if (from < 0 || to < 0) {
    if (checked) next.add(target); else next.delete(target);
    return [...next];
  }
  for (const id of order.slice(Math.min(from, to), Math.max(from, to) + 1)) { if (checked) next.add(id); else next.delete(id); }
  return [...next];
}
