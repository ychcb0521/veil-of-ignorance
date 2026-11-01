import { useEffect, useState } from 'react';
import { RotateCw } from 'lucide-react';
import { watchForNewVersion } from '@/lib/versionWatch';

/** 新版本上线后的一行提示：不打断当前操作，点「刷新」才切换。 */
export function NewVersionNotice() {
  const [ready, setReady] = useState(false);
  useEffect(() => watchForNewVersion(() => setReady(true)), []);
  if (!ready) return null;
  return <div role="status" data-testid="new-version-notice"
    title="当前页面仍是旧版本，可以继续使用；刷新后切换到新版本。未保存的输入请先保存。"
    className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs shadow-lg">
    <span className="text-muted-foreground">新版本已就绪</span>
    <button type="button" onClick={() => window.location.reload()} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
      <RotateCw aria-hidden className="h-3 w-3" />刷新
    </button>
  </div>;
}
