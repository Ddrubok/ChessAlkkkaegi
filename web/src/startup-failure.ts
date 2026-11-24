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
  return "unknown";
}
