import { type DragEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, FileText, List, Loader2, Trash2, Upload } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useNavigate } from 'react-router-dom';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
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
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { useAuth } from '@/contexts/AuthContext';
import {
  buildCognitiveAssetsDocFromFile,
  isSupportedCognitiveAssetFile,
} from '@/lib/documentImport';
import {
  ensureCognitiveAssetsExists,
  replaceCognitiveAssetsDoc,
  resetAllCognitiveAssets,
} from '@/lib/journalApi';
import type { CognitiveAssetSection, CognitiveAssetsDoc } from '@/types/cognitiveAssets';

interface TocItem {
  id: string;
  label: string;
  level: number;
  number?: string;
}

type NumberedSection = CognitiveAssetSection & {
  displayLevel: number;
  displayNumber: string;
  displayTitle: string;
};

const CATEGORY_ACCENTS = ['#F0B90B', '#0ECB81', '#5BA3FF', '#F6465D', '#A855F7'];
const DOCUMENT_ACCEPT = [
  '.pdf',
  '.doc',
  '.docx',
  '.txt',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
].join(',');

function getFirstTocId(doc: CognitiveAssetsDoc | null): string {
  const firstCategory = doc?.categories[0];
  return firstCategory ? `category-${firstCategory.id}` : '';
}

function makeSafeId(value: string, fallback: string): string {
  const safe = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return safe || fallback;
}

function appendCognitiveAssetsDoc(current: CognitiveAssetsDoc, addition: CognitiveAssetsDoc): CognitiveAssetsDoc {
  const stamp = Date.now().toString(36);
  const existingCategoryIds = new Set(current.categories.map(category => category.id));
  const nextCategories = addition.categories.map((category, categoryIndex) => {
    const baseCategoryId = makeSafeId(category.id || category.title, `upload_${categoryIndex + 1}`);
    let categoryId = `upload_${stamp}_${baseCategoryId}`;
    let suffix = 1;
    while (existingCategoryIds.has(categoryId)) {
      categoryId = `upload_${stamp}_${baseCategoryId}_${suffix}`;
      suffix += 1;
    }
    existingCategoryIds.add(categoryId);
    return {
      ...category,
      id: categoryId,
      sections: category.sections.map((section, sectionIndex) => ({
        ...section,
        id: `${categoryId}_${makeSafeId(section.id || section.title, `section_${sectionIndex + 1}`)}`,
      })),
    };
  });

  return {
    meta: {
      ...current.meta,
      subtitle: current.meta.subtitle.includes('个人追加')
        ? current.meta.subtitle
        : `${current.meta.subtitle} · 个人追加`,
    },
    categories: [...current.categories, ...nextCategories],
  };
}

function clampTocLevel(level: number): number {
  return Math.max(1, Math.min(6, Math.floor(level)));
}

function inferSectionLevel(section: CognitiveAssetSection, previousLevel: number, index: number): number {
  if (typeof section.headingLevel === 'number') return clampTocLevel(section.headingLevel);

  const title = section.sourceTitle ?? section.title;
  const numeric = /^(\d+(?:\.\d+)*)[.)、．\s]+/.exec(title);
  if (numeric) return clampTocLevel(numeric[1].split('.').length);
  if (/^(?:【|\[)/.test(title) || /^第[一二三四五六七八九十百千万0-9]+[章节篇部]/.test(title)) return 1;
  if (index === 0) return 1;
  return previousLevel <= 1 ? 2 : previousLevel;
}

function stripDisplayNumber(title: string): string {
  return title
    .replace(/^\s*\d+(?:\.\d+)*[.)、．\s]+/, '')
    .replace(/^\s*[（(]\d+[）)]\s*/, '')
    .trim();
}

function numberSectionsForDisplay(sections: CognitiveAssetSection[]): NumberedSection[] {
  const counters: number[] = [];
  let previousLevel = 1;

  return sections.map((section, index) => {
    let level = inferSectionLevel(section, previousLevel, index);
    if (level > previousLevel + 1) level = previousLevel + 1;
    counters[level - 1] = (counters[level - 1] ?? 0) + 1;
    counters.length = level;
    previousLevel = level;

    const displayNumber = section.headingNumber ?? counters.join('.');
    const displayTitle = stripDisplayNumber(section.sourceTitle ?? section.title) || section.title;

    return {
      ...section,
      displayLevel: level,
      displayNumber,
      displayTitle,
    };
  });
}

function SectionTitle({ children, accent }: { children: ReactNode; accent?: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <span
        className="inline-block w-1 h-6 rounded"
        style={{ background: accent ?? 'hsl(var(--primary))' }}
      />
      <h2 className="text-[20px] font-medium text-foreground">{children}</h2>
    </div>
  );
}

function TocList({
  items,
  activeId,
  onJump,
}: {
  items: TocItem[];
  activeId: string;
  onJump?: () => void;
}) {
  return (
    <nav className="space-y-0.5">
      <div className="text-[11px] text-muted-foreground uppercase tracking-wider mb-2">目录</div>
      {items.length === 0 ? (
        <div className="px-2 py-2 text-[12px] text-muted-foreground">上传文档后自动生成</div>
      ) : (
        items.map(item => (
          <a
            key={item.id}
            href={`#${item.id}`}
            onClick={onJump}
            className={`block rounded py-1.5 pr-2 text-[11px] leading-4 hover:bg-accent cursor-pointer break-words ${
              activeId === item.id ? 'bg-accent border-l-2 border-[#F0B90B] text-foreground' : 'text-muted-foreground'
            }`}
            style={{ paddingLeft: item.level === 0 ? 8 : 8 + Math.min(item.level, 5) * 12 }}
          >
            {item.number ? <span className="font-mono text-[10px] text-[#F0B90B] mr-1">{item.number}</span> : null}
            {item.label}
          </a>
        ))
      )}
    </nav>
  );
}

function MarkdownArticle({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <h3 className="text-[16px] font-medium text-foreground mt-6 mb-2">{children}</h3>,
        h2: ({ children }) => <h3 className="text-[16px] font-medium text-foreground mt-6 mb-2">{children}</h3>,
        h3: ({ children }) => <h4 className="text-[14px] font-medium text-foreground mt-5 mb-2">{children}</h4>,
        p: ({ children }) => <p className="text-[14px] leading-relaxed text-foreground/90 mb-3">{children}</p>,
        strong: ({ children }) => <strong className="font-medium text-foreground">{children}</strong>,
        blockquote: ({ children }) => (
          <blockquote className="bg-accent/50 border-l-2 border-[#F0B90B] pl-4 py-2 rounded-r text-[14px] leading-relaxed text-foreground my-4">
            {children}
          </blockquote>
        ),
        ul: ({ children }) => <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1 my-3">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-6 text-[14px] text-foreground/90 space-y-1 my-3">{children}</ol>,
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        code: ({ children }) => (
          <code className="rounded bg-muted px-1.5 py-0.5 text-[12px] font-mono text-foreground">{children}</code>
        ),
        pre: ({ children }) => (
          <pre className="my-3 rounded bg-muted p-3 text-[12px] font-mono text-foreground overflow-x-auto whitespace-pre-wrap">
            {children}
          </pre>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function UploadPanel({
  hasDocument,
  importing,
  deleting,
  dragActive,
  onChoose,
  onDelete,
  onDrop,
  onDragOver,
  onDragLeave,
}: {
  hasDocument: boolean;
  importing: boolean;
  deleting: boolean;
  dragActive: boolean;
  onChoose: () => void;
  onDelete: () => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
}) {
  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      className={`border rounded p-5 transition-colors ${
        dragActive
          ? 'border-[#F0B90B] bg-[#F0B90B]/10'
          : 'border-border bg-card'
      }`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded border border-border bg-background text-[#F0B90B]">
            <FileText className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-[16px] font-medium text-foreground">
              {hasDocument ? '追加认知资产文档' : '上传认知资产文档'}
            </h2>
            <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
              系统已内置默认认知资产。支持 PDF / Word / TXT，上传后会追加为新的阅读章节，并自动生成目录与正文样式。
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
          {hasDocument && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 border-[#F6465D]/40 text-[#F6465D] hover:bg-[#F6465D]/10 hover:text-[#F6465D]"
                  disabled={importing || deleting}
                >
                  {deleting ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4 mr-1" />
                  )}
                  恢复默认
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="border-[#F6465D]/40">
                <AlertDialogHeader>
                  <AlertDialogTitle>恢复系统默认认知资产？</AlertDialogTitle>
                  <AlertDialogDescription className="leading-6">
                    这会移除后续追加或替换的认知资产内容，并恢复到系统内置的“纪律 · 道 · 法 · 术 · 心”。不会影响交易记录或其他数据。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={onDelete}
                    disabled={deleting}
                    className="bg-[#F6465D] text-white hover:bg-[#F6465D]/90"
                  >
                    确认恢复
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <Button
            type="button"
            className="h-9 bg-[#F0B90B] text-black hover:bg-[#F0B90B]/90"
            onClick={onChoose}
            disabled={importing || deleting}
          >
            {importing ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Upload className="h-4 w-4 mr-1" />
            )}
            {importing ? '生成中' : hasDocument ? '追加文档' : '选择文档'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function CognitiveAssetsPage() {
  const nav = useNavigate();
  const { user } = useAuth();
  const observerRef = useRef<IntersectionObserver | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [doc, setDoc] = useState<CognitiveAssetsDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState('');
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [uploadPanelOpen, setUploadPanelOpen] = useState(false);

  const numberedCategories = useMemo(
    () => (doc?.categories ?? []).map(category => ({
      ...category,
      sections: numberSectionsForDisplay(category.sections),
    })),
    [doc],
  );

  const tocItems = useMemo<TocItem[]>(
    () => numberedCategories.flatMap(category => [
      { id: `category-${category.id}`, label: category.title, level: 0 },
      ...category.sections.map(section => ({
        id: section.id,
        label: section.displayTitle,
        level: section.displayLevel,
        number: section.displayNumber,
      })),
    ]),
    [numberedCategories],
  );

  useEffect(() => {
    if (!user?.id) return;
    const load = async () => {
      setLoading(true);
      try {
        const next = await ensureCognitiveAssetsExists(user.id);
        setDoc(next);
        setActiveId(getFirstTocId(next));
        setUploadPanelOpen(false);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '加载认知资产失败');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [user?.id]);

  useEffect(() => {
    observerRef.current?.disconnect();
    if (!doc || tocItems.length === 0) return undefined;
    const obs = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(entry => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 },
    );
    tocItems.forEach(item => {
      const el = document.getElementById(item.id);
      if (el) obs.observe(el);
    });
    observerRef.current = obs;
    return () => obs.disconnect();
  }, [doc, tocItems]);

  const openFilePicker = () => {
    if (importing || deleting) return;
    fileInputRef.current?.click();
  };

  const handleHeaderUploadClick = () => {
    if (!doc) {
      openFilePicker();
      return;
    }
    setUploadPanelOpen(value => !value);
  };

  const handleFile = async (file: File | null | undefined) => {
    if (!file || !user?.id || deleting) return;
    if (!isSupportedCognitiveAssetFile(file)) {
      toast.error('仅支持上传 PDF、Word（doc/docx）或 TXT 文件');
      return;
    }

    setImporting(true);
    try {
      const next = await buildCognitiveAssetsDocFromFile(file);
      const base = doc ?? await ensureCognitiveAssetsExists(user.id);
      const merged = appendCognitiveAssetsDoc(base, next);
      await replaceCognitiveAssetsDoc(user.id, merged);
      setDoc(merged);
      setActiveId(getFirstTocId(merged));
      setUploadPanelOpen(false);
      toast.success('文档已追加到认知资产');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '文档生成失败');
    } finally {
      setImporting(false);
      setDragActive(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (importing || deleting) return;
    void handleFile(event.dataTransfer.files[0]);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!importing && !deleting) setDragActive(true);
  };

  const handleDragLeave = () => {
    setDragActive(false);
  };

  const handleDelete = async () => {
    if (!user?.id) return;
    setDeleting(true);
    try {
      await resetAllCognitiveAssets(user.id);
      const next = await ensureCognitiveAssetsExists(user.id);
      setDoc(next);
      setActiveId(getFirstTocId(next));
      setUploadPanelOpen(false);
      toast.success('已恢复系统默认认知资产');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <input
        ref={fileInputRef}
        type="file"
        accept={DOCUMENT_ACCEPT}
        className="hidden"
        onChange={event => void handleFile(event.target.files?.[0])}
      />

      <header className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="px-6 py-3 max-w-[1280px] mx-auto flex items-center gap-3">
          <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => nav(-1)}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            返回
          </Button>
          <div className="md:hidden">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 px-2">
                  <List className="h-4 w-4 mr-1" />
                  目录
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[260px] bg-card border-border">
                <div className="mt-4">
                  <TocList items={tocItems} activeId={activeId} />
                </div>
              </SheetContent>
            </Sheet>
          </div>
          <div className="min-w-0">
            <h1 className="text-[14px] font-medium">认知资产</h1>
            <p className="truncate text-[11px] text-muted-foreground">
              {doc?.meta.subtitle ?? '上传 PDF / Word / TXT 自动生成阅读页'}
            </p>
          </div>
          <div className="ml-auto">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-muted-foreground hover:text-[#F0B90B]"
              onClick={handleHeaderUploadClick}
              disabled={loading || importing || deleting}
            >
              {importing ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : doc && uploadPanelOpen ? (
                <ChevronDown className="h-4 w-4 mr-1" />
              ) : doc ? (
                <ChevronRight className="h-4 w-4 mr-1" />
              ) : (
                <Upload className="h-4 w-4 mr-1" />
              )}
              {doc ? '文档管理' : '上传文档'}
            </Button>
          </div>
        </div>
      </header>

      <div className="max-w-[1280px] mx-auto px-6 py-8 grid grid-cols-1 md:grid-cols-[240px_1fr] gap-8">
        <aside className="hidden md:block">
          <div className="sticky top-[72px] self-start bg-card border border-border rounded p-3">
            <TocList items={tocItems} activeId={activeId} />
          </div>
        </aside>

        <main className="space-y-12 min-w-0">
          {loading ? (
            <div className="rounded border border-border bg-card p-6 text-[13px] text-muted-foreground">
              正在加载认知资产...
            </div>
          ) : (
            <>
              {(!doc || uploadPanelOpen) && (
                <UploadPanel
                  hasDocument={Boolean(doc)}
                  importing={importing}
                  deleting={deleting}
                  dragActive={dragActive}
                  onChoose={openFilePicker}
                  onDelete={() => void handleDelete()}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                />
              )}

              {!doc ? (
                <section className="scroll-mt-20">
                  <SectionTitle accent="#F0B90B">等待上传</SectionTitle>
                  <div className="space-y-3">
                    <p className="text-[14px] leading-relaxed text-foreground/90">
                      认知资产现在使用文档上传模式。选择或拖入 PDF、Word、TXT 后，系统会自动生成目录与阅读正文。
                    </p>
                  </div>
                </section>
              ) : (
                numberedCategories.map((category, categoryIndex) => (
                  <section key={category.id} id={`category-${category.id}`} className="scroll-mt-24">
                    <SectionTitle accent={CATEGORY_ACCENTS[categoryIndex % CATEGORY_ACCENTS.length]}>
                      {category.title}
                    </SectionTitle>
                    <div className="space-y-2">
                      <p className="text-[12px] text-muted-foreground">{category.subtitle}</p>
                      <p className="text-[12px] italic leading-6 text-muted-foreground">{category.intro}</p>
                    </div>

                    <div className="mt-6 space-y-10">
                      {category.sections.map(section => (
                        <section key={section.id} id={section.id} className="scroll-mt-24">
                          <h3
                            className="font-medium text-foreground mb-3"
                            style={{ fontSize: section.displayLevel <= 1 ? 18 : section.displayLevel === 2 ? 16 : 14 }}
                          >
                            <span className="font-mono text-[#F0B90B] mr-2">{section.displayNumber}</span>
                            {section.displayTitle}
                          </h3>
                          <MarkdownArticle content={section.content} />
                        </section>
                      ))}
                    </div>
                  </section>
                ))
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
