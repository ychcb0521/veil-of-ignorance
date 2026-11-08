import {useState} from 'react';
import {Check,ChevronDown} from 'lucide-react';
import {Popover,PopoverTrigger} from './ui/popover';
import {FishPopoverContent} from './FishPopoverContent';
import type {QualityReturnUi} from '@/lib/fish/qualityReturn';
export function FishQualitySourcePicker({value,options,onSelect}:{value:QualityReturnUi['origin'];options:{value:QualityReturnUi['origin'];label:string;count:number}[];onSelect:(v:QualityReturnUi['origin'])=>void}){
 const [open,setOpen]=useState(false),selected=options.find(o=>o.value===value);
 return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><button type="button" role="combobox" aria-label="鱼质量的来源" aria-expanded={open} className="inline-flex h-7 shrink-0 items-center gap-2 rounded-md border border-transparent bg-muted/50 px-2 text-[11px] outline-none hover:bg-muted focus-visible:border-ring/60">{selected?.label??'全部来源'}（{selected?.count??0}）<ChevronDown className="h-3 w-3 text-muted-foreground/60"/></button></PopoverTrigger><FishPopoverContent align="start" className="w-48 p-1"><div role="listbox" aria-label="选择组合表来源">{options.map(option=><button key={option.value} type="button" role="option" aria-selected={option.value===value} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] hover:bg-muted" onClick={()=>{onSelect(option.value);setOpen(false);}}><Check className={'h-3 w-3 '+(option.value===value?'':'invisible')}/>{option.label}<span className="ml-auto font-mono text-muted-foreground">{option.count}</span></button>)}</div></FishPopoverContent></Popover>;
}
