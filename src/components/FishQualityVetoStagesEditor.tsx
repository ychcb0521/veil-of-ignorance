/**
 * 按加仓次数生效的否决条件（方案的 vetoStages）的编辑草稿。
 * 2026-11-01 起编辑入口在「③ 加仓细节 · 卖出」里按次设置（FishQualityAdditionEditor），原来 ④ 里的分阶段编辑器已移除。
 */
import type {HoldingVetoDraft} from '@/lib/fish/qualityFilters';
export interface VetoStageDraft {afterAdditions:string;conditions:HoldingVetoDraft[]}
export interface VetoStagesDraft {enabled:boolean;mode:'overlay'|'replace';peakBasis:'holding'|'stage';stages:VetoStageDraft[]}
