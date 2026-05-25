import { useEffect, useMemo, useState } from 'react';
import { Brain, PencilLine, RotateCcw, Save } from 'lucide-react';
import { toast } from 'sonner';
import { BackButton } from '@/components/journal/BackButton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import type { CognitiveAsset } from '@/lib/cognitiveAssetApi';
import {
  getOrCreateCognitiveAsset,
  resetCognitiveAssetToDefault,
  updateCognitiveAsset,
} from '@/lib/cognitiveAssetApi';

function formatUpdatedAt(value: string | null | undefined): string {
  if (!value) return '—';
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return '—';
  return new Date(timestamp).toLocaleString('zh-CN');
}

export default function CognitiveAssetPage() {
  const [asset, setAsset] = useState<CognitiveAsset | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  const hasUnsavedChanges = useMemo(
    () => editing && asset !== null && draft !== asset.content,
    [asset, draft, editing],
  );

  const load = async () => {
    setLoading(true);
    try {
      const next = await getOrCreateCognitiveAsset();
      setAsset(next);
      setDraft(next.content);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载认知资产失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleSave = async () => {
    if (!draft.trim()) {
      toast.error('认知资产内容不能为空');
      return;
    }

    setSaving(true);
    try {
      const next = await updateCognitiveAsset(draft, asset?.title);
      setAsset(next);
      setDraft(next.content);
      setEditing(false);
      toast.success('已保存');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setDraft(asset?.content ?? '');
    setEditing(false);
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      const next = await resetCognitiveAssetToDefault();
      setAsset(next);
      setDraft(next.content);
      setEditing(false);
      toast.success('已恢复默认模板');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '恢复默认模板失败');
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="px-6 py-3 max-w-[1400px] mx-auto flex items-center gap-3">
          <BackButton />
          <div className="min-w-0">
            <h1 className="text-[14px] font-medium">认知资产</h1>
            <p className="text-[11px] text-muted-foreground">
              记录你的交易纪律、风险原则、SOP 与认知框架。账户资产决定你能活多久，认知资产决定你如何持续进化。
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>最后更新时间 {formatUpdatedAt(asset?.updated_at)}</span>
            <span className="hidden sm:inline">|</span>
            <span>{loading ? '正在加载认知资产...' : saving ? '正在保存...' : '已保存'}</span>
            {hasUnsavedChanges ? (
              <>
                <span className="hidden sm:inline">|</span>
                <span className="text-[#F0B90B]">当前存在未保存修改</span>
              </>
            ) : null}
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-6 py-4 space-y-4">
        <Card className="border-border bg-card">
          <CardHeader className="border-b border-border/70 pb-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2">
                <CardTitle className="flex items-center gap-2 text-[18px]">
                  <Brain className="h-5 w-5 text-[#F0B90B]" />
                  <span>{asset?.title ?? '认知资产'}</span>
                </CardTitle>
                <CardDescription className="max-w-[760px] text-[12px] leading-6">
                  认知资产是你的交易操作系统。它不是静态说明书，而是会随着复盘、错误、规则更新而持续进化的个人纪律文档。
                </CardDescription>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {!editing ? (
                  <Button size="sm" className="h-9 bg-[#F0B90B] text-black hover:bg-[#F0B90B]/90" onClick={() => setEditing(true)} disabled={loading || asset === null}>
                    <PencilLine className="h-4 w-4" />
                    编辑
                  </Button>
                ) : (
                  <>
                    <Button size="sm" className="h-9 bg-[#0ECB81] text-black hover:bg-[#0ECB81]/90" onClick={() => void handleSave()} disabled={saving}>
                      <Save className="h-4 w-4" />
                      保存更新
                    </Button>
                    <Button size="sm" variant="outline" className="h-9" onClick={handleCancel} disabled={saving}>
                      取消编辑
                    </Button>
                  </>
                )}

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="outline" className="h-9" disabled={loading || resetting}>
                      <RotateCcw className="h-4 w-4" />
                      恢复默认模板
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>恢复默认模板</AlertDialogTitle>
                      <AlertDialogDescription>
                        恢复默认模板会用系统初始版本覆盖你当前的认知资产内容。此操作不会影响账户资产和交易记录，但会覆盖你已编辑的认知文本。确认继续吗？
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>取消</AlertDialogCancel>
                      <AlertDialogAction onClick={() => void handleReset()} className="bg-[#F6465D] text-white hover:bg-[#F6465D]/90">
                        确认恢复
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </CardHeader>

          <CardContent className="pt-6">
            {loading ? (
              <div className="rounded-lg border border-border bg-background/40 p-6 text-[12px] text-muted-foreground">
                正在加载认知资产...
              </div>
            ) : editing ? (
              <Textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                className="min-h-[70vh] resize-y bg-background/60 font-mono text-[12px] leading-6"
                placeholder="认知资产内容不能为空"
              />
            ) : (
              <div className="rounded-lg border border-border bg-background/40 p-4">
                <div className="whitespace-pre-wrap break-words text-[13px] leading-7 text-foreground/95">
                  {asset?.content ?? '暂无认知资产内容'}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
