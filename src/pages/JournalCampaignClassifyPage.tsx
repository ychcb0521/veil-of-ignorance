import { useState, type ChangeEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { BackButton } from '@/components/journal/BackButton';
import { Input } from '@/components/ui/input';

export default function JournalCampaignClassifyPage() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const [symbol, setSymbol] = useState(
    () => searchParams.get('symbol')?.trim().toUpperCase() ?? '',
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-6 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <BackButton />
            <div className="min-w-0">
              <h1 className="text-[14px] font-medium">归类历史交易</h1>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                把已有的历史 journal 整理为战役。每次归类操作都是可逆的。
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => nav('/journal/campaigns')}
            className="h-8 shrink-0 rounded border border-border bg-background px-3 text-[11px] font-medium text-foreground transition-colors hover:bg-muted/50"
          >
            查看所有战役
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-6 py-4">
        <Input
          autoFocus
          value={symbol}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setSymbol(event.target.value.toUpperCase())}
          placeholder="输入标的名称，例如 RAVEUSDT"
          aria-label="标的名称"
          className="h-10 text-[13px]"
        />
      </main>
    </div>
  );
}
