import { expect, it, vi } from 'vitest';
import { readMacUsdtCredentials, saveMacUsdtCredentials } from '../../../scripts/usdt-macos-credentials';

const apiKey = 'K'.repeat(64), secret = 'S'.repeat(64);
it('sends secrets through stdin only, verifies Keychain readback and clears temporary buffers', () => {
  let saved = '', inputRef: Buffer | undefined, readRef: Buffer | undefined;
  const run = vi.fn((args: string[], input?: Buffer) => {
    expect(args.join(' ')).not.toContain(apiKey);
    expect(args.join(' ')).not.toContain(secret);
    if (args[0] === '-i') { inputRef = input; saved = input!.toString().match(/-w ([A-Za-z0-9+/=]+)\n$/)![1]; return Buffer.alloc(0); }
    readRef = Buffer.from(saved + '\n'); return readRef;
  });
  saveMacUsdtCredentials('/test/Veil', apiKey, secret, run);
  expect(run).toHaveBeenCalledTimes(2);
  expect(inputRef!.every(byte => byte === 0)).toBe(true);
  expect(readRef!.every(byte => byte === 0)).toBe(true);
  const result = readMacUsdtCredentials('/test/Veil', run);
  expect(result.apiKey).toBe(apiKey); expect(result.secret.toString()).toBe(secret);
  result.secret.fill(0);
});
it('rejects command metacharacters and fails closed when Keychain readback differs', () => {
  const never = vi.fn();
  expect(() => saveMacUsdtCredentials('/test', apiKey + '\nquit', secret, never)).toThrow('格式');
  expect(never).not.toHaveBeenCalled();
  const wrong = () => Buffer.from(Buffer.from(JSON.stringify({ apiKey, secret: 'T'.repeat(64) })).toString('base64'));
  expect(() => saveMacUsdtCredentials('/test', apiKey, secret, wrong)).toThrow('回读');
  expect(() => readMacUsdtCredentials('/test', () => { throw Error('private detail'); })).toThrow('钥匙串');
});
