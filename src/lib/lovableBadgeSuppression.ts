const BADGE_TEXT = "edit with lovable";

const EXPLICIT_BADGE_SELECTOR = [
  "#lovable-badge",
  "[data-lovable-badge]",
  '[data-testid="lovable-badge"]',
  '[id*="lovable-badge" i]',
  '[class*="lovable-badge" i]',
  '[aria-label*="Edit with Lovable" i]',
  '[title*="Edit with Lovable" i]',
].join(",");

const CLICKABLE_SELECTOR = "a, button, [role='button']";

const normalizeText = (value: string | null | undefined) =>
  (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();

const removeBadgeElement = (element: Element) => {
  if (element.matches(EXPLICIT_BADGE_SELECTOR)) {
    element.remove();
    return;
  }

  if (!normalizeText(element.textContent).includes(BADGE_TEXT)) return;

  const clickable = element.matches(CLICKABLE_SELECTOR)
    ? element
    : element.closest(CLICKABLE_SELECTOR);

  // Text matching is deliberately limited to an interactive badge container.
  // This preserves ordinary page copy that may happen to mention Lovable.
  clickable?.remove();
};

const scanRoot = (root: ParentNode) => {
  if (root instanceof Element) removeBadgeElement(root);

  root.querySelectorAll(EXPLICIT_BADGE_SELECTOR).forEach((element) => element.remove());
  root.querySelectorAll(CLICKABLE_SELECTOR).forEach(removeBadgeElement);

  root.querySelectorAll("*").forEach((element) => {
    if (element.shadowRoot) scanRoot(element.shadowRoot);
  });
};

export const installLovableBadgeSuppression = (doc: Document = document) => {
  const scanDocument = () => scanRoot(doc);
  scanDocument();

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "characterData") {
        const parent = mutation.target.parentElement;
        if (parent) scanRoot(parent);
        continue;
      }

      mutation.addedNodes.forEach((node) => {
        if (node instanceof Element || node instanceof DocumentFragment) scanRoot(node);
      });
    }
  });

  observer.observe(doc.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  return () => observer.disconnect();
};
