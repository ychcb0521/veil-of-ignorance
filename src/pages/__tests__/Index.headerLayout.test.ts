import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 顶栏中间一排多了持仓限制模式开关（约 117px）之后，右侧的邮箱让位：1280px 以下整个藏起来，
 * 1280px 起完整显示（需要时再截短）。此前它是 min-w-0、先被挤——1,120–1,260px 之间只剩几个像素的残影。
 * 真实浏览器里量过：1280 / 1440 邮箱 120px、顶栏无横向溢出；1120–1279 邮箱不显示、无溢出。
 */
describe('交易页顶栏：邮箱在窄一些的宽度下整个让位，不留残影', () => {
  const source = readFileSync(join(process.cwd(), 'src', 'pages', 'Index.tsx'), 'utf8');

  it('邮箱那一格 1280px 以下隐藏、以上显示并可截短；登出与复盘中心不缩', () => {
    const at = source.indexOf('{user?.email}');
    expect(at).toBeGreaterThan(-1);
    const span = source.slice(source.lastIndexOf('<span', at), at);
    expect(span).toContain('hidden min-[1280px]:block');
    expect(span).toContain('truncate min-w-0 max-w-[120px]');
    expect(source).toContain('className="shrink-0 whitespace-nowrap text-[10px] text-gray-600 dark:text-[#B7BDC6] hover:text-destructive');
  });
});
