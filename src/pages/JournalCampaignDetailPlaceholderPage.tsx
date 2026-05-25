import { useParams } from 'react-router-dom';
import { BackButton } from '@/components/journal/BackButton';

export default function JournalCampaignDetailPlaceholderPage() {
  const { id } = useParams();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="px-6 py-3 max-w-[1600px] mx-auto flex items-center gap-3">
          <BackButton />
          <div>
            <h1 className="text-[14px] font-medium">交易战役详情</h1>
            <p className="text-[11px] text-muted-foreground font-mono">{id}</p>
          </div>
        </div>
      </header>

      <main className="max-w-[960px] mx-auto px-6 py-10">
        <div className="border border-border rounded-lg p-8 text-center space-y-2 bg-card">
          <div className="text-[16px] font-medium">批次 17 即将上线</div>
          <div className="text-[12px] text-muted-foreground">
            本批次先完成战役数据层、归类入口和列表页；详情页将在下一批次接入时间轴与战役级复盘。
          </div>
        </div>
      </main>
    </div>
  );
}
