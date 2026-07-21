import { afterEach, describe, expect, it } from "vitest";
import { installLovableBadgeSuppression } from "../lovableBadgeSuppression";

const flushMutations = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("installLovableBadgeSuppression", () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    document.body.innerHTML = "";
  });

  it("removes an existing Lovable badge without removing ordinary links", () => {
    document.body.innerHTML = `
      <a id="lovable-badge" href="https://lovable.dev">Edit with Lovable</a>
      <a id="ordinary-link" href="/journal">交易战役</a>
    `;

    cleanup = installLovableBadgeSuppression();

    expect(document.querySelector("#lovable-badge")).toBeNull();
    expect(document.querySelector("#ordinary-link")).not.toBeNull();
  });

  it("removes a badge injected after the application starts", async () => {
    cleanup = installLovableBadgeSuppression();

    const badge = document.createElement("a");
    badge.href = "https://lovable.dev";
    badge.textContent = "Edit with Lovable";
    document.body.appendChild(badge);
    await flushMutations();

    expect(document.body.contains(badge)).toBe(false);
  });

  it("does not remove non-interactive page copy mentioning Lovable", () => {
    document.body.innerHTML = '<p id="copy">Edit with Lovable is disabled.</p>';

    cleanup = installLovableBadgeSuppression();

    expect(document.querySelector("#copy")).not.toBeNull();
  });
});
