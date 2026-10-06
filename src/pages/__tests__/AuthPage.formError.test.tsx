import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const signIn = vi.hoisted(() => vi.fn());
const signUp = vi.hoisted(() => vi.fn());
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ signIn, signUp }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: {} } }));

import AuthPage from '@/pages/AuthPage';

beforeEach(() => { signIn.mockReset(); signUp.mockReset(); });
afterEach(() => cleanup());

async function submit(view: ReturnType<typeof render>) {
  fireEvent.change(view.container.querySelector('input[type="email"]')!, { target: { value: 'a@b.c' } });
  fireEvent.change(view.container.querySelector('input[type="password"]')!, { target: { value: 'secret-pw' } });
  await act(async () => { fireEvent.submit(view.container.querySelector('form')!); });
}

/**
 * 【事故】「登陆无效」：提示默认只进消息记录、不弹出，而登录之前打不开消息记录——
 * 登录失败在页面上什么都看不到，分不清是密码不对还是本地存储写满。
 */
describe('登录页直接写出失败原因', () => {
  it('存储写满：原因与占用明细原样写在按钮下方，按钮恢复可点', async () => {
    signIn.mockResolvedValue({ error: '浏览器给本站的本地存储已写满，登录令牌存不进去。占用最大的是：成交历史 4.61 MB · 撤单快照 0.22 MB' });
    const view = render(<AuthPage />);
    expect(view.queryByTestId('auth-form-error')).toBeNull();
    await submit(view);
    const error = view.getByTestId('auth-form-error');
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toBe('登录失败：浏览器给本站的本地存储已写满，登录令牌存不进去。占用最大的是：成交历史 4.61 MB · 撤单快照 0.22 MB');
    expect((view.container.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('常见的英文报错换成看得懂的话；再次提交先清掉上一条；成功后不留错误', async () => {
    signIn.mockResolvedValueOnce({ error: 'Invalid login credentials' });
    const view = render(<AuthPage />);
    await submit(view);
    expect(view.getByTestId('auth-form-error').textContent).toBe('登录失败：邮箱或密码不对');
    signIn.mockResolvedValueOnce({ error: 'Failed to fetch' });
    await submit(view);
    expect(view.getByTestId('auth-form-error').textContent).toBe('登录失败：连不上登录服务，检查网络后再试');
    signIn.mockResolvedValueOnce({ error: null });
    await submit(view);
    expect(view.queryByTestId('auth-form-error')).toBeNull();
  });

  it('切到注册页签时清掉登录的错误；注册失败同样写出来', async () => {
    signIn.mockResolvedValueOnce({ error: 'Invalid login credentials' });
    const view = render(<AuthPage />);
    await submit(view);
    expect(view.getByTestId('auth-form-error')).toBeTruthy();
    act(() => { fireEvent.click(view.getByText('立即注册')); });
    expect(view.queryByTestId('auth-form-error')).toBeNull();
    signUp.mockResolvedValueOnce({ error: 'User already registered' });
    await submit(view);
    expect(view.getByTestId('auth-form-error').textContent).toBe('注册失败：该邮箱已被注册');
  });
});
