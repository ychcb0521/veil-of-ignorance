import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type AuthStep = 'form' | 'verify';

export default function AuthPage() {
  const { signIn, signUp } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<AuthStep>('form');
  const [otp, setOtp] = useState('');
  const [resending, setResending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setLoading(true);

    if (isLogin) {
      const { error } = await signIn(email, password);
      setLoading(false);
      if (error) {
        if (error.includes('Email not confirmed')) {
          toast.error('邮箱未验证', { description: '请先完成邮箱验证' });
          setStep('verify');
        } else {
          toast.error('登录失败', { description: error });
        }
      }
    } else {
      const { error } = await signUp(email, password);
      setLoading(false);
      if (error) {
        if (error.includes('already registered') || error.includes('already been registered')) {
          toast.error('该邮箱已被注册');
        } else if (error.includes('password')) {
          toast.error('密码长度不足', { description: '密码至少需要6位字符' });
        } else {
          toast.error('注册失败', { description: error });
        }
      } else {
        toast.success('注册成功', { description: '验证邮件已发送，请查收' });
        setStep('verify');
      }
    }
  };

  const handleVerifyOtp = async () => {
    if (otp.length !== 6) return;
    setLoading(true);
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: otp,
      type: 'signup',
    });
    setLoading(false);
    if (error) {
      toast.error('验证码错误或已过期', { description: error.message });
    } else {
      toast.success('邮箱验证成功！');
    }
  };

  const handleResend = async () => {
    setResending(true);
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
    });
    setResending(false);
    if (error) {
      toast.error('发送失败', { description: error.message });
    } else {
      toast.success('验证邮件已重新发送');
    }
  };

  // Verify email step
  if (step === 'verify') {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0B0E11' }}>
        <div className="w-full max-w-sm mx-4">
          <div className="text-center mb-8">
            <div className="text-5xl mb-3">📧</div>
            <h1 className="text-xl font-bold text-foreground">检查您的收件箱</h1>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              我们已向 <span className="text-primary font-medium">{email}</span> 发送了验证邮件。
              <br />请查收并输入6位验证码以激活您的交易账户。
            </p>
          </div>

          <div className="rounded-xl border border-border p-6 space-y-5" style={{ background: 'hsl(var(--card))' }}>
            {/* OTP Input */}
            <div>
              <label className="text-xs text-muted-foreground mb-2 block uppercase tracking-wider">验证码</label>
              <div className="flex gap-1.5 justify-center">
                {Array.from({ length: 6 }).map((_, i) => (
                  <input
                    key={i}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={otp[i] || ''}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, '');
                      const newOtp = otp.split('');
                      newOtp[i] = val;
                      setOtp(newOtp.join('').slice(0, 6));
                      // Auto-focus next
                      if (val && i < 5) {
                        const next = e.target.parentElement?.children[i + 1] as HTMLInputElement;
                        next?.focus();
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Backspace' && !otp[i] && i > 0) {
                        const prev = (e.target as HTMLElement).parentElement?.children[i - 1] as HTMLInputElement;
                        prev?.focus();
                      }
                    }}
                    onPaste={(e) => {
                      e.preventDefault();
                      const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
                      setOtp(pasted);
                    }}
                    className="w-10 h-12 text-center text-lg font-mono font-bold rounded-lg border border-border bg-secondary text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                  />
                ))}
              </div>
            </div>

            <button
              onClick={handleVerifyOtp}
              disabled={loading || otp.length !== 6}
              className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-50"
              style={{
                background: 'hsl(var(--primary))',
                color: 'hsl(var(--primary-foreground))',
              }}
            >
              {loading ? '验证中...' : '验证并激活账户'}
            </button>

            <div className="text-center space-y-2">
              <p className="text-[11px] text-muted-foreground">
                也可以直接点击邮件中的验证链接完成验证
              </p>
              <button
                onClick={handleResend}
                disabled={resending}
                className="text-xs text-primary hover:underline disabled:opacity-50"
              >
                {resending ? '发送中...' : '重新发送验证邮件'}
              </button>
            </div>

            <div className="border-t border-border pt-3">
              <button
                onClick={() => { setStep('form'); setOtp(''); }}
                className="text-xs text-muted-foreground hover:text-foreground w-full text-center"
              >
                ← 返回登录
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Login/Register form
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#0B0E11' }}>
      <div className="w-full max-w-sm mx-4">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-primary tracking-widest">⚡ 无知之幕</h1>
          <p className="text-sm text-muted-foreground mt-2">加密货币合约模拟交易平台</p>
        </div>

        <div className="rounded-xl border border-border p-6 space-y-5" style={{ background: 'hsl(var(--card))' }}>
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
