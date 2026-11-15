import type { FishQualityStudy } from './quality';

/** Never upload a directory entry if local storage could not first save its body. */
export function assertQualityArchivesDetached(study: FishQualityStudy | undefined): void {
  if (study?.monitorLibrary?.archives?.some(archive => archive.study)) {
    throw Error('持仓监测归档正文还未单独保存，本机原文已保留，暂缓云端备份');
  }
}
