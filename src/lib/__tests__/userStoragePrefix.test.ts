// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { getUserId, getUserPrefix } from '../userStoragePrefix';

afterEach(() => localStorage.clear());

it('refreshes the cached account after same-tab writes, logout and a different storage key', () => {
  const key = 'sb-replay-test-auth-token';
  localStorage.setItem(key, JSON.stringify({ user: { id: 'first' } }));
  expect(getUserPrefix()).toBe('sim_first_');
  localStorage.setItem(key, JSON.stringify({ user: { id: 'second' } }));
  expect(getUserId()).toBe('second');
  localStorage.setItem(key, '{');
  expect(getUserPrefix()).toBe('sim_anon_');
  localStorage.removeItem(key);
  expect(getUserId()).toBeNull();
  localStorage.setItem('sb-other-test-auth-token', JSON.stringify({ user: { id: 'third' } }));
  expect(getUserPrefix()).toBe('sim_third_');
});
