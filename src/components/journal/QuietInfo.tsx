import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/**
 * 几乎隐形的 ⓘ：平时只留一点影子，悬停才显现，点开看说明。
 * 用来把段落式的解释从版面上收起来（【用户要求】说明不占版面，点开能看即可）。
 */
export function QuietInfo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${label}说明`}
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground opacity-25 transition-opacity hover:opacity-80 focus-visible:opacity-80 focus-visible:outline-none data-[state=open]:opacity-80"
        >
          <Info className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={4}
        className="w-80 border-border bg-card p-3 text-[11px] leading-relaxed shadow-md"
      >
        <div className="font-medium text-foreground">{label}</div>
        <div className="mt-1.5 space-y-1.5 text-muted-foreground">{children}</div>
      </PopoverContent>
    </Popover>
  );
}
