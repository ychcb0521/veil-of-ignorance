/**
 * 统一的子页面返回按钮：左上角 ArrowLeft。
 * - 传入 to 时直接跳转到该路由（如列表页返回主界面 /）。
 * - 未传 to 时优先 navigate(-1)，无历史则回到 /。
 */
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface BackButtonProps {
  /** 指定目标路由则直接跳转；否则走浏览器历史回退。 */
  to?: string;
}

export function BackButton({ to }: BackButtonProps) {
  const nav = useNavigate();
  const handle = () => {
    if (to) { nav(to); return; }
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
            className="h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-card rounded shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-[11px]">返回上一页</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
