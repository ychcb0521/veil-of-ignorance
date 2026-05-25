import { Edit3, RotateCcw, Save } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { CognitiveAssetSection as CognitiveAssetSectionType } from '@/types/cognitiveAssets';

interface Props {
  categoryId: string;
  section: CognitiveAssetSectionType;
  isEditing: boolean;
  editingContent: string;
  saving: boolean;
  onEdit: (categoryId: string, sectionId: string) => void;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onReset: (categoryId: string, sectionId: string) => void;
}

export function CognitiveAssetSection({
  categoryId,
  section,
  isEditing,
  editingContent,
  saving,
  onEdit,
  onChange,
  onSave,
  onCancel,
  onReset,
}: Props) {
  return (
    <section id={section.id} className="scroll-mt-24 bg-card border border-border rounded p-5 my-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="text-[16px] font-medium text-foreground">{section.title}</h3>
        {!isEditing ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-muted-foreground hover:text-[#F0B90B]"
              onClick={() => onEdit(categoryId, section.id)}
            >
              <Edit3 className="h-4 w-4 mr-1" />
              编辑
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-muted-foreground hover:text-[#F6465D]"
              onClick={() => onReset(categoryId, section.id)}
            >
              <RotateCcw className="h-4 w-4 mr-1" />
              重置该节
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="h-8 bg-[#0ECB81] text-black hover:bg-[#0ECB81]/90"
              onClick={onSave}
              disabled={saving}
            >
              <Save className="h-4 w-4 mr-1" />
              保存
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-8" onClick={onCancel} disabled={saving}>
              取消
            </Button>
          </div>
        )}
      </div>

      {isEditing ? (
        <div className="mt-4 space-y-2">
          <Textarea
            rows={20}
            value={editingContent}
            onChange={event => onChange(event.target.value)}
            className="min-h-[360px] resize-y bg-background border-border font-mono text-[12px] leading-6"
          />
          <div className="text-right text-[11px] text-muted-foreground">字符数：{editingContent.length}</div>
        </div>
      ) : (
        <div className="mt-4">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => <h4 className="text-[14px] font-medium mt-5 mb-3 text-foreground">{children}</h4>,
              h2: ({ children }) => <h4 className="text-[14px] font-medium mt-5 mb-3 text-foreground">{children}</h4>,
              h3: ({ children }) => <h4 className="text-[14px] font-medium mt-5 mb-3 text-foreground">{children}</h4>,
              p: ({ children }) => <p className="text-[13px] leading-relaxed mb-3 text-foreground/90">{children}</p>,
              strong: ({ children }) => <strong className="font-medium text-foreground">{children}</strong>,
              blockquote: ({ children }) => (
                <blockquote className="border-l-2 border-[#F0B90B] pl-3 italic text-[13px] leading-relaxed text-foreground/85 my-3">
                  {children}
                </blockquote>
              ),
              ul: ({ children }) => <ul className="list-disc pl-5 my-3 space-y-2">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal pl-5 my-3 space-y-2">{children}</ol>,
              li: ({ children }) => <li className="text-[13px] leading-relaxed text-foreground/90">{children}</li>,
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
            {section.content}
          </ReactMarkdown>
        </div>
      )}
    </section>
  );
}
