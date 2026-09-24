import { Fragment, useEffect, useRef, useState } from 'react';
import { Check, Download, Loader2, Package, Pause, Play, RotateCcw, TriangleAlert } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CampaignBatchExportWorker } from './CampaignBatchExportWorker';
import {
  createCampaignBatchExportSnapshot,
  type CampaignBatchExportResult,
  type CampaignBatchExportSnapshot,
} from '@/lib/campaignBatchExportContext';
import { buildCampaignPngZip } from '@/lib/campaignPngZip';
import { boardUsesChartInterval, type CampaignBoardExportSections } from '@/lib/campaignLegsPngExport';
import type { CampaignChartInterval } from '@/lib/campaignChartContentSpan';
import { campaignZipFileName, numberedCampaignPngName, type CampaignExportTarget } from '@/lib/campaignBatchSelection';

type Options = { interval: 'auto' | CampaignChartInterval; sections: CampaignBoardExportSections };
/**
 * running：正在逐场生成；paused：用户暂停；budget：已生成图片达到内存预算，先下载本包才能继续；
 * idle：本轮队列已走完（可能还有失败项或暂停时没轮到的）。
 */
type RunStatus = 'running' | 'paused' | 'budget' | 'idle';
type Run = {
  /** 每次开始 / 继续 / 重试都换一代：旧一代工人迟到的回报一律丢弃。 */
  generation: number;
  targets: readonly CampaignExportTarget[];
  queue: readonly string[];
  index: number;
  /** 已生成、还在内存里等打包的图。 */
  outputs: Map<string, CampaignBatchExportResult>;
  /**
   * 分包运行里已经随前几包下载走、从内存放掉的图：id → 第几包（及无 K 线说明、盘面实际周期）。
   * part 0：分包前随整批 ZIP 下载过的图（不属于任何一包，队列里照旧标「已下载」）。
   */
  packed: Map<string, { part: number } & Pick<CampaignBatchExportResult, 'chartOmitted' | 'peakFallback' | 'chartInterval'>>;
  failures: Map<string, string>;
  options: Options;
  snapshot: CampaignBatchExportSnapshot;
  status: RunStatus;
  part: number;
  /** 账户样本缺场的说明：整批共用一份样本，任何一场报回来就记下，在进度区显示一次。 */
  sampleNote?: string;
};
/** downloaded：已随不分包的整批 ZIP 交给浏览器（没分过包时图仍在内存里，可以再下载一次）；packed：已在第 N 包。 */
type RowState = 'waiting' | 'running' | 'done' | 'downloaded' | 'packed' | 'failed';

const SECTIONS = [
  { key: 'metadata', label: '战役原数据' },
  { key: 'overview', label: '盈亏概览' },
  { key: 'emotionDiary', label: '操作日情绪日记', hint: '私人记录，分享前可取消；没有日记的战役不画这一块' },
  { key: 'chart', label: 'K 线盘面' },
  { key: 'legs', label: '完整 Legs 列表' },
] as const;
const INTERVALS: Array<{ value: Options['interval']; label: string; hint: string }> = [
  { value: 'auto', label: '自动', hint: '按每场战役自身的时长各自选周期（与详情页首屏同一套选法；详情页里已保存的反事实分支撑宽的视窗不计入）' },
  { value: '1m', label: '1分钟', hint: '统一用 1 分钟线；某场战役的盘面放不下这么多根时自动放宽，队列里标出实际周期' },
  { value: '5m', label: '5分钟', hint: '统一用 5 分钟线；某场战役的盘面放不下这么多根时自动放宽，队列里标出实际周期' },
  { value: '15m', label: '15分钟', hint: '统一用 15 分钟线；某场战役的盘面放不下这么多根时自动放宽，队列里标出实际周期' },
  { value: '1h', label: '1小时', hint: '统一用 1 小时线' },
];
/** 已生成、尚未打包的图片累计到这个量就暂停分包：几百张高清 PNG 同时躺在内存里会拖垮标签页。 */
const MAX_READY_BYTES = 256 * 1024 * 1024;
/** 单场（读数 + 拉 K 线 + 画图）最长等待；首场还要读整个账户的样本，留足余量。 */
const CAMPAIGN_TIMEOUT_MS = 150_000;
const intervalLabel = (value: Options['interval'] | undefined) => INTERVALS.find(item => item.value === value)?.label ?? '';
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const MIB = 1024 * 1024;
const formatBytes = (bytes: number) => (bytes >= MIB ? `${Number((bytes / MIB).toFixed(1))} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const BUTTON = 'inline-flex h-8 shrink-0 items-center gap-1.5 rounded border px-3 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/70';
const SECONDARY = `${BUTTON} border-border bg-card text-foreground/85 hover:bg-accent`;
const PRIMARY = `${BUTTON} border-transparent bg-[#F0B90B] font-medium text-black hover:opacity-90`;

/**
 * 账户样本缺场的说明拆成两段：前半句（缺了哪几场，可以在中间换行）与「不对称风险贡献按其余 N 场计算。」（整句不折行）。
 * 窄屏上换行只落在「），」之后，不会把「不对称」拆成「不 / 对称」。
 */
function splitSampleNote(note: string): [string, string] {
  const at = note.lastIndexOf('不对称风险贡献');
  return at > 0 ? [note.slice(0, at), note.slice(at)] : [note, ''];
}

function rowStateOf(run: Run | null, id: string, activeId: string | undefined, downloadedIds?: ReadonlySet<string>): RowState {
  if (!run) return 'waiting';
  if (activeId === id) return 'running';
  if (run.outputs.has(id)) return downloadedIds?.has(id) ? 'downloaded' : 'done';
  if (run.packed.has(id)) return run.packed.get(id)!.part > 0 ? 'packed' : 'downloaded';
  if (run.failures.has(id)) return 'failed';
  return 'waiting';
}

export function CampaignBatchExportDialog({ campaigns, userId, currentAccountEquity, onClose, onReturnFocus }: {
  campaigns: readonly CampaignExportTarget[];
  userId: string;
  currentAccountEquity: number | null;
  /** allDownloaded：每一场都已进了下载的 ZIP（没有失败、没有落下），列表页据此退出选择模式。 */
  onClose: (outcome: { allDownloaded: boolean }) => void;
  /**
   * 弹窗卸载后把键盘焦点交还给列表页（打开它的「下载选中」，或退出选择模式后的「批量下载」开关）。
   * 这个弹窗没有 DialogTrigger：Radix 默认去聚焦的 trigger 是空的，不接管的话焦点会掉到 <body>。
   */
  onReturnFocus?: () => void;
}) {
  const [interval, setIntervalOption] = useState<Options['interval']>('auto');
  const [sections, setSections] = useState<Required<CampaignBoardExportSections>>({
    metadata: true, overview: true, emotionDiary: true, chart: true, legs: true,
  });
  const [run, setRun] = useState<Run | null>(null);
  const [packing, setPacking] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  /** 最近一次发起下载的 ZIP：文件名与其中的战役；关闭时据此判断还有没有没下载的图。 */
  const [lastZip, setLastZip] = useState<{ name: string; ids: ReadonlySet<string> } | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const generation = useRef(0);
  const alive = useRef(true);
  const packAbort = useRef<AbortController | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const activeId = run?.status === 'running' ? run.queue[run.index] : undefined;
  const anySection = SECTIONS.some(({ key }) => sections[key]);
  /** K 线盘面与盈亏概览都不画时，周期既不进图、也不拉 K 线：周期单选调暗停用。 */
  const intervalMatters = boardUsesChartInterval(sections);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; packAbort.current?.abort(); };
  }, []);

  const finish = (id: string, token: number, output?: CampaignBatchExportResult, error?: string) => {
    if (!alive.current) return;
    setRun(current => {
      if (!current || current.generation !== token || current.status !== 'running' || current.queue[current.index] !== id) return current;
      const outputs = new Map(current.outputs);
      const failures = new Map(current.failures);
      if (output) { outputs.set(id, output); failures.delete(id); } else failures.set(id, error ?? '生成失败');
      const index = current.index + 1;
      const bytes = [...outputs.values()].reduce((sum, file) => sum + file.blob.size, 0);
      const more = index < current.queue.length;
      return {
        ...current, outputs, failures, index, sampleNote: output?.sampleNote ?? current.sampleNote,
        status: !more ? 'idle' : bytes >= MAX_READY_BYTES ? 'budget' : 'running',
      };
    });
  };

  // 每场一个计时器：工人卡住（接口不回、画布不就绪）时记为失败并接着下一场，不让整批停在半路。
  // 只计本页可见的时间：切到别的标签页时浏览器暂停逐帧绘制，K 线盘面要等回到本页才画得完，
  // 这段时间不能算进 150 秒，否则离开一会儿回来，整批都成了「超时失败」。
  useEffect(() => {
    if (!activeId || !run) return;
    const token = run.generation;
    let remaining = CAMPAIGN_TIMEOUT_MS;
    let armedAt = 0;
    let timer: number | undefined;
    const arm = () => {
      if (timer !== undefined || document.hidden) return;
      armedAt = Date.now();
      timer = window.setTimeout(
        () => finish(activeId, token, undefined, '读取或绘制超过 150 秒，已跳过；可稍后重试'),
        remaining,
      );
    };
    const disarm = () => {
      if (timer === undefined) return;
      window.clearTimeout(timer);
      timer = undefined;
      remaining = Math.max(0, remaining - (Date.now() - armedAt));
    };
    const onVisibilityChange = () => (document.hidden ? disarm() : arm());
    arm();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (timer !== undefined) window.clearTimeout(timer);
    };
    // 只随「哪一场、哪一代」重新计时；进度刷新不重置计时器。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, run?.generation]);

  useEffect(() => {
    if (activeId) rowRefs.current.get(activeId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId]);

  const pendingIds = run
    ? run.targets.filter(item => !run.outputs.has(item.id) && !run.packed.has(item.id) && !run.failures.has(item.id)).map(item => item.id)
    : [];
  const failedIds = run ? run.targets.filter(item => run.failures.has(item.id)).map(item => item.id) : [];

  const start = () => {
    if (run || !campaigns.length || !anySection) return;
    const targets = campaigns.map(item => ({ ...item }));
    setRun({
      generation: ++generation.current, targets, queue: targets.map(item => item.id), index: 0,
      outputs: new Map(), packed: new Map(), failures: new Map(),
      options: { interval, sections: { ...sections } },
      snapshot: createCampaignBatchExportSnapshot({ exportedAt: new Date().toISOString(), currentAccountEquity }),
      status: 'running', part: 1,
    });
  };
  /** 把指定的几场（按原顺序）重新排进队列：继续生成、重试失败项、单场重试都走这里。 */
  const requeue = (ids: readonly string[]) => {
    setArchiveError(null);
    setRun(current => {
      if (!current || current.status === 'running' || current.status === 'budget') return current;
      const wanted = new Set(ids);
      const queue = current.targets.filter(item => wanted.has(item.id)).map(item => item.id);
      if (!queue.length) return current;
      const failures = new Map(current.failures);
      for (const id of queue) failures.delete(id);
      return { ...current, generation: ++generation.current, queue, index: 0, failures, status: 'running' };
    });
  };
  const pause = () => setRun(current => (current?.status === 'running' ? { ...current, status: 'paused' } : current));
  const cancelPacking = () => packAbort.current?.abort();

  const download = async (mode: 'all' | 'part') => {
    if (!run || !run.outputs.size || packing) return;
    // 分包运行（这次是「下载第 N 包」，或之前已经放掉过一包）：每一包只装还没下载过的图、包号顺延，
    // 装进去的图随即从内存放掉——最后一包下完再重试补上的几场，下一次下载是新的一包，不会把已下载的图再装一遍。
    // 从没分过包的整批下载照旧装全部已生成的图（重试补上几场后再下载，得到的是一份完整的 ZIP），图留在内存里可以再下载。
    const split = mode === 'part' || run.packed.size > 0;
    const downloadedBefore = lastZip?.ids;
    const ids = new Set([...run.outputs.keys()].filter(id => !split || !downloadedBefore?.has(id)));
    if (!ids.size) return;
    const controller = new AbortController();
    packAbort.current = controller;
    setPacking(true);
    setArchiveError(null);
    try {
      const files = run.targets.flatMap((target, index) => {
        const output = ids.has(target.id) ? run.outputs.get(target.id) : undefined;
        return output ? [{ name: numberedCampaignPngName(output.fileName, index, run.targets.length), blob: output.blob }] : [];
      });
      const blob = await buildCampaignPngZip(files, { exportedAt: run.snapshot.exportedAt, signal: controller.signal });
      if (!alive.current || controller.signal.aborted) return;
      const name = campaignZipFileName({ exportedAt: run.snapshot.exportedAt, count: files.length, part: run.part, split });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setLastZip({ name, ids });
      if (split) {
        // 本包已交给浏览器：图从内存里放掉，记下各在第几包；此前随整批 ZIP 下载过、还留在内存里的图（part 0）一并放掉。
        setRun(current => {
          if (!current) return current;
          const packed = new Map(current.packed);
          const outputs = new Map(current.outputs);
          for (const [id, output] of current.outputs) {
            const part = ids.has(id) ? current.part : downloadedBefore?.has(id) ? 0 : null;
            if (part == null) continue;
            packed.set(id, { part, chartOmitted: output.chartOmitted, peakFallback: output.peakFallback, chartInterval: output.chartInterval });
            outputs.delete(id);
          }
          const next: Run = { ...current, outputs, packed, part: current.part + 1 };
          if (mode !== 'part') return next;
          // 「下载第 N 包并继续」：接着生成还没轮到的战役
          const queue = current.targets
            .filter(item => !packed.has(item.id) && !outputs.has(item.id) && !current.failures.has(item.id))
            .map(item => item.id);
          return { ...next, queue, index: 0, generation: ++generation.current, status: queue.length ? 'running' : 'idle' };
        });
      }
    } catch (error) {
      if (alive.current && !controller.signal.aborted) setArchiveError(errorText(error));
    } finally {
      if (alive.current) setPacking(false);
      if (packAbort.current === controller) packAbort.current = null;
    }
  };

  const unsavedCount = run ? [...run.outputs.keys()].filter(id => !lastZip?.ids.has(id)).length : 0;
  const busy = run?.status === 'running' || packing;
  const allDownloaded = run != null && run.targets.every(item => run.packed.has(item.id) || Boolean(lastZip?.ids.has(item.id)));
  const close = () => {
    packAbort.current?.abort();
    alive.current = false;
    onClose({ allDownloaded });
  };
  const requestClose = () => {
    if (busy || unsavedCount > 0) setConfirmClose(true);
    else close();
  };

  const doneCount = (run?.outputs.size ?? 0) + (run?.packed.size ?? 0);
  const failedCount = run?.failures.size ?? 0;
  const total = campaigns.length;
  const donePercent = total ? (doneCount / total) * 100 : 0;
  const failedPercent = total ? (failedCount / total) * 100 : 0;
  const activeTitle = activeId ? run?.targets.find(item => item.id === activeId)?.title : undefined;
  const finishedResults = run ? [...run.outputs.values(), ...run.packed.values()] : [];
  /** 交易所没有 K 线的场数：画了盘面的写「盘面从略」，只画盈亏概览的写峰值浮盈兜底（同一批设置相同，只会是其中一种）。 */
  const omittedCount = finishedResults.filter(item => item.chartOmitted || item.peakFallback).length;
  /** 指定周期对这一场过细、盘面放宽到了更粗的周期（「自动」本来就按每场各自选，不算）。 */
  const widenedInterval = (actual: CampaignChartInterval | undefined) => (
    run && run.options.interval !== 'auto' && actual && actual !== run.options.interval ? actual : null
  );
  const widenedCount = finishedResults.filter(item => widenedInterval(item.chartInterval)).length;

  /**
   * 状态句按意群分段，每段自己不折行：窄屏换行只落在逗号之后，不会剩「图片。」两个字孤零零挂到下一行。
   * 「或先下载已生成的图片」只在确有没下载的图时才说。
   */
  let statusSegments: string[] = [];
  const statusTruncates = run?.status === 'running' && !packing;
  if (run) {
    if (packing) statusSegments = ['正在打包 ZIP…'];
    else if (run.status === 'running') statusSegments = [`正在生成：${activeTitle ?? '…'}`];
    else if (run.status === 'paused') statusSegments = ['已暂停，', '已生成的图片仍保留。'];
    else if (run.status === 'budget') {
      statusSegments = [`已生成的图片接近 ${formatBytes(MAX_READY_BYTES)}，`, `先下载第 ${run.part} 包，`, `再接着生成剩下的 ${pendingIds.length} 场。`];
    } else if (failedIds.length) {
      statusSegments = unsavedCount > 0
        ? [`${failedIds.length} 场没能生成，`, '可以重试，', '或先下载已生成的图片。']
        : [`${failedIds.length} 场没能生成，`, '可以重试。'];
    } else if (pendingIds.length) statusSegments = [`还有 ${pendingIds.length} 场没有生成。`];
    else if (allDownloaded) statusSegments = ['全部图片已下载。'];
    else statusSegments = ['全部生成完毕，', '可以下载 ZIP。'];
  }
  const statusLine = statusSegments.join('');
  const [sampleNoteHead, sampleNoteTail] = run?.sampleNote ? splitSampleNote(run.sampleNote) : ['', ''];

  return (
    <Dialog open onOpenChange={open => { if (!open) requestClose(); }}>
      <DialogContent
        className="flex max-h-[88vh] w-[calc(100%-1.5rem)] max-w-[600px] flex-col gap-0 overflow-hidden rounded-lg p-0"
        data-testid="campaign-batch-export-dialog"
        onCloseAutoFocus={event => {
          // Esc、取消、关闭、右上角叉、丢弃并关闭都走这里（弹窗卸载时）：焦点交给列表页安排，不落到 <body>
          if (!onReturnFocus) return;
          event.preventDefault();
          onReturnFocus();
        }}
      >
        {/* 手机上 DialogHeader 默认居中，这里一律左对齐：说明文字换行后不跳成两种对齐 */}
        <DialogHeader className="border-b border-border px-5 py-4 pr-12 text-left">
          <DialogTitle className="flex items-center gap-2 text-[14px] font-medium">
            <Download aria-hidden="true" className="h-4 w-4 text-[#C98500] dark:text-[#F0B90B]" />
            批量下载交易战役
          </DialogTitle>
          <DialogDescription className="text-[11px] leading-[1.7]">
            已选 <span className="font-mono tabular-nums text-foreground/85">{total}</span> 场 · 每场一张 PNG，按列表当前排序编号后打包成 ZIP；只读导出，不改动任何记录。
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {!run ? (
            <>
              <fieldset className="space-y-2">
                <legend className="mb-2 text-[10px] font-medium text-muted-foreground">图片内容</legend>
                <div className="flex flex-wrap gap-1.5">
                  {SECTIONS.map(item => (
                    <label
                      key={item.key}
                      title={'hint' in item ? item.hint : undefined}
                      className={`inline-flex h-7 cursor-pointer select-none items-center gap-1.5 rounded border px-2 text-[11px] transition-colors ${
                        sections[item.key]
                          ? 'border-[#F0B90B]/45 bg-[#F0B90B]/[0.07] text-foreground'
                          : 'border-border/80 text-muted-foreground hover:border-border hover:text-foreground/85'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="h-3 w-3 shrink-0 accent-[#F0B90B] dark:[color-scheme:dark]"
                        checked={sections[item.key]}
                        onChange={event => setSections(previous => ({ ...previous, [item.key]: event.target.checked }))}
                      />
                      {item.label}
                    </label>
                  ))}
                </div>
                {!anySection ? (
                  <p role="alert" className="text-[10px] text-[#F6465D]">至少选择一项内容。</p>
                ) : sections.emotionDiary ? (
                  <p className="text-[10px] text-muted-foreground/75">情绪日记是私人记录，分享前可以取消；没有日记的战役不画这一块。</p>
                ) : null}
              </fieldset>

              <fieldset disabled={!intervalMatters} data-testid="campaign-batch-interval">
                <legend className="mb-2 text-[10px] font-medium text-muted-foreground">
                  K 线周期
                  {!intervalMatters && (
                    <span data-testid="campaign-batch-interval-unused" className="ml-2 font-normal text-muted-foreground/70">
                      未画 K 线盘面与盈亏概览，不用周期
                    </span>
                  )}
                </legend>
                <div className={intervalMatters ? undefined : 'pointer-events-none select-none opacity-40'}>
                  <div role="radiogroup" aria-label="批量导出 K 线周期" className="inline-flex overflow-hidden rounded border border-border/80 text-[11px]">
                    {INTERVALS.map(item => (
                      <label
                        key={item.value}
                        title={item.hint}
                        className={`cursor-pointer border-l border-border/80 px-2.5 py-1 transition-colors first:border-l-0 has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-ring/70 ${
                          interval === item.value
                            ? 'bg-[#F0B90B]/[0.12] font-medium text-foreground'
                            : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground/85'
                        }`}
                      >
                        <input
                          type="radio"
                          name="campaign-batch-interval"
                          value={item.value}
                          className="sr-only"
                          checked={interval === item.value}
                          onChange={() => setIntervalOption(item.value)}
                        />
                        {item.label}
                      </label>
                    ))}
                  </div>
                  <p className="mt-2 text-[10px] leading-[1.7] text-muted-foreground/75">
                    盘面取完整战役及前后上下文，不沿用详情页里手动拖动的视窗。指定周期是下限：某场战役的盘面放不下那么多根时自动放宽，队列里标出实际周期。交易所没有 K 线的战役照常导出，图里写明原因。
                  </p>
                </div>
              </fieldset>
            </>
          ) : (
            <div className="space-y-2" data-testid="campaign-batch-progress">
              {/* 状态句是操作指引（分包后还剩几场、可以先下载已生成的），窄屏上照常换行读全（只在分段处换行）；
                  只有「正在生成：标题」一行截断，完整标题放在 title 里 */}
              <div className="flex items-start justify-between gap-3 text-[11px] leading-[1.6]">
                <span
                  className={`min-w-0 flex-1 text-muted-foreground ${statusTruncates ? 'truncate' : 'text-pretty'}`}
                  title={statusTruncates ? statusLine : undefined}
                  role="status"
                  aria-live="polite"
                  data-testid="campaign-batch-status"
                >
                  {statusTruncates ? statusLine : statusSegments.map((segment, index) => (
                    <span key={index} className="whitespace-nowrap">{segment}</span>
                  ))}
                </span>
                <span className="shrink-0 font-mono tabular-nums text-foreground/85">
                  {doneCount}/{total}
                  {failedCount > 0 && <span className="text-[#F6465D]"> · 失败 {failedCount}</span>}
                </span>
              </div>
              <div
                role="progressbar"
                aria-label="批量生成进度"
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={doneCount + failedCount}
                className="flex h-1 overflow-hidden rounded-full bg-muted"
              >
                {/* 已生成（琥珀）与失败（红）分两段：一眼看出走完的这一截里有几场没成 */}
                <div className="h-full bg-[#F0B90B] transition-[width] duration-300 ease-out" style={{ width: `${donePercent}%` }} />
                <div className="h-full bg-[#F6465D]/70 transition-[width] duration-300 ease-out" style={{ width: `${failedPercent}%` }} />
              </div>
              {/* 每一项不在词中间折行（窄屏上不会出现「周 / 期」这种断法），只在分隔号处换行；
                  窄屏上「周期…」固定另起一行，行首不会挂着一根孤零零的分隔竖线 */}
              <p className="text-[10px] leading-[1.7] text-muted-foreground/70">
                {SECTIONS.filter(({ key }) => run.options.sections[key] !== false).map(({ key, label }, index) => (
                  <Fragment key={key}>{index ? ' · ' : ''}<span className="whitespace-nowrap">{label}</span></Fragment>
                ))}
                {/* 与图里一致：K 线盘面与盈亏概览都没画时，图里不写周期，这里也不写 */}
                {boardUsesChartInterval(run.options.sections) && (
                  <>
                    <span className="max-sm:hidden">{' ｜ '}</span><br className="sm:hidden" />
                    <span className="whitespace-nowrap">周期 {intervalLabel(run.options.interval)}</span>
                  </>
                )}
                {widenedCount > 0 && <>{' ｜ '}<span className="whitespace-nowrap">{widenedCount} 场盘面放不下，已放宽周期</span></>}
                {omittedCount > 0 && <>{' ｜ '}<span className="whitespace-nowrap">
                  {omittedCount} 场交易所没有 K 线，{run.options.sections.chart !== false ? '盘面从略' : '峰值浮盈按已实现盈亏兜底'}
                </span></>}
              </p>
              {run.sampleNote && (
                <p data-testid="campaign-batch-sample-note" className="flex items-start gap-1.5 text-[10px] leading-[1.6] text-[#C98500] dark:text-[#F0B90B]">
                  <TriangleAlert aria-hidden="true" className="mt-[3px] h-3 w-3 shrink-0" />
                  {/* 后两句各自不在中间折行：窄屏上不会把「不对称」拆开，也不会剩「注明。」两个字挂到下一行 */}
                  <span>
                    {sampleNoteHead}
                    {sampleNoteTail && <span className="whitespace-nowrap">{sampleNoteTail}</span>}
                    <span className="whitespace-nowrap">图中「盈亏概览」下已注明。</span>
                  </span>
                </p>
              )}
              {run.status === 'running' && (
                <p className="text-[10px] text-muted-foreground/60">生成时请停留在本页：切到其他标签页时浏览器会暂停绘图，回来后接着生成。</p>
              )}
            </div>
          )}

          <section aria-label="下载顺序与状态">
            <div className="mb-1.5 flex items-baseline justify-between text-[10px] text-muted-foreground">
              <span className="font-medium">{run ? '逐场状态' : '下载顺序'}</span>
              <span className="text-muted-foreground/65">ZIP 内文件名以序号开头</span>
            </div>
            <ol data-testid="campaign-batch-queue" className="max-h-[36vh] overflow-y-auto rounded border border-border/80 bg-card/60">
              {campaigns.map((item, index) => {
                const state = rowStateOf(run, item.id, activeId, lastZip?.ids);
                const failure = run?.failures.get(item.id);
                const result = run?.outputs.get(item.id) ?? run?.packed.get(item.id);
                const omitted = result?.chartOmitted ?? result?.peakFallback;
                const widened = widenedInterval(result?.chartInterval);
                const packedPart = run?.packed.get(item.id)?.part;
                const omittedBadge = (omitted || widened) ? (
                  <>
                    {widened && (
                      <span
                        title={`所选 ${intervalLabel(run?.options.interval)} 在这场战役的盘面上放不下，已放宽到 ${intervalLabel(widened)}`}
                        className="rounded border border-border px-1 font-mono text-[9px] leading-4 text-muted-foreground"
                      >
                        {intervalLabel(widened)}
                      </span>
                    )}
                    {omitted && <span title={omitted} className="rounded border border-[#F0B90B]/40 px-1 text-[9px] leading-4 text-[#C98500] dark:text-[#F0B90B]">无 K 线</span>}
                  </>
                ) : null;
                return (
                  <li
                    key={item.id}
                    ref={node => { if (node) rowRefs.current.set(item.id, node); else rowRefs.current.delete(item.id); }}
                    data-testid="campaign-batch-row"
                    data-campaign-id={item.id}
                    data-state={state}
                    className={`border-b border-border/50 px-2.5 py-1.5 last:border-b-0 ${state === 'running' ? 'bg-[#F0B90B]/[0.06]' : ''}`}
                  >
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="w-8 shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/60">
                        {String(index + 1).padStart(Math.max(3, String(total).length), '0')}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-foreground/90" title={item.title}>{item.title}</span>
                      {state === 'running' ? (
                        <span className="inline-flex shrink-0 items-center gap-1 text-[10px] text-[#C98500] dark:text-[#F0B90B]">
                          <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" />生成中
                        </span>
                      ) : state === 'done' ? (
                        <span className="inline-flex shrink-0 items-center gap-1 text-[10px] text-[#0ECB81]">
                          {omittedBadge}
                          <Check aria-hidden="true" className="h-3 w-3" />已生成
                        </span>
                      ) : state === 'downloaded' ? (
                        <span className="inline-flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
                          {omittedBadge}
                          <Download aria-hidden="true" className="h-3 w-3" />已下载
                        </span>
                      ) : state === 'packed' ? (
                        <span className="inline-flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
                          {omittedBadge}
                          <Package aria-hidden="true" className="h-3 w-3" />已在第 {packedPart} 包
                        </span>
                      ) : state === 'failed' ? (
                        <span className="inline-flex shrink-0 items-center gap-1.5 text-[10px] text-[#F6465D]">
                          <TriangleAlert aria-hidden="true" className="h-3 w-3" />失败
                          {run && run.status !== 'running' && run.status !== 'budget' && (
                            <button
                              type="button"
                              onClick={() => requeue([item.id])}
                              aria-label={`重试：${item.title}`}
                              className="rounded border border-border/80 px-1.5 leading-4 text-foreground/75 hover:bg-accent"
                            >
                              重试
                            </button>
                          )}
                        </span>
                      ) : (
                        <span className="shrink-0 text-[10px] text-muted-foreground/55">{run ? '等待' : ''}</span>
                      )}
                    </div>
                    {failure && <div className="mt-0.5 pl-10 text-[10px] leading-[1.6] text-[#F6465D]/90">{failure}</div>}
                  </li>
                );
              })}
            </ol>
          </section>

          {archiveError && (
            <p role="alert" className="rounded border border-[#F6465D]/40 bg-[#F6465D]/10 px-2.5 py-2 text-[11px] text-[#F6465D]">
              打包失败：{archiveError}。图片仍保留，可以重新下载。
            </p>
          )}
          {lastZip && !packing && (
            <p className="break-all text-[10px] text-muted-foreground" data-testid="campaign-batch-last-zip">
              已发起下载：<span className="font-mono text-foreground/80">{lastZip.name}</span>
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/20 px-5 py-3">
          {confirmClose ? (
            <>
              <span role="alert" className="mr-auto text-[11px] text-[#C98500] dark:text-[#F0B90B]">
                {busy && unsavedCount > 0
                  ? `关闭会停止本批导出，并丢弃 ${unsavedCount} 张尚未下载的图片。确定关闭？`
                  : busy
                    ? '关闭会停止本批导出。确定关闭？'
                    : `关闭会丢弃 ${unsavedCount} 张尚未下载的图片。确定关闭？`}
              </span>
              <button type="button" className={SECONDARY} onClick={() => setConfirmClose(false)} autoFocus>继续导出</button>
              <button type="button" className={`${BUTTON} border-[#F6465D]/40 bg-[#F6465D]/10 font-medium text-[#F6465D] hover:bg-[#F6465D]/15`} onClick={close}>丢弃并关闭</button>
            </>
          ) : !run ? (
            <>
              <button type="button" className={SECONDARY} onClick={requestClose}>取消</button>
              <button type="button" className={PRIMARY} disabled={!total || !anySection} onClick={start} data-testid="campaign-batch-start">
                生成 {total} 张图片
              </button>
            </>
          ) : (
            <>
              {/* 窄屏上右上角已有关闭叉（读屏名「关闭」），这里省掉「关闭」，让重试与下载留在同一行 */}
              <button type="button" className={`${SECONDARY} mr-auto max-sm:hidden`} onClick={requestClose} data-testid="campaign-batch-close">关闭</button>
              {packing ? (
                <button type="button" className={SECONDARY} onClick={cancelPacking}>取消打包</button>
              ) : run.status === 'running' ? (
                <button type="button" className={SECONDARY} onClick={pause}><Pause aria-hidden="true" className="h-3.5 w-3.5" />暂停</button>
              ) : (
                <>
                  {pendingIds.length > 0 && run.status !== 'budget' && (
                    <button type="button" className={SECONDARY} onClick={() => requeue(pendingIds)}>
                      <Play aria-hidden="true" className="h-3.5 w-3.5" />继续生成 {pendingIds.length} 场
                    </button>
                  )}
                  {failedIds.length > 0 && run.status !== 'budget' && (
                    <button type="button" className={SECONDARY} onClick={() => requeue(failedIds)}>
                      <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />重试失败的 {failedIds.length} 场
                    </button>
                  )}
                </>
              )}
              {run.status === 'budget' ? (
                <button type="button" className={PRIMARY} disabled={packing} onClick={() => void download('part')}>
                  <Download aria-hidden="true" className="h-3.5 w-3.5" />{packing ? '打包中…' : `下载第 ${run.part} 包并继续`}
                </button>
              ) : run.status !== 'running' && run.outputs.size > 0 ? (
                <button type="button" className={PRIMARY} disabled={packing} onClick={() => void download('all')} data-testid="campaign-batch-download">
                  <Download aria-hidden="true" className="h-3.5 w-3.5" />
                  {packing ? '打包中…' : `下载 ZIP（${run.outputs.size} 张）`}
                </button>
              ) : null}
            </>
          )}
        </div>
      </DialogContent>
      {activeId && run && (
        <CampaignBatchExportWorker
          key={`${run.generation}:${activeId}`}
          campaignId={activeId}
          userId={userId}
          options={run.options}
          snapshot={run.snapshot}
          onComplete={output => finish(activeId, run.generation, output)}
          onError={error => finish(activeId, run.generation, undefined, errorText(error))}
        />
      )}
    </Dialog>
  );
}
