/**
 * 不要浏览器自带的黑框悬停提示（HTML 的 title 属性）。
 * 【用户要求】2026-10-21「黑框提示一律都不要」——逐个删不完（几百处），在入口统一处理：
 * 页面上出现的 title 一律拿掉；文字不丢：只有图标、没有文字也没有 aria-label 的元素，把它记成 aria-label（读屏用的名字），
 * 其余记成 aria-description。界面上看不到任何变化，只是悬停不再弹黑框。
 */
export function stripNativeTooltip(el: Element): void {
  const text = el.getAttribute('title');
  if (text === null) return;
  el.removeAttribute('title');
  if (!text.trim()) return;
  const named = el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') || !!el.textContent?.trim();
  if (!named) el.setAttribute('aria-label', text);
  else if (!el.hasAttribute('aria-description')) el.setAttribute('aria-description', text);
}

/** 先清掉已有的，再盯住之后新加的元素和改动的 title。返回停止函数。 */
export function installNoNativeTooltips(root: Document = document): () => void {
  if (typeof MutationObserver === 'undefined' || !root.documentElement) return () => {};
  const sweep = (node: Node) => {
    if (node.nodeType !== 1) return;
    const el = node as Element;
    stripNativeTooltip(el);
    el.querySelectorAll('[title]').forEach(stripNativeTooltip);
  };
  sweep(root.documentElement);
  const observer = new MutationObserver(records => {
    for (const r of records) {
      if (r.type === 'attributes') stripNativeTooltip(r.target as Element);
      else r.addedNodes.forEach(sweep);
    }
  });
  observer.observe(root.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] });
  return () => observer.disconnect();
}
