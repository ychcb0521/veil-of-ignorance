import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { installLovableBadgeSuppression } from "./lib/lovableBadgeSuppression";
import { logBuildStamp } from "./lib/buildStamp";
import { installNoNativeTooltips } from "./lib/noNativeTooltips";
import { ensureCriticalStorageHeadroom, ensureStorageReserve, installAuthTokenWriteGuard } from "./lib/persistedStateStorage";
import { storageUsageBreakdown } from "./lib/authBootRecovery";

installLovableBadgeSuppression();
// 用户要求：浏览器自带的黑框悬停提示一律不要
installNoNativeTooltips();
logBuildStamp();
// 登录库此刻刚发起恢复、还没等到网络回应：赶在它落盘新令牌之前把位置腾好。
// 写入守卫管令牌真的写不进去的那一刻（含每小时一次的刷新）；另两步让缓存先让出余量。
installAuthTokenWriteGuard();
ensureCriticalStorageHeadroom();
// 缓存全部让位之后仍留不出余量：占满存储的是交易数据本身，把占用最大的几类记进控制台，查起来不用猜。
if (ensureStorageReserve() === 'full') {
  console.warn(`[无知之幕] 本地存储已近上限，图表缓存已全部让位。占用最大的是：${storageUsageBreakdown()}`);
}
createRoot(document.getElementById("root")!).render(<App />);
