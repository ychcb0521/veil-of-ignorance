interface Props {
  method?: string | null;
}

const EXIT_METHOD_CONFIG: Record<string, { label: string; className: string }> = {
  manual: { label: '手动', className: 'text-foreground' },
  sl: { label: '止损', className: 'text-[#F6465D]' },
  tp1: { label: '止盈1', className: 'text-[#0ECB81]' },
  tp2: { label: '止盈2', className: 'text-[#0ECB81]' },
  tp3: { label: '止盈3', className: 'text-[#0ECB81]' },
  liquidation: {
    label: '爆仓',
    className: 'text-[#F6465D] bg-[#F6465D]/10 px-1.5 py-0.5 rounded font-medium',
  },
};

export function ExitMethodBadge({ method }: Props) {
  if (!method) return <span className="text-muted-foreground">—</span>;
  const cfg = EXIT_METHOD_CONFIG[method];
  if (!cfg) return <span className="text-muted-foreground">{method}</span>;
  return <span className={cfg.className}>{cfg.label}</span>;
}
