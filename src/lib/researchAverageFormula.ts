/** Shared named averages; keep the existing 24h and four 6h blocks verbatim. */
export function appendResearchAverages(formula: string, names: ReadonlySet<string>, series: { core: string; avg: string; avg2: string }): string {
  const extra: string[] = [];
  if (!names.has(series.avg)) extra.push(`${series.avg} = avg(${series.core}, 24)`);
  if (!names.has(series.avg2)) {
    let helper = '_chart_m6';
    while (names.has(helper)) helper += '_';
    extra.push(`${helper} = avg(${series.core}, 6)`, `${series.avg2} = (4 * ${helper} + 3 * ago(${helper}, 6) + 2 * ago(${helper}, 12) + ago(${helper}, 18)) / 10`);
  }
  return [formula, ...extra].join('\n');
}
