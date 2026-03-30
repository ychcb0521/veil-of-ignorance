import { useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export default function OnboardingPage() {
  const { initializeAccount } = useAuth();
  const [capital, setCapital] = useState(100000);
  const [inputValue, setInputValue] = useState('100,000');
  const [loading, setLoading] = useState(false);

  const MIN = 100;
  const MAX = 10_000_000;
  const STEP = 100;

  const formatNumber = (n: number) => n.toLocaleString('en-US');

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value);
    setCapital(val);
    setInputValue(formatNumber(val));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9]/g, '');
    setInputValue(e.target.value);
    const num = parseInt(raw);
    if (!isNaN(num)) {
      const clamped = Math.min(MAX, Math.max(MIN, num));
      setCapital(clamped);
    }
  };

  const handleInputBlur = () => {
    const clamped = Math.min(MAX, Math.max(MIN, capital));
    setCapital(clamped);
    setInputValue(formatNumber(clamped));
  };

  const handleConfirm = async () => {
    setLoading(true);
    const ok = await initializeAccount(capital);
    setLoading(false);
    if (ok) {
      toast.success('账户初始化完成', { description: `初始资金 ${formatNumber(capital)} USDT` });
    } else {
      toast.error('初始化失败，请重试');
    }
  };

  // Slider progress percentage
  const progress = ((capital - MIN) / (MAX - MIN)) * 100;

  // Preset buttons
  const presets = [1_000, 10_000, 50_000, 100_000, 500_000, 1_000_000, 5_000_000, 10_000_000];

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#0B0E11' }}>
      <div className="w-full max-w-lg mx-4">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="text-5xl mb-4">💰</div>
          <h1 className="text-xl font-bold text-foreground">设置你的模拟账户初始资金</h1>
          <p className="text-sm text-muted-foreground mt-2">选择一个初始金额开始你的模拟交易之旅</p>
        </div>

        {/* Card */}
        <div className="rounded-xl border border-border p-6 space-y-6" style={{ background: 'hsl(var(--card))' }}>
          {/* Large number display */}
          <div className="text-center">
            <div className="relative inline-block">
              <input
                type="text"
                value={inputValue}
                onChange={handleInputChange}
                onBlur={handleInputBlur}
                className="text-3xl font-mono font-bold text-center bg-transparent border-none outline-none text-primary w-[280px]"
              />
              <span className="text-lg text-muted-foreground font-medium ml-1">USDT</span>
            </div>
          </div>

          {/* Slider */}
          <div className="px-2">
            <input
              type="range"
              min={MIN}
              max={MAX}
              step={STEP}
              value={capital}
              onChange={handleSliderChange}
              className="w-full h-2 rounded-full appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, hsl(var(--primary)) ${progress}%, hsl(var(--secondary)) ${progress}%)`,
              }}
            />
            <div className="flex justify-between mt-1.5 text-[10px] text-muted-foreground font-mono">
              <span>{formatNumber(MIN)}</span>
              <span>{formatNumber(MAX)}</span>
            </div>
          </div>

          {/* Preset buttons */}
          <div className="flex flex-wrap gap-1.5 justify-center">
            {presets.map(p => (
              <button
                key={p}
                onClick={() => {
                  setCapital(p);
                  setInputValue(formatNumber(p));
                }}
                className={`px-2.5 py-1 rounded-md text-xs font-mono transition-all ${
                  capital === p
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-secondary-foreground hover:bg-accent'
                }`}
              >
                {p >= 1_000_000 ? `${p / 1_000_000}M` : p >= 1_000 ? `${p / 1_000}K` : p}
              </button>
            ))}
          </div>

          {/* Info */}
          <div className="rounded-lg p-3 text-[11px] text-muted-foreground space-y-1" style={{ background: 'hsl(var(--secondary))' }}>
            <p>📌 初始资金设定后将作为你的模拟交易基准</p>
            <p>📌 所有盈亏、收益率将基于此金额计算</p>
            <p>📌 此设置确认后不可更改</p>
          </div>

          {/* Confirm */}
          <button
            onClick={handleConfirm}
            disabled={loading || capital < MIN}
            className="w-full py-3 rounded-lg text-sm font-bold transition-all disabled:opacity-50"
            style={{
              background: 'hsl(var(--primary))',
              color: 'hsl(var(--primary-foreground))',
            }}
          >
            {loading ? '初始化中...' : `确认并开启模拟 (${formatNumber(capital)} USDT)`}
          </button>
        </div>
      </div>
    </div>
  );
}
