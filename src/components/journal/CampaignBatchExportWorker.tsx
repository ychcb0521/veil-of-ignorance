import JournalCampaignDetailPage from '@/pages/JournalCampaignDetailPage';
import { Component, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { CampaignBatchExportWorkerProps } from '@/lib/campaignBatchExportContext';

// 对外入口：调用方只认这里，不直接依赖批量缓存的内部类型。
// eslint-disable-next-line react-refresh/only-export-components
export { createCampaignBatchExportSnapshot } from '@/lib/campaignBatchExportContext';
export type { CampaignBatchExportWorkerProps, CampaignBatchExportSnapshot, CampaignBatchExportResult } from '@/lib/campaignBatchExportContext';

/**
 * 详情页在批量模式下渲染出错（数据形状异常、某个计算抛错）只算这一场失败：
 * 没有这层边界，错误会一路冒到战役列表页，把整页连同导出弹窗一起卸掉。
 */
class BatchWorkerBoundary extends Component<{ children: ReactNode; onError: (error: Error) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { this.props.onError(error); }
  render() { return this.state.failed ? null : this.props.children; }
}

/**
 * 批量导出的单场工人：把真实的战役详情页以 batchExport 模式挂在屏幕外，
 * 复用详情页的全部计算（结算、平仓价校正、盈亏概览、K 线标注），只是不渲染可编辑界面。
 * 挂到 document.body：不能放进弹窗——弹窗带 transform 且可滚动，屏幕外的固定定位盘面会变成相对弹窗定位、撑出滚动条。
 * 超时由弹窗统一计时（每场一个计时器），这里只负责把结果或错误回报一次。
 */
export function CampaignBatchExportWorker(props: CampaignBatchExportWorkerProps) {
  const callbacks = useRef(props);
  const active = useRef(true);
  const finished = useRef(false);
  callbacks.current = props;
  const { campaignId, userId, snapshot } = props;
  const interval = props.options.interval;
  const { metadata, overview, emotionDiary, chart, legs } = props.options.sections;
  // 队列进度刷新不能让这一场重新读数或重建原生 K 线：回调走 ref，传给详情页的对象只随设置变化。
  const stableProps = useMemo<CampaignBatchExportWorkerProps>(() => ({
    campaignId, userId, snapshot,
    options: { interval, sections: { metadata, overview, emotionDiary, chart, legs } },
    onComplete: result => {
      if (!active.current || finished.current) return;
      finished.current = true;
      callbacks.current.onComplete(result);
    },
    onError: error => {
      if (!active.current || finished.current) return;
      finished.current = true;
      callbacks.current.onError(error);
    },
  }), [campaignId, userId, snapshot, interval, metadata, overview, emotionDiary, chart, legs]);
  useEffect(() => {
    active.current = true;
    finished.current = false;
    return () => { active.current = false; };
  }, [stableProps]);
  return createPortal(
    <BatchWorkerBoundary key={campaignId} onError={stableProps.onError}>
      <JournalCampaignDetailPage key={campaignId} batchExport={stableProps} />
    </BatchWorkerBoundary>,
    document.body,
  );
}
