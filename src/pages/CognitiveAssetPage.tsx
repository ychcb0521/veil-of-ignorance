import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Brain, List, PencilLine, RotateCcw, Save } from 'lucide-react';
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
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import type { CognitiveAsset } from '@/lib/cognitiveAssetApi';
import {
  getOrCreateCognitiveAsset,
  resetCognitiveAssetToDefault,
  updateCognitiveAsset,
} from '@/lib/cognitiveAssetApi';

interface TocItem {
  id: string;
  label: string;
  depth: 1 | 2;
}

interface ParsedBlock {
  id?: string;
  kind: 'toc-title' | 'toc-row' | 'section' | 'subsection' | 'subsubsection' | 'formula' | 'paragraph' | 'spacer';
  text: string;
}

function formatUpdatedAt(value: string | null | undefined): string {
  if (!value) return '—';
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return '—';
  return new Date(timestamp).toLocaleString('zh-CN');
}

function Highlight({ children }: { children: ReactNode }) {
  return (
    <div className="bg-accent/50 border-l-2 border-[#F0B90B] pl-4 py-2 rounded-r text-[14px] leading-relaxed text-foreground">
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <span className="inline-block w-1 h-6 rounded bg-[#F0B90B]" />
      <h2 className="text-[20px] font-medium text-foreground">{children}</h2>
    </div>
  );
}

function SubTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-[16px] font-medium text-foreground mt-6 mb-2">{children}</h3>;
}

function P({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`text-[14px] leading-relaxed text-foreground/90 ${className}`}>{children}</p>;
}

function isFormulaLine(line: string): boolean {
  const trimmed = line.trim();
  return /[=×]/.test(trimmed) && /[A-Za-z]/.test(trimmed);
}

function parseCognitiveContent(content: string): { toc: TocItem[]; blocks: ParsedBlock[] } {
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const toc: TocItem[] = [];
  const blocks: ParsedBlock[] = [];
  let sectionIndex = 0;
  let subIndex = 0;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      blocks.push({ kind: 'spacer', text: '' });
      continue;
    }

    if (trimmed === '目录') {
      blocks.push({ kind: 'toc-title', text: trimmed });
      continue;
    }

    if (/^\d+(?:\.\d+)*\t/.test(trimmed)) {
      blocks.push({ kind: 'toc-row', text: trimmed.replace(/\t/g, '    ') });
      continue;
    }

    if (/^【.+】/.test(trimmed)) {
      sectionIndex += 1;
      subIndex = 0;
      const id = `section-${sectionIndex}`;
      toc.push({ id, label: trimmed, depth: 1 });
      blocks.push({ id, kind: 'section', text: trimmed });
      continue;
    }

    const sectionMatch = trimmed.match(/^(\d+\.\d+(?:\.\d+)*)\s*(.+)$/);
    if (sectionMatch) {
      subIndex += 1;
      const [, numbering, title] = sectionMatch;
      const dotCount = (numbering.match(/\./g) ?? []).length;
      const id = `subsection-${sectionIndex}-${subIndex}`;
      if (dotCount <= 1) {
        toc.push({ id, label: `${numbering} ${title}`, depth: 2 });
        blocks.push({ id, kind: 'subsection', text: `${numbering} ${title}` });
      } else {
        blocks.push({ id, kind: 'subsubsection', text: `${numbering} ${title}` });
      }
      continue;
    }

    if (isFormulaLine(trimmed)) {
      blocks.push({ kind: 'formula', text: trimmed });
      continue;
    }

    blocks.push({ kind: 'paragraph', text: line });
  }

  return { toc, blocks };
}

function TocList({ items }: { items: TocItem[] }) {
  return (
    <nav className="space-y-0.5">
      <div className="text-[11px] text-muted-foreground uppercase tracking-wider mb-2">目录</div>
      {items.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          className={`block rounded hover:bg-accent cursor-pointer ${
            item.depth === 1
              ? 'h-8 px-2 leading-8 text-[12px] text-foreground'
              : 'h-7 pl-6 pr-2 leading-7 text-[11px] text-muted-foreground'
          }`}
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}

export default function CognitiveAssetPage() {
  const [asset, setAsset] = useState<CognitiveAsset | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  const parsed = useMemo(
    () => parseCognitiveContent(asset?.content ?? ''),
    [asset?.content],
  );

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

  const hasReadableContent = Boolean(asset?.content.trim());

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="px-6 py-3 max-w-[1280px] mx-auto flex items-center gap-3">
          <BackButton />
          <div className="md:hidden">
            {!editing ? (
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 px-2">
                    <List className="h-4 w-4 mr-1" /> 目录
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-[260px] bg-card border-border">
                  <div className="mt-4">
                    <TocList items={parsed.toc} />
                  </div>
                </SheetContent>
              </Sheet>
            ) : null}
          </div>
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

      <div className="max-w-[1280px] mx-auto px-6 py-8 grid grid-cols-1 md:grid-cols-[240px_1fr] gap-8">
        <aside className="hidden md:block">
          {!editing ? (
            <div className="sticky top-[72px] bg-card border border-border rounded p-3">
              <TocList items={parsed.toc} />
            </div>
          ) : null}
        </aside>

        <main className="space-y-8 min-w-0">
          <section className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-[#F0B90B]">
                  <Brain className="h-5 w-5" />
                  <span className="text-[12px] uppercase tracking-wider">认知资产 / Cognitive Asset</span>
                </div>
                <div>
                  <h2 className="text-[24px] font-medium text-foreground">{asset?.title || '认知资产'}</h2>
                  <p className="mt-2 max-w-[860px] text-[14px] leading-relaxed text-foreground/85">
                    认知资产是你的交易操作系统。它不是静态说明书，而是会随着复盘、错误、规则更新而持续进化的个人纪律文档。
                  </p>
                </div>
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
                        恢复默认模板会用系统初始版本覆盖你当前的认知资产内容。此操作不会影响账户资产、交易记录和战役数据，但会覆盖你已编辑的认知文本。确认继续吗？
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

            <Highlight>
              记录你的交易纪律、风险原则、SOP 与认知框架。账户资产决定你能活多久，认知资产决定你如何持续进化。
            </Highlight>
          </section>

          {loading ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-[16px]">正在加载认知资产...</CardTitle>
                <CardDescription>正在读取你的个人认知资产版本与最后更新时间。</CardDescription>
              </CardHeader>
            </Card>
          ) : editing ? (
            <Card className="border-border">
              <CardHeader>
                <CardTitle className="text-[18px]">编辑认知资产</CardTitle>
                <CardDescription className="text-[13px] leading-6">
                  你正在编辑个人认知资产。保存后将覆盖你的个人版本，不影响系统默认模板。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  className="min-h-[72vh] resize-y bg-background/60 font-mono text-[12px] leading-6"
                  placeholder="认知资产内容不能为空"
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[12px] text-muted-foreground">
                    建议保留标题层级、公式与关键章节结构，这样阅读状态会继续按文档模式展示。
                  </p>
                  <div className="flex items-center gap-2">
                    <Button size="sm" className="h-9 bg-[#0ECB81] text-black hover:bg-[#0ECB81]/90" onClick={() => void handleSave()} disabled={saving}>
                      <Save className="h-4 w-4" />
                      保存更新
                    </Button>
                    <Button size="sm" variant="outline" className="h-9" onClick={handleCancel} disabled={saving}>
                      取消编辑
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : !hasReadableContent ? (
            <Card className="border-[#F6465D]/30 bg-[#F6465D]/5">
              <CardHeader>
                <CardTitle className="text-[16px]">认知资产内容为空</CardTitle>
                <CardDescription className="text-[13px] leading-6">
                  当前用户记录存在，但内容为空。你可以立即恢复默认模板，将系统初始认知资产重新写回到个人版本。
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <article className="space-y-5">
              {parsed.blocks.map((block, index) => {
                if (block.kind === 'spacer') {
                  return <div key={`spacer-${index}`} className="h-1" />;
                }

                if (block.kind === 'toc-title') {
                  return (
                    <div key={`toc-title-${index}`} className="pt-2">
                      <SubTitle>{block.text}</SubTitle>
                    </div>
                  );
                }

                if (block.kind === 'toc-row') {
                  return (
                    <p key={`toc-row-${index}`} className="font-mono text-[12px] leading-6 text-muted-foreground whitespace-pre-wrap">
                      {block.text}
                    </p>
                  );
                }

                if (block.kind === 'section') {
                  return (
                    <section key={block.id ?? `section-${index}`} id={block.id} className="scroll-mt-20 pt-4">
                      <SectionTitle>{block.text}</SectionTitle>
                    </section>
                  );
                }

                if (block.kind === 'subsection') {
                  return (
                    <section key={block.id ?? `sub-${index}`} id={block.id} className="scroll-mt-20">
                      <SubTitle>{block.text}</SubTitle>
                    </section>
                  );
                }

                if (block.kind === 'subsubsection') {
                  return (
                    <h4 key={block.id ?? `subsub-${index}`} id={block.id} className="text-[14px] font-medium text-foreground mt-4">
                      {block.text}
                    </h4>
                  );
                }

                if (block.kind === 'formula') {
                  return (
                    <div key={`formula-${index}`} className="rounded border border-border bg-card px-3 py-2 font-mono text-[13px] text-foreground/95">
                      {block.text}
                    </div>
                  );
                }

                return (
                  <P key={`paragraph-${index}`}>
                    {block.text}
                  </P>
                );
              })}
            </article>
          )}
        </main>
      </div>
    </div>
  );
}
