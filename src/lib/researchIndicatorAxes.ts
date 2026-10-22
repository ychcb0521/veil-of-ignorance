import type { Chart } from 'klinecharts';
import { researchIndicatorForKc } from '@/lib/researchIndicators';

interface PaneAxisAccess {
  getDrawPaneById?: (id: string) => { getAxisComponent?: () => { isReverse?: () => boolean } } | null;
}

/**
 * KlineCharts 9.8 exposes reverse only for the candle axis. Its per-pane axis
 * templates customize ticks, not the pixel conversions. Seller series now carry their negative sign; keep this one axis normal
 * so negative strength goes down and existing reversed panes are reset.
 * Keep this version-specific access here; never change the global price axis.
 */
export function configureResearchPaneAxis(chart: Chart, paneId: string | null, name: string): void {
  if (!paneId || paneId === 'candle_pane' || !researchIndicatorForKc(name)?.seller) return;
  const axis = (chart as unknown as PaneAxisAccess).getDrawPaneById?.(paneId)?.getAxisComponent?.();
  if (!axis || typeof axis.isReverse !== 'function') return;
  axis.isReverse = () => false;
  // A gap update forces native ticks and pixel coordinates to rebuild immediately.
  chart.setPaneOptions({ id: paneId, gap: { top: 0.12, bottom: 0.12 } });
}
