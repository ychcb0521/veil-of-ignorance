import { useEffect, useState } from 'react';
import { Upload } from 'lucide-react';
import { importTuringReplayArchive, loadTuringReplayArchive, readArchiveKlines, TURING_REPLAY_MINUTE_MS, type TuringReplayArchive } from '@/lib/turingCupReplayArchive';
import { turingCupSymbol } from '@/lib/turingCupSymbol';

type Props = {
  accountId: string;
  interval: string;
  onOpen?: (symbol: string, timeMs: number) => Promise<{ ok: boolean; reason?: string }>;
};

const marketLabel = (ticker: string) => ticker.replace(/^TURING (\d+)$/, 'Turing $1');

export function TuringCupReplayPanel({ accountId, interval, onOpen }: Props) {
  const [archive, setArchive] = useState<TuringReplayArchive>();
  const [symbol, setSymbol] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    loadTuringReplayArchive(accountId).then(value => {
      if (active) setArchive(value);
    }).catch(() => {
      if (active) setError('读取本机行情失败，请重新导入');
    }).finally(() => {
      if (active) setBusy(false);
    });
    return () => { active = false; };
  }, [accountId]);

  const markets = archive ? Object.keys(archive.markets).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) : [];
  const ticker = markets.includes(symbol) ? symbol : markets[0];
  const formatTime = (time: number) => new Date(time).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

  async function importFile(file: File) {
    setBusy(true);
    setError('');
    try {
      setArchive(await importTuringReplayArchive(accountId, file));
    } catch (error) {
      setError(error instanceof Error ? error.message : '导入图灵杯行情失败');
    } finally {
      setBusy(false);
    }
  }

  async function openMarket() {
    if (!archive || !ticker || !onOpen) return;
    setError('');
    const first = readArchiveKlines(archive, ticker, interval, { startTime: archive.anchorMs, limit: 1 })[0];
    if (!first) {
      setError('当前周期没有完整 K 线，请先切换到 1 分钟周期');
      return;
    }
    setBusy(true);
    try {
      const result = await onOpen(turingCupSymbol(ticker), Number(first[0]));
      if (!result.ok) setError(result.reason || '无法打开图灵杯盘面');
    } catch {
      setError('无法打开图灵杯盘面');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="图灵杯离线行情" className="mb-2 rounded border border-border/60 px-2 py-1.5 text-[11px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-foreground">连续交易行情</span>
        <label className="inline-flex cursor-pointer items-center gap-1 rounded border border-border px-1.5 py-0.5 hover:bg-accent">
          <Upload className="h-3 w-3" />
          导入离线行情
          <input type="file" accept=".json,application/json" className="sr-only" disabled={busy}
            onChange={event => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) void importFile(file);
            }} />
        </label>
        {archive && (
          <>
            <select aria-label="离线行情标的" className="input-dark px-1" value={ticker}
              disabled={busy} onChange={event => setSymbol(event.target.value)}>
              {markets.map(market => <option key={market} value={market}>{marketLabel(market)}</option>)}
            </select>
            <button type="button" className="rounded bg-primary/15 px-2 py-0.5 text-primary"
              disabled={busy || !onOpen} onClick={() => void openMarket()}>打开盘面</button>
          </>
        )}
        {busy && <span role="status" className="text-muted-foreground">处理中…</span>}
      </div>
      <div className="mt-1 text-muted-foreground">
        {archive
          ? `${markets.length} 个标的 · ${archive.minutes.toLocaleString()} 个交易分钟 · ${formatTime(archive.anchorMs)} 至 ${formatTime(archive.anchorMs + archive.minutes * TURING_REPLAY_MINUTE_MS)}（UTC+8，终点不含）`
          : '选择连续行情 JSON，数据保存在本浏览器的当前账号下。'}
      </div>
      {archive && <p className="mt-1 text-muted-foreground">模拟 USDT · 午休和隔夜压缩 · 开市缺样保留为空 · 鱼质量与战役使用同一回放时钟</p>}
      {error && <p role="alert" className="mt-1 text-destructive">{error}</p>}
    </section>
  );
}
