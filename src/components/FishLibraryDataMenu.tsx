import type { ReactNode } from 'react';
import { Download, MoreHorizontal, Upload } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu';
import type {FishLibraryExportActions} from './FishLibraryRowExport';

export function FishLibraryDataMenu({ name, disabled, children }: {
  name: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button type="button" aria-label={name + '导入导出'} title={name + '导入导出'} disabled={disabled}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover/library-header:opacity-100 group-focus-within/library-header:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-70">
        <MoreHorizontal aria-hidden className="h-3.5 w-3.5"/>
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">{children}</DropdownMenuContent>
  </DropdownMenu>;
}

export function FishLibraryTransferMenu({name,actions,onBackup,onUpload,backupDisabled,uploadDisabled,disabled}:{
  name:string;
  actions:FishLibraryExportActions;
  onBackup?:()=>void;
  onUpload?:()=>void;
  backupDisabled?:boolean;
  uploadDisabled?:boolean;
  disabled?:boolean;
}) {
  const {selected}=actions;
  return <FishLibraryDataMenu name={name} disabled={disabled}>
    <DropdownMenuItem className="text-xs" disabled={actions.busy||!selected?.count||selected.busy} onSelect={()=>selected?.run()}>
      <Download aria-hidden className="mr-2 h-3.5 w-3.5"/>导出已选行（Excel）{selected?.count? <span className="ml-2 tabular-nums text-muted-foreground">{selected.count}</span>:null}
    </DropdownMenuItem>
    <DropdownMenuItem className="text-xs" disabled={!!selected?.busy||!actions.canExportLibrary} onSelect={actions.exportLibrary}>
      <Download aria-hidden className="mr-2 h-3.5 w-3.5"/>导出库内记录（Excel）
    </DropdownMenuItem>
    {(onBackup||onUpload)&&<DropdownMenuSeparator/>}
    {onBackup&&<DropdownMenuItem className="text-xs" disabled={actions.busy||selected?.busy||backupDisabled} onSelect={onBackup}>
      <Download aria-hidden className="mr-2 h-3.5 w-3.5"/>下载备份（JSON）
    </DropdownMenuItem>}
    {onUpload&&<DropdownMenuItem className="text-xs" disabled={actions.busy||selected?.busy||uploadDisabled} onSelect={onUpload}>
      <Upload aria-hidden className="mr-2 h-3.5 w-3.5"/>上传备份（JSON）
    </DropdownMenuItem>}
  </FishLibraryDataMenu>;
}
