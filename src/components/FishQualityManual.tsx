import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import manual from '../../docs/fish-quality-manual.md?raw';

export function FishQualityManual({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent aria-describedby={undefined} className="flex max-h-[85dvh] w-[calc(100vw-2rem)] max-w-3xl flex-col overflow-hidden p-0">
      <DialogHeader className="shrink-0 border-b border-border/60 px-6 py-4">
        <DialogTitle>使用说明</DialogTitle>
      </DialogHeader>
      <article className="prose prose-sm dark:prose-invert min-h-0 max-w-none overflow-y-auto overscroll-contain px-6 pb-6 pt-4 prose-headings:font-medium prose-h1:mt-0 prose-h1:text-xl prose-h2:text-base prose-p:leading-relaxed prose-li:leading-relaxed" data-testid="fish-quality-manual">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{manual}</ReactMarkdown>
      </article>
    </DialogContent>
  </Dialog>;
}
