/** 页内共享展开状态；每次重新进入交易战役时默认折叠，不恢复历史展开偏好。 */
import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
let expanded = false;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) expanded = false;
  };
}

const getSnapshot = () => expanded;
const getServerSnapshot = () => false;
function toggle() {
  expanded = !expanded;
  listeners.forEach(listener => listener());
}

export function useShowMinorMetrics(): [boolean, () => void] {
  return [useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot), toggle];
}
