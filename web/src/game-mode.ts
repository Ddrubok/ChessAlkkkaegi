export type GameMode = "hotseat" | "stage" | "online" | "tutorial";

export interface GameModeRuntime {
  // 현재 판에 적용된 2인·컴퓨터·온라인 상대 모드다.
  mode: GameMode;
  // 스테이지 런의 현재 단계이며 핫시트 전환과 패배 때 1로 돌아간다.
  stageNumber: number;
  // 메뉴 선택에 따른 보드 재생성 중 중복 클릭과 게임 입력을 막는 상태다.
  switching: boolean;
  // 선택한 모드로 전체 보드를 초기화하는 외부 연결점이다.
  onModeChanged: (mode: GameMode) => Promise<void>;
}

/**
 * 메뉴가 고른 모드의 전체 보드 재시작이 성공한 뒤에만 상태를 확정한다.
 */
export async function switchGameMode(
  runtime: GameModeRuntime,
  mode: GameMode,
  forceReset = false,
): Promise<void> {
  if (
    runtime.switching ||
    (!forceReset && runtime.mode === mode)
  ) {
    return;
  }
  const previousMode = runtime.mode;
  const previousStageNumber = runtime.stageNumber;
  runtime.switching = true;
  runtime.stageNumber = 1;
  try {
    await runtime.onModeChanged(mode);
    runtime.mode = mode;
  } catch (error: unknown) {
    runtime.mode = previousMode;
    runtime.stageNumber = previousStageNumber;
    throw error;
  } finally {
    runtime.switching = false;
  }
}

/**
 * 메인 메뉴가 제어할 기본 2인 모드 상태를 만든다.
 */
export function createGameModeRuntime(
  onModeChanged: (mode: GameMode) => Promise<void>,
): GameModeRuntime {
  return {
    mode: "hotseat",
    stageNumber: 1,
    switching: false,
    onModeChanged,
  };
}

/**
 * 다음 스테이지 또는 패배 재시작이 사용할 1 이상의 현재 단계를 설정한다.
 */
export function setStageNumber(
  runtime: GameModeRuntime,
  stageNumber: number,
): void {
  if (!Number.isInteger(stageNumber) || stageNumber < 1) {
    throw new Error(
      `설정할 스테이지 번호 ${stageNumber}가 1 이상의 정수가 아닙니다.`,
    );
  }
  runtime.stageNumber = stageNumber;
}
