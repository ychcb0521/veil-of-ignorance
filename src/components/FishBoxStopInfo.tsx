import type {KeyboardEvent,ReactNode} from 'react';
import {CircleHelp} from 'lucide-react';
import {Popover,PopoverContent,PopoverTrigger} from './ui/popover';
import {useSettingsImageCapture} from './SettingsImageExport';

/** A text-only help trigger remains usable inside disabled/read-only fieldsets. */
export function FishBoxStopInfo({label,children}:{label:string;children:ReactNode}){
 const capture=useSettingsImageCapture();
 const keyDown=(e:KeyboardEvent<HTMLSpanElement>)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.currentTarget.click();}};
 return <>
  <span hidden data-settings-image-include="" data-settings-image-shared-help="">{capture&&<><h5>{label}</h5>{children}</>}</span>
  <Popover><PopoverTrigger asChild><span role="button" tabIndex={0} aria-label={label} title={label} onKeyDown={keyDown}
   className="inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
   <CircleHelp aria-hidden strokeWidth={1.4} className="h-3.5 w-3.5"/>
  </span></PopoverTrigger><PopoverContent align="start" collisionPadding={12} aria-label={label}
   className="max-h-[min(75dvh,var(--radix-popover-content-available-height))] w-80 max-w-[calc(100vw-1.5rem)] space-y-2 overflow-y-auto overscroll-contain p-4 text-xs leading-relaxed">{children}</PopoverContent></Popover>
 </>;
}
