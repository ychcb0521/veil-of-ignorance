import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export default function AuthPage() {
  const { signIn, signUp } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setLoading(true);

    const { error } = isLogin
      ? await signIn(email, password)
      : await signUp(email, password);

    setLoading(false);
    if (error) {
      toast.error(isLogin ? '登录失败' : '注册失败', { description: error });
    } else if (!isLogin) {
      toast.success('注册成功', { description: '请查看邮箱确认链接，或直接登录' });
      setIsLogin(true);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#0B0E11' }}>
      <div className="w-full max-w-sm mx-4">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-primary tracking-widest">⚡ 无知之幕</h1>
          <p className="text-sm text-muted-foreground mt-2">加密货币合约模拟交易平台</p>
        </div>

        {/* Card */}
        <div className="rounded-xl border border-border p-6 space-y-5" style={{ background: 'hsl(var(--card))' }}>
          {/* Tabs */}
          <div className="flex gap-1 rounded-lg p-0.5" style={{ background: 'hsl(var(--secondary))' }}>
            {[
              { key: true, label: '登录' },
              { key: false, label: '注册' },
            ].map(({ key, label }) => (
              <button
                key={label}
                onClick={() => setIsLogin(key)}
                className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
                  isLogin === key
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block uppercase tracking-wider">邮箱</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="input-dark w-full text-sm"
                required
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block uppercase tracking-wider">密码</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="input-dark w-full text-sm"
                required
                minLength={6}
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-50"
              style={{
                background: 'hsl(var(--primary))',
                color: 'hsl(var(--primary-foreground))',
              }}
            >
              {loading ? '处理中...' : isLogin ? '登录' : '注册'}
            </button>
          </form>

          <p className="text-center text-[11px] text-muted-foreground">
            {isLogin ? '还没有账号？' : '已有账号？'}
            <button
              onClick={() => setIsLogin(!isLogin)}
              className="text-primary hover:underline ml-1"
            >
              {isLogin ? '立即注册' : '去登录'}
            </button>
          </p>
        </div>

        <p className="text-center text-[10px] text-muted-foreground/40 mt-6">
          所有交易数据仅保存在你的账户中，与其他用户完全隔离
        </p>
      </div>
    </div>
  );
}
