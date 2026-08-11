const recoveryKey = "programloom:asset-rollover-recovery";
const recoveryWindowMs = 60_000;

export function installAssetRolloverRecovery(
  reload: () => void = () => window.location.reload(),
) {
  const recoverFromStaleAsset = (event: Event) => {
    const now = Date.now();
    const previous = Number(window.sessionStorage.getItem(recoveryKey) ?? 0);
    event.preventDefault();
    if (Number.isFinite(previous) && now - previous < recoveryWindowMs) return;
    window.sessionStorage.setItem(recoveryKey, String(now));
    reload();
  };
  window.addEventListener("vite:preloadError", recoverFromStaleAsset);
  return () =>
    window.removeEventListener("vite:preloadError", recoverFromStaleAsset);
}
