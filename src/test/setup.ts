import "@testing-library/jest-dom";
import { FISH_PANEL_DEFAULTS } from "@/components/fishPanelDefaults";

// 2026-11-04 网站上「捕捞」「鱼舱」默认折叠；已有测试都在测展开后的功能，测试环境默认展开（默认折叠由 FishPanel.defaultCollapsed 测试覆盖）
Object.assign(FISH_PANEL_DEFAULTS, { catching: true, cabin: true });

Object.defineProperty(window, "matchMedia", {
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
