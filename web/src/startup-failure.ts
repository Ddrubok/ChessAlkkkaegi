export type StartupFailureKind = "graphics" | "download" | "unknown";

export class StartupFailure extends Error {
  constructor(readonly kind: Exclude<StartupFailureKind, "unknown">, cause: unknown) {
    super(`Startup ${kind} failure`, { cause });
  }
}

export function startupFailureKind(error: unknown): StartupFailureKind {
  if (error instanceof StartupFailure) return error.kind;
  // Module downloads fail before main.ts can run, including the CrazyGames entry.
  if (error instanceof TypeError && /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i.test(error.message)) return "download";
  // Native fetch and Three FileLoader use different error shapes across browsers.
  if (error instanceof Error && /^fetch for ".*" responded with \d+/i.test(error.message)) return "download";
  if (error instanceof TypeError && /failed to fetch|networkerror|network request failed|^load failed$/i.test(error.message)) return "download";
  if (error instanceof Error && /chess-set\.meta\.json.*HTTP \d+/i.test(error.message)) return "download";
  return "unknown";
}
