/** Elapsed ready-turn time, independent of the capped physics frame delta. */
export function createTurnClock(): (now: number, turnKey: string, ready: boolean) => number {
  let lastNow: number | null = null;
  let lastTurnKey = "";
  let wasReady = false;
  return (now, turnKey, ready) => {
    const elapsed = lastNow === null || lastTurnKey !== turnKey || !wasReady || !ready
      ? 0
      : Math.max(0, (now - lastNow) / 1000);
    lastNow = now;
    lastTurnKey = turnKey;
    wasReady = ready;
    return elapsed;
  };
}
