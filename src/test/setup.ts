import "@testing-library/jest-dom";
import { FISH_PANEL_DEFAULTS } from "@/components/fishPanelDefaults";

// 常规交互测试直接访问折叠区里的控件。
Object.assign(FISH_PANEL_DEFAULTS, { catching: true, cabin: true });

if (typeof window !== "undefined") Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
