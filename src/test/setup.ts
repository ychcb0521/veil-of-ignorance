import "@testing-library/jest-dom";
import { FISH_PANEL_DEFAULTS } from "@/components/fishPanelDefaults";

// 在常规交互测试中展开鱼舱。FishPanel.defaultCollapsed 单独覆盖默认折叠。
Object.assign(FISH_PANEL_DEFAULTS, { cabin: true });

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
