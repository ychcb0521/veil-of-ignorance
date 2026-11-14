import type { ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from './ui/dropdown-menu';

export function FishLibraryDataMenu({ name, disabled, children }: {
  name: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button type="button" aria-label={name + '导入导出'} disabled={disabled}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover/library-header:opacity-100 group-focus-within/library-header:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-70">
        <MoreHorizontal aria-hidden className="h-3.5 w-3.5"/>
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">{children}</DropdownMenuContent>
  </DropdownMenu>;
}
