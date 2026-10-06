import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { installLovableBadgeSuppression } from "./lib/lovableBadgeSuppression";
import { logBuildStamp } from "./lib/buildStamp";
import { ensureCriticalStorageHeadroom } from "./lib/persistedStateStorage";

installLovableBadgeSuppression();
logBuildStamp();
// 登录库此刻刚发起恢复、还没等到网络回应：赶在它落盘新令牌之前给令牌留出位置。
ensureCriticalStorageHeadroom();
createRoot(document.getElementById("root")!).render(<App />);
