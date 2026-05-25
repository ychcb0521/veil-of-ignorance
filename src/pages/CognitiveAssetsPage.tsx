import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, List, RotateCcw } from 'lucide-react';
import { useBlocker, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { CognitiveAssetSection } from '@/components/cognitive-assets/CognitiveAssetSection';
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
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { useAuth } from '@/contexts/AuthContext';
import {
  ensureCognitiveAssetsExists,
  resetAllCognitiveAssets,
  resetCognitiveAssetSection,
  updateCognitiveAssetSection,
} from '@/lib/journalApi';
import type { CognitiveAssetsDoc } from '@/types/cognitiveAssets';

interface TocItem {
  id: string;
  label: string;
  depth: 1 | 2;
}

const CATEGORY_ACCENT: Record<string, string> = {
  dao: '#F0B90B',
  fa: '#5BA3FF',
  shou: '#F6465D',
  gong: '#0ECB81',
  xin: '#A855F7',
};

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
      {items.map(item => (
        <a
          key={item.id}
          href={`#${item.id}`}
          onClick={onJump}
          className={`block rounded hover:bg-accent cursor-pointer ${
            item.depth === 1
              ? 'h-8 px-2 leading-8 text-[12px]'
              : 'h-8 pl-6 pr-2 leading-8 text-[12px]'
          } ${activeId === item.id ? 'bg-accent border-l-2 border-[#F0B90B] text-foreground' : item.depth === 1 ? 'text-foreground' : 'text-muted-foreground'}`}
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}

export default function CognitiveAssetsPage() {
  const nav = useNavigate();
  const { user } = useAuth();
  const observerRef = useRef<IntersectionObserver | null>(null);
  const [doc, setDoc] = useState<CognitiveAssetsDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState('');
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [resetAllToken, setResetAllToken] = useState('');

  const tocItems = useMemo<TocItem[]>(
    () => (doc?.categories ?? []).flatMap(category => [
      { id: `category-${category.id}`, label: category.title, depth: 1 as const },
      ...category.sections.map(section => ({ id: section.id, label: section.title, depth: 2 as const })),
    ]),
    [doc],
  );

  const editingSection = useMemo(() => {
    if (!doc || !editingSectionId || !editingCategoryId) return null;
    const category = doc.categories.find(item => item.id === editingCategoryId);
    return category?.sections.find(item => item.id === editingSectionId) ?? null;
  }, [doc, editingCategoryId, editingSectionId]);

  const hasUnsavedChanges = Boolean(editingSection && editingContent !== editingSection.content);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => (
    hasUnsavedChanges && currentLocation.pathname !== nextLocation.pathname
  ));

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    const confirmed = window.confirm('当前章节有未保存内容，确认离开吗？');
    if (confirmed) {
      blocker.proceed();
    } else {
      blocker.reset();
    }
  }, [blocker]);

  useEffect(() => {
    if (!hasUnsavedChanges) return undefined;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const load = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const next = await ensureCognitiveAssetsExists(user.id);
      setDoc(next);
      if (!activeId && next.categories[0]) {
        setActiveId(`category-${next.categories[0].id}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载认知资产失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [user?.id]);

  useEffect(() => {
    if (!doc) return;
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

  const handleEdit = (categoryId: string, sectionId: string) => {
    if (editingSectionId && editingSectionId !== sectionId && hasUnsavedChanges) {
      const confirmed = window.confirm('当前章节有未保存内容，确认切换编辑章节吗？');
      if (!confirmed) return;
    }
    const category = doc?.categories.find(item => item.id === categoryId);
    const section = category?.sections.find(item => item.id === sectionId);
    if (!section) return;
    setEditingCategoryId(categoryId);
    setEditingSectionId(sectionId);
    setEditingContent(section.content);
  };

  const handleCancel = () => {
    if (hasUnsavedChanges) {
      const confirmed = window.confirm('丢弃当前章节的未保存修改，确认吗？');
      if (!confirmed) return;
    }
    setEditingCategoryId(null);
    setEditingSectionId(null);
    setEditingContent('');
  };

  const handleSave = async () => {
    if (!user?.id || !editingSectionId || !editingCategoryId) return;
    if (!editingContent.trim()) {
      toast.error('章节内容不能为空');
      return;
    }
    setSaving(true);
    try {
      await updateCognitiveAssetSection(user.id, editingCategoryId, editingSectionId, editingContent);
      toast.success('章节已保存');
      setEditingCategoryId(null);
      setEditingSectionId(null);
      setEditingContent('');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleResetSection = async (categoryId: string, sectionId: string) => {
    if (!user?.id) return;
    const confirmed = window.confirm('重置后将丢失你对该节的所有自定义内容，确认？');
    if (!confirmed) return;
    setSaving(true);
    try {
      await resetCognitiveAssetSection(user.id, categoryId, sectionId);
      if (editingSectionId === sectionId) {
        setEditingCategoryId(null);
        setEditingSectionId(null);
        setEditingContent('');
      }
      toast.success('该节已恢复初始内容');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '重置章节失败');
    } finally {
      setSaving(false);
    }
  };

  const handleResetAll = async () => {
    if (!user?.id) return;
    setSaving(true);
    try {
      await resetAllCognitiveAssets(user.id);
      setEditingCategoryId(null);
      setEditingSectionId(null);
      setEditingContent('');
      setResetAllToken('');
      toast.success('认知资产已恢复为初始内容');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '重置全部失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
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
            <p className="text-[11px] text-muted-foreground">{doc?.meta.subtitle ?? '交易底层认知体系 · 道-法-术-心'}</p>
          </div>
          <div className="ml-auto">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground hover:text-[#F6465D]" disabled={loading || saving}>
                  <RotateCcw className="h-4 w-4 mr-1" />
                  重置全部为初始内容
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="border-[#F6465D]/40">
                <AlertDialogHeader>
                  <AlertDialogTitle>重置全部认知资产</AlertDialogTitle>
                  <AlertDialogDescription className="leading-6">
                    此操作将丢弃你对所有 sections 的自定义内容，完全恢复为初始的“道-法-术-心”框架。这个操作不可撤销。请输入“重置”解锁确认按钮。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <Input value={resetAllToken} onChange={event => setResetAllToken(event.target.value)} placeholder="请输入：重置" />
                <AlertDialogFooter>
                  <AlertDialogCancel onClick={() => setResetAllToken('')}>取消</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => void handleResetAll()}
                    disabled={resetAllToken !== '重置' || saving}
                    className="bg-[#F6465D] text-white hover:bg-[#F6465D]/90 disabled:opacity-50"
                  >
                    确认重置全部
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
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
          ) : !doc ? (
            <div className="rounded border border-[#F6465D]/30 bg-[#F6465D]/5 p-6 text-[13px] text-muted-foreground">
              认知资产加载失败，请刷新后重试。
            </div>
          ) : (
            doc.categories.map(category => (
              <section key={category.id} id={`category-${category.id}`} className="scroll-mt-24 space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <span
                      className="inline-block w-1 h-6 rounded"
                      style={{ background: CATEGORY_ACCENT[category.id] ?? '#F0B90B' }}
                    />
                    <h2 className="text-[20px] font-medium text-foreground">{category.title}</h2>
                  </div>
                  <div className="text-[12px] text-muted-foreground">{category.subtitle}</div>
                  <p className="text-[12px] italic leading-6 text-muted-foreground">{category.intro}</p>
                </div>

                <div>
                  {category.sections.map(section => (
                    <CognitiveAssetSection
                      key={section.id}
                      categoryId={category.id}
                      section={section}
                      isEditing={editingSectionId === section.id}
                      editingContent={editingSectionId === section.id ? editingContent : section.content}
                      saving={saving}
                      onEdit={handleEdit}
                      onChange={setEditingContent}
                      onSave={() => void handleSave()}
                      onCancel={handleCancel}
                      onReset={(nextCategoryId, nextSectionId) => void handleResetSection(nextCategoryId, nextSectionId)}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </main>
      </div>
    </div>
  );
}
