import { afterEach, describe, expect, it, vi } from "vitest";
import { installAssetRolloverRecovery } from "./assetRecovery";

afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("asset rollover recovery", () => {
  it("reloads once when Vite reports a stale preload and suppresses loops", () => {
    const reload = vi.fn();
    const uninstall = installAssetRolloverRecovery(reload);

    window.dispatchEvent(new Event("vite:preloadError", { cancelable: true }));
    window.dispatchEvent(new Event("vite:preloadError", { cancelable: true }));

    expect(reload).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem("programloom:asset-rollover-recovery"))
      .toMatch(/^\d+$/);
    uninstall();
  });
});
