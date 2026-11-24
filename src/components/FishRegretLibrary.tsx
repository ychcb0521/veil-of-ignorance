import {useEffect, useMemo, useState} from 'react';
import {formatUTC8} from '@/lib/timeFormat';
import {editRegretDirectory, importRegretArchive, loadLegacyRegretAttempts, loadRegretAttempts, loadRegretCatalog, loadRegretRound, type RegretAttempt, type RegretImportReceipt} from '@/lib/fish/parallelUniverseStore';
import {qualityAdditionFills} from '@/lib/fish/qualityAddition';
import {qualityAdditionStopOrder} from '@/lib/fish/qualityAdditionStopOrder';
import {createQualityTemplateDirectory} from '@/lib/fish/qualityTemplateDirectory';
import type {FishQualityStudy} from '@/lib/fish/quality';
import {FishContinuousTable} from './FishContinuousTable';
import {FishScrollBoundary} from './FishScrollBoundary';
import {FishLibraryTimeDirectory, type FishDirectoryItem} from './FishLibraryTimeDirectory';
import {libraryCell} from './FishLibraryDialog';
import {FishQualityMonitorSettingsView} from './FishQualityMonitorSettingsView';

const LEGACY_ID = 'legacy-regret';
const columns = ['标的', '原信号 / 推演起点', '推演方案', '推演结果', '首次满足时间', '推演过程'];
const date = (at?: number | null) => at ? formatUTC8(at) : '—';
const errorText = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
const status = (attempt: RegretAttempt) => attempt.emitted ? '已生成信号' : attempt.proposedSignal ? '候选已有信号' : '未生成信号';
const originalTime = (attempt: RegretAttempt) => attempt.candidate.source.preEntryMonitor?.sourceTime ?? attempt.candidate.source.timeMs;
const attemptKey = (attempt: RegretAttempt) => attempt.id;

function AttemptEvidence({attempt}: {attempt: RegretAttempt}) {
  const {marker, baseline, simulation, proposedSignal} = attempt;
  const fills = qualityAdditionFills(simulation);
  return <details className="min-w-24">
    <summary className="cursor-pointer text-primary">查看</summary>
    <div className="mt-1 max-w-lg space-y-1 whitespace-normal text-muted-foreground">
      <p>推演时间 {date(baseline.evaluatedAt)} · 目标第 {attempt.additionCount} 次加仓</p>
      <p>镜像前终止 {marker ? [date(marker.observedAt), marker.cause?.label, baseline.reason].filter(Boolean).join(' · ') : '未触发'}</p>
      <p>{simulation.reason} · 模拟结束 {date(simulation.endTime)}</p>
      {proposedSignal && <p>信号价格 {proposedSignal.buyPrice} · 委托止损 {proposedSignal.stopPrice}</p>}
      {!!fills.length && <ol className="list-decimal pl-4">
        {fills.map((fill, index) => <li key={index}>
          {date(fill.at)} · {fill.label} · 加仓价 {fill.price} · 委托止损 {qualityAdditionStopOrder({quality_addition_fill: fill})?.price ?? '未记录'}
          {' · 读数 '}{fill.reading} {fill.direction} {fill.threshold}
        </li>)}
      </ol>}
    </div>
  </details>;
}

function RegretRecords({owner, id}: {owner?: string; id: string}) {
  const [rows, setRows] = useState<RegretAttempt[]>([]);
  const [next, setNext] = useState<IDBValidKey>();
  const [request, setRequest] = useState<{before?: IDBValidKey}>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const read = id === LEGACY_ID ? loadLegacyRegretAttempts(owner, request.before) : loadRegretRound(owner, id, request.before);
    void read.then(page => {
      if (!active) return;
      setRows(previous => [...previous, ...page.rows]);
      setNext(page.next);
    }, cause => { if (active) setError(errorText(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [owner, id, request]);
  const read = (before?: IDBValidKey) => {
    setLoading(true);
    setError('');
    setRequest({before});
  };
  return <FishContinuousTable items={rows} getKey={attemptKey} columns={columns.length} resetKey={id}
    label="后悔库推演记录" testId="regret-records" className="max-h-[55dvh]" tableClassName="text-[11px]" estimate={37}
    header={<tr className="bg-muted/40">{columns.map(label => <th key={label} scope="col" className={`${libraryCell} whitespace-nowrap text-left font-medium`}>{label}</th>)}</tr>}
    row={attempt => <tr className="bg-background align-top hover:bg-muted/30" data-testid="regret-attempt-row">
      <td className={`${libraryCell} font-mono`}>{attempt.candidate.source.symbol}</td>
      <td className={`${libraryCell} whitespace-nowrap`}>{date(originalTime(attempt))}{attempt.candidate.enteredAt !== originalTime(attempt) && <><br/><span className="text-muted-foreground">{date(attempt.candidate.enteredAt)}</span></>}</td>
      <td className={libraryCell}>{attempt.plan.label}</td>
      <td className={`${libraryCell} whitespace-nowrap ${attempt.emitted ? 'text-emerald-600' : 'text-muted-foreground'}`}>{status(attempt)}</td>
      <td className={`${libraryCell} whitespace-nowrap`}>{date(attempt.proposedSignal?.time)}</td>
      <td className={libraryCell}><AttemptEvidence attempt={attempt}/></td>
    </tr>}
    empty={!loading && !error && <p className="px-3 py-4 text-xs text-muted-foreground">暂无推演记录。</p>}
    footer={loading ? <p role="status" className="px-3 py-2 text-xs text-muted-foreground">正在读取归档…</p>
      : error ? <p role="alert" className="px-3 py-2 text-xs text-destructive">{error} <button type="button" className="underline" onClick={() => read(request.before)}>重试读取</button></p>
      : next ? <FishScrollBoundary key={rows.length} onReach={() => read(next)}/> : null}/>;
}

async function downloadHistory(owner?: string) {
  const {buildXlsx} = await import('@/lib/xlsxWorkbook');
  const rows = [];
  let before: IDBValidKey | undefined;
  do {
    const page = await loadRegretAttempts(owner, before);
    before = page.next;
    for (const attempt of page.rows) rows.push([
      attempt.candidate.source.symbol, date(originalTime(attempt)), date(attempt.candidate.enteredAt),
      attempt.plan.label, status(attempt), date(attempt.proposedSignal?.time), date(attempt.baseline.evaluatedAt),
      date(attempt.marker?.observedAt), attempt.simulation.reason, attempt.proposedSignal?.buyPrice, attempt.proposedSignal?.stopPrice,
    ]);
  } while (before);
  if (!rows.length) throw Error('暂无可导出的记录');
  const headers = [columns[0], '原信号时间', '推演起点', ...columns.slice(2, 5), '推演时间', '镜像前终止时间', '模拟结果', '信号价格', '委托止损'];
  const blob = buildXlsx([{name: '后悔库', columns: headers.map(header => ({header, width: 24})), rows}]);
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  try {
    link.href = url;
    link.download = '后悔库.xlsx';
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function FishRegretLibrary({owner, revision, templates}: {
  owner?: string; revision: number; templates?: FishQualityStudy['planTemplates'];
}) {
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof loadRegretCatalog>>>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [receipt, setReceipt] = useState<RegretImportReceipt>();
  const importFile = async (file: File) => {
    if (!owner || importing) return;
    setImporting(true);
    setImportError('');
    setReceipt(undefined);
    try {
      const {readRegretArchive} = await import('@/lib/fish/regretArchive');
      setReceipt(await importRegretArchive(owner, await readRegretArchive(file)));
      setRetry(n => n + 1);
    } catch (cause) { setImportError(errorText(cause)); }
    finally { setImporting(false); }
  };
  useEffect(() => {
    if (!open) return;
    let active = true;
    setError('');
    void loadRegretCatalog(owner).then(value => { if (active) setCatalog(value); },
      cause => { if (active) setError(errorText(cause)); });
    return () => { active = false; };
  }, [open, owner, revision, retry]);
  const rounds = catalog?.rounds;
  const items = useMemo(() => {
    const directory = createQualityTemplateDirectory({planTemplates: templates}, true);
    const entries: FishDirectoryItem[] = (rounds ?? []).map(round => ({
      id: round.id, at: round.startedAt, label: '推演轮次',
      summary: `${round.done} / ${round.total} 条 · ${round.emitted} 条生成信号`,
      templateGroup: directory.groupPlans([round.plan]),
      settings: () => <>
        <p>第 {round.additionCount} 次加仓生成信号 · 观察时长 {round.observeHours} 小时</p>
        <FishQualityMonitorSettingsView plan={round.plan} savedOnly/>
      </>,
      content: () => <RegretRecords key={`${round.id}:${round.done}`} owner={owner} id={round.id}/>,
    }));
    if (catalog?.legacy) entries.push({
      id: LEGACY_ID, at: 0, label: '历史推演', summary: '旧版归档',
      content: () => <RegretRecords key={LEGACY_ID} owner={owner} id={LEGACY_ID}/>,
    });
    return entries;
  }, [rounds, catalog?.legacy, owner, templates]);
  const edit = async (id: string, change: {name: string} | {hidden: boolean}) => {
    const edits = await editRegretDirectory(owner, id, change);
    setCatalog(value => value && {...value, edits});
    return true;
  };
  return <FishLibraryTimeDirectory name="后悔库" prefix="regret" kind="template" browseRounds selectBeforeLoad
    dataActions={owner && <label className="inline-flex items-center gap-2 text-xs">
      导入推演归档
      <input type="file" aria-label="导入推演归档" accept=".zip,application/zip" className="max-w-56 text-xs" disabled={importing}
        onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void importFile(file); }}/>
    </label>}
    notice={importing ? <p role="status" className="text-xs">正在校验并导入推演归档…</p>
      : importError ? <p role="alert" className="text-xs text-destructive">{importError}</p>
      : receipt ? <p role="status" data-testid="regret-import-receipt" className="text-xs">
        {receipt.alreadyImported ? '该归档已导入，本次新增 0 条。' : '归档导入成功。'}轮次 {receipt.round.id} · 已核验 {receipt.round.done} / {receipt.round.total} 条 ·
        模拟命中 {receipt.proposed} 条 · 本轮去重后新增 {receipt.round.emitted} 条
      </p> : undefined}
    onOpenChange={setOpen} items={items} edits={catalog?.edits} onRename={(id, name) => edit(id, {name})}
    onSetHidden={(id, hidden) => edit(id, {hidden})}
    description={visible => `${visible.filter(item => !catalog?.edits[item.id]?.hidden && item.id !== LEGACY_ID).length} 轮推演${catalog?.legacy && !catalog.edits[LEGACY_ID]?.hidden ? ' · 含历史推演' : ''}`}
    loading={open && !catalog && !error} loadError={error} onRetry={() => setRetry(value => value + 1)}
    recordCount={(rounds ?? []).reduce((count, round) => count + round.done, 0) + Number(!!catalog?.legacy)}
    download={() => downloadHistory(owner)} empty="暂无推演记录。"
    info={<p>按轮次或冻结模板查看推演结果。旧版记录归在历史推演中。</p>}/>;
}
