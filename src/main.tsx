import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { installLovableBadgeSuppression } from "./lib/lovableBadgeSuppression";

installLovableBadgeSuppression();
createRoot(document.getElementById("root")!).render(<App />);
