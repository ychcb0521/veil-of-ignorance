/**
 * 复盘中心：主 Header 上的统一下拉菜单
 * - 桌面：DropdownMenu
 * - 移动（<md）：Sheet 抽屉
 */
import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet';
import {
  LayoutGrid, ChevronDown, CheckCheck,
  Wallet, BarChart3, BookOpen, Gauge, ShieldCheck, Tags,
} from 'lucide-react';

interface NavItem {
  key: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  action: () => void;
  isActive: () => boolean;
}

interface Props {
  onOpenAssets: () => void;
  onOpenAnalytics: () => void;
}

function useNavItems(
  onOpenAssets: () => void,
  onOpenAnalytics: () => void,
): (NavItem | 'sep')[] {
  const nav = useNavigate();
  const loc = useLocation();
  return [
    { key: 'assets', icon: Wallet, label: '资产', action: onOpenAssets, isActive: () => false },
    { key: 'analytics', icon: BarChart3, label: '数据归因', action: onOpenAnalytics, isActive: () => false },
    'sep',
    {
      key: 'journal', icon: BookOpen, label: '错题集',
      action: () => nav('/journal'),
      isActive: () => loc.pathname === '/journal' || (loc.pathname.startsWith('/journal/') &&
        !['/journal/insights', '/journal/rules', '/journal/tags'].includes(loc.pathname)),
    },
    { key: 'insights', icon: Gauge, label: '元监控', action: () => nav('/journal/insights'), isActive: () => loc.pathname === '/journal/insights' },
    { key: 'rules', icon: ShieldCheck, label: '规则', action: () => nav('/journal/rules'), isActive: () => loc.pathname === '/journal/rules' },
    { key: 'tags', icon: Tags, label: '标签字典', action: () => nav('/journal/tags'), isActive: () => loc.pathname === '/journal/tags' },
  ];
}

export function JournalNavMenu({ onOpenAssets, onOpenAnalytics }: Props) {
  const [open, setOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const items = useNavItems(onOpenAssets, onOpenAnalytics);

  const triggerBtn = (extraClass = '') => (
    <button
      className={`flex items-center gap-1.5 px-2 py-1 rounded text-[12px] text-muted-foreground hover:text-foreground hover:bg-card transition-colors ${extraClass}`}
    >
      <LayoutGrid className="h-3.5 w-3.5" />
      <span>复盘中心</span>
      <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
  );

  return (
    <>
      {/* 桌面 */}
      <div className="hidden md:block">
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger asChild>{triggerBtn()}</DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="bg-card border-border text-foreground min-w-[200px] p-1"
          >
            {items.map((it, i) => {
              if (it === 'sep') return <DropdownMenuSeparator key={`sep-${i}`} className="bg-muted" />;
              const Icon = it.icon;
              const active = it.isActive();
              return (
                <DropdownMenuItem
                  key={it.key}
                  onClick={() => { it.action(); setOpen(false); }}
                  className={`h-8 px-2 text-[12px] rounded hover:bg-muted cursor-pointer flex items-center gap-2 ${active ? 'text-[#F0B90B]' : ''}`}
                >
                  {active ? <CheckCheck className="h-3.5 w-3.5 text-[#F0B90B]" /> : <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
                  <span>{it.label}</span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* 移动 */}
      <div className="md:hidden">
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <button className="flex items-center gap-1.5 px-2 py-1 rounded text-[12px] text-muted-foreground hover:text-foreground hover:bg-card transition-colors">
              <LayoutGrid className="h-3.5 w-3.5" />
              <span>复盘中心</span>
            </button>
          </SheetTrigger>
          <SheetContent
            side="right"
            className="bg-card border-border text-foreground w-[260px] p-0"
          >
            <SheetHeader className="px-4 py-3 border-b border-border">
              <SheetTitle className="text-[13px] text-foreground text-left">复盘中心</SheetTitle>
            </SheetHeader>
            <div className="p-2">
              {items.map((it, i) => {
                if (it === 'sep') return <div key={`sep-${i}`} className="h-px my-1 bg-muted" />;
                const Icon = it.icon;
                const active = it.isActive();
                return (
                  <button
                    key={it.key}
                    onClick={() => { it.action(); setSheetOpen(false); }}
                    className={`w-full h-10 px-3 text-[13px] rounded hover:bg-muted flex items-center gap-2 ${active ? 'text-[#F0B90B] bg-[#F0B90B]/5' : ''}`}
                  >
                    {active ? <CheckCheck className="h-4 w-4 text-[#F0B90B]" /> : <Icon className="h-4 w-4 text-muted-foreground" />}
                    <span>{it.label}</span>
                  </button>
                );
              })}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
