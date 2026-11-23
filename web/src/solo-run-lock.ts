import { PLATFORM } from "./platform";

export type SoloRunTabClaim = "acquired" | "occupied" | "session-only";

/** One writer per platform and progress owner. Locks release on document destruction. */
export function claimSoloRunTab(owner: string | null): Promise<SoloRunTabClaim> {
  let locks: LockManager | undefined;
  try { locks = navigator.locks; } catch { return Promise.resolve("session-only"); }
  if (!locks) return Promise.resolve("session-only");
  return new Promise(resolve => {
    try {
      void locks.request(`chess-alkkagi:${PLATFORM.id}-progress:${owner ?? "guest"}`, { ifAvailable: true }, lock => {
        if (!lock) { resolve("occupied"); return; }
        resolve("acquired");
        return new Promise<void>(release => {
          window.addEventListener("pagehide", () => release(), { once: true });
          window.addEventListener("pageshow", event => { if (event.persisted) window.location.reload(); });
        });
      }).catch(() => resolve("session-only"));
    } catch { resolve("session-only"); }
  });
}
