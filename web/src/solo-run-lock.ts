import { PLATFORM } from "./platform";

/** One writer per platform and progress owner. Locks release on document destruction. */
export function claimSoloRunTab(owner: string | null): Promise<boolean> {
  if (!navigator.locks) return Promise.resolve(false);
  return new Promise(resolve => {
    void navigator.locks.request(`chess-alkkagi:${PLATFORM.id}-progress:${owner ?? "guest"}`, { ifAvailable: true }, lock => {
      if (!lock) { resolve(false); return; }
      resolve(true);
      return new Promise<void>(release => {
        window.addEventListener("pagehide", () => release(), { once: true });
        window.addEventListener("pageshow", event => { if (event.persisted) window.location.reload(); });
      });
    }).catch(() => resolve(false));
  });
}
