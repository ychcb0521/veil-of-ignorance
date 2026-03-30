interface Props {
  onOpenLong: () => void;
  onOpenShort: () => void;
}

export function MobileBottomBar({ onOpenLong, onOpenShort }: Props) {
  return (
    <div className="flex gap-3 px-4 py-3 border-t border-border bg-card shrink-0">
      <button onClick={onOpenLong} className="flex-1 btn-long py-3 text-sm font-bold rounded-lg">
        开仓
      </button>
      <button onClick={onOpenShort} className="flex-1 btn-short py-3 text-sm font-bold rounded-lg">
        平仓
      </button>
    </div>
  );
}
