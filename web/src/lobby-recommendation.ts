export type LobbyRecommendation =
  | { kind: "tutorial" }
  | { kind: "stage"; stage: number; maxClearedStage: number }
  | { kind: "online" };

export function isBasicTutorialCompleted(value: string | null): boolean {
  return value === "true";
}

export function pickLobbyRecommendation(input: {
  basicTutorialCompleted: boolean;
  maxClearedStage: number;
  maxStage: number;
}): LobbyRecommendation {
  if (!input.basicTutorialCompleted) return { kind: "tutorial" };
  if (input.maxClearedStage < input.maxStage) {
    return {
      kind: "stage",
      stage: input.maxClearedStage + 1,
      maxClearedStage: input.maxClearedStage,
    };
  }
  return { kind: "online" };
}
