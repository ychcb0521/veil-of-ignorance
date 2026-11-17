/** Shared named averages; keep the existing 24h and four 6h blocks verbatim. */
export function appendResearchAverages(formula: string, names: ReadonlySet<string>, series: { core: string; avg: string; avg2: string }, hours = 24): string {
  const extra: string[] = [];
  const quarter = hours / 4;
  if (!names.has(series.avg)) extra.push(`${series.avg} = avg(${series.core}, ${hours})`);
  if (!names.has(series.avg2)) {
    let helper = '_chart_m6';
    while (names.has(helper)) helper += '_';
    extra.push(`${helper} = avg(${series.core}, ${quarter})`, `${series.avg2} = (4 * ${helper} + 3 * ago(${helper}, ${quarter}) + 2 * ago(${helper}, ${2 * quarter}) + ago(${helper}, ${3 * quarter})) / 10`);
  }
  return [formula, ...extra].join('\n');
}
