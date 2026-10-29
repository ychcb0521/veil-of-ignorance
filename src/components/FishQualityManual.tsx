import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import manual from '../../docs/fish-quality-manual.md?raw';

const readingArea = 'm-0 min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-8 sm:px-10';

export function FishQualityManual({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children?: ReactNode }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent aria-describedby={undefined} className="flex h-[min(90dvh,960px)] w-[calc(100vw-2rem)] max-w-[1120px] flex-col gap-0 overflow-hidden rounded-xl p-0 sm:w-[calc(100vw-4rem)] [&>button]:right-5 [&>button]:top-5">
      <DialogHeader className="shrink-0 border-b border-border/60 px-5 py-5 sm:px-8">
        <DialogTitle className="text-lg">鱼质量 · 使用说明</DialogTitle>
      </DialogHeader>
      <Tabs defaultValue="manual" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mx-5 my-3 h-9 shrink-0 self-start sm:mx-8" aria-label="鱼质量帮助内容">
          <TabsTrigger value="manual">使用说明</TabsTrigger>
          {children && <TabsTrigger value="tips">操作提示</TabsTrigger>}
        </TabsList>
        <TabsContent value="manual" className={readingArea}>
          <article className="prose dark:prose-invert mx-auto max-w-[880px] text-[15px] leading-8 sm:text-base prose-headings:font-medium prose-h1:mt-2 prose-h1:text-2xl prose-h2:mb-3 prose-h2:mt-8 prose-h2:text-lg prose-p:my-3 prose-li:my-1" data-testid="fish-quality-manual">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
              h1: ({children}) => <h1 className="mb-6 mt-2 text-2xl font-semibold leading-9">{children}</h1>,
              h2: ({children}) => <h2 className="mb-3 mt-9 border-b border-border/50 pb-2 text-lg font-semibold leading-8">{children}</h2>,
              p: ({children}) => <p className="my-3 leading-8">{children}</p>,
              ul: ({children}) => <ul className="my-3 list-disc space-y-2 pl-6">{children}</ul>,
              ol: ({children,...props}) => <ol {...props} className="my-4 list-decimal space-y-3 pl-6">{children}</ol>,
              li: ({children}) => <li className="pl-1 leading-8 marker:text-muted-foreground">{children}</li>,
            }}>{manual}</ReactMarkdown>
          </article>
        </TabsContent>
        {children && <TabsContent value="tips" className={readingArea}><div className="mx-auto max-w-[880px] space-y-5 text-[15px] leading-8 sm:text-base" data-testid="fish-quality-operation-tips">{children}</div></TabsContent>}
      </Tabs>
    </DialogContent>
  </Dialog>;
}
