import {useEffect,useId,useState,type ReactNode} from 'react';
import {ChevronDown,ChevronUp} from 'lucide-react';
import {ResizableHandle,ResizablePanel,ResizablePanelGroup} from '@/components/ui/resizable';

export function useReplayDeskVisibility(activeReplaySymbol: string | null) {
  const [expanded,setExpanded] = useState(activeReplaySymbol!==null);
  useEffect(()=>{
    setExpanded(activeReplaySymbol!==null);
  },[activeReplaySymbol]);
  return [expanded,setExpanded] as const;
}

interface Props {
  expanded: boolean;
  onToggle: () => void;
  ticker: ReactNode;
  desk: ReactNode;
  positions: ReactNode;
}

export function ReplayDeskPanels({expanded,onToggle,ticker,desk,positions}:Props) {
  const deskId = useId();
  const toggleLabel = expanded?'折叠盘面':'展开盘面';
  return (
    <ResizablePanelGroup direction="vertical" className="h-full w-full">
      <ResizablePanel
        defaultSize={70}
        minSize={50}
        style={expanded?undefined:{flexBasis:'auto',flexGrow:0,flexShrink:0}}
      >
        <div className={`flex w-full min-h-0 flex-col ${expanded?'h-full':''}`}>
          <div className="flex shrink-0">
            <div className="min-w-0 flex-1">{ticker}</div>
            <button
              type="button"
              aria-label={toggleLabel}
              title={toggleLabel}
              aria-expanded={expanded}
              aria-controls={deskId}
              onClick={onToggle}
              className="grid w-10 shrink-0 place-items-center border-b border-l border-gray-200 bg-white text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary dark:border-[#2b3139] dark:bg-[#1e2329]"
            >
              {expanded?<ChevronUp className="h-4 w-4" aria-hidden="true"/>:<ChevronDown className="h-4 w-4" aria-hidden="true"/>}
            </button>
          </div>
          <div id={deskId} hidden={!expanded} className="min-h-0 min-w-0 flex-1">
            {desk}
          </div>
        </div>
      </ResizablePanel>
      <ResizableHandle withHandle disabled={!expanded} className={expanded?undefined:"hidden"} />
      <ResizablePanel defaultSize={30} minSize={15}>
        {positions}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
