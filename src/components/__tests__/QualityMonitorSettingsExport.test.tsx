/** 【用户要求】2026-11-04 持仓监测战役的「持仓监测」弹层里可以导出详细信息。 */
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { QualityMonitorSettingsButton } from '@/components/FishQualityMonitorSettingsView';
import { qualityMirrorCampaignFixture } from '@/test/fixtures/qualityMirrorCampaign';

afterEach(() => vi.restoreAllMocks());
it('导出详细信息：下载一个 xlsx，文件名带标的与方案，页面上写明已导出', async () => {
  const { campaign } = qualityMirrorCampaignFixture();
  const created = vi.fn(() => 'blob:x'); Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(<QualityMonitorSettingsButton plan={campaign.comparison!.monitorPlan!} campaign={campaign}/>);
  fireEvent.click(screen.getByRole('button', { name: '查看持仓监测设置' }));
  fireEvent.click(await screen.findByRole('button', { name: '导出详细信息' }));
  // 点击后才加载导出代码：负载高时会超过默认的 1 秒
  expect(await screen.findByRole('status', {}, { timeout: 10_000 })).toHaveTextContent(/已导出 持仓监测-TESTUSDT-.+\.xlsx/);
  expect(created).toHaveBeenCalledWith(expect.any(Blob)); expect(click).toHaveBeenCalledOnce();
});
it('没有战役数据时不显示导出按钮', () => {
  const { campaign } = qualityMirrorCampaignFixture();
  render(<QualityMonitorSettingsButton plan={campaign.comparison!.monitorPlan!}/>);
  fireEvent.click(screen.getByRole('button', { name: '查看持仓监测设置' }));
  expect(screen.queryByRole('button', { name: '导出详细信息' })).toBeNull();
});
