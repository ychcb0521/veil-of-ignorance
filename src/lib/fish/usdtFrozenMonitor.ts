import type { ScreenedFishAdmission } from '@/hooks/useFishCdaTracking';
import type { QualityResult } from './quality';
import type { InstantManualExecution } from './instantManualExecution';
import type { ScreenedCdaTrigger, ScreenedPriceProgress } from './screenedCda';

/** Original signal identity and original frozen plan; never rebase or resave on device transfer. */
export interface UsdtFrozenMonitor {
  version: 1;
  admission: ScreenedFishAdmission;
  checkpoint?: QualityResult;
  manual?: InstantManualExecution;
  mirror?: NonNullable<ScreenedPriceProgress['mirror']>;
  sale?: ScreenedCdaTrigger;
}
