import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { installLovableBadgeSuppression } from "./lib/lovableBadgeSuppression";
import { logBuildStamp } from "./lib/buildStamp";

installLovableBadgeSuppression();
logBuildStamp();
createRoot(document.getElementById("root")!).render(<App />);
