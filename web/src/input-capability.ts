export interface PointerTypeEvent {
  // 포인터마다 마우스·터치·펜을 구분하는 브라우저 입력 종류다.
  readonly pointerType: string;
}

// UI 수준의 큰 터치 조작 선택에 쓸 현재 coarse-pointer 환경 신호다.
let coarsePointerEnvironment = false;

if (
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function"
) {
  const coarsePointerQuery = window.matchMedia("(pointer: coarse)");
  coarsePointerEnvironment = coarsePointerQuery.matches;
  coarsePointerQuery.addEventListener("change", (event) => {
    coarsePointerEnvironment = event.matches;
  });
}

/**
 * 현재 기본 포인터가 손가락처럼 정밀하지 않은 환경인지 반환하며 DOM 없는 도구에서는 false다.
 */
export function isCoarsePointerEnvironment(): boolean {
  return coarsePointerEnvironment;
}

/**
 * 환경 추정 대신 실제 개별 입력의 pointerType으로 터치 이벤트인지 판정한다.
 */
export function isTouchPointerEvent(
  event: PointerTypeEvent,
): boolean {
  return event.pointerType === "touch";
}
