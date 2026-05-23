/**
 * 统一的子页面返回按钮：左上角 ArrowLeft，优先 navigate(-1)，否则回到 /
 */
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export function BackButton() {
  const nav = useNavigate();
  const handle = () => {
    if (window.history.length > 1) nav(-1);
    else nav('/');
  };
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={handle}
            aria-label="返回"
            className="h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-[#181A20] rounded shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-[11px]">返回上一页</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
