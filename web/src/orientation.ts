import { isCoarsePointerEnvironment } from "./input-capability";

// 매치 활성 여부를 CSS의 세로 화면·coarse 포인터 조건과 결합하는 루트 클래스다.
const MATCH_ACTIVE_CLASS = "touch-match-active";
// 앱 전체에서 하나만 유지할 회전 안내 오버레이의 안정적인 식별자다.
const ORIENTATION_OVERLAY_ID = "touch-orientation-overlay";
// 이 모듈이 전체화면·방향 잠금을 시도한 터치 매치만 복귀 때 해제한다.
let matchOrientationRequested = false;

interface LockableOrientation {
  // 전체화면 진입 뒤 지원 브라우저에서 가로 방향을 고정하는 선택 API다.
  lock?: (orientation: "landscape") => Promise<void>;
  // 메뉴 복귀 시 운영체제의 자동 회전을 다시 허용하는 선택 API다.
  unlock?: () => void;
}

/**
 * 세 조건이 모두 맞을 때만 회전 안내가 필요한지 DOM 없이 판정한다.
 */
export function shouldShowPortraitGuidance(
  matchActive: boolean,
  coarsePointer: boolean,
  portrait: boolean,
): boolean {
  return matchActive && coarsePointer && portrait;
}

/**
 * CSS가 세로·coarse 조건과 결합할 수 있도록 현재 매치 활성 상태만 기록한다.
 */
export function setMatchOrientationActive(active: boolean): void {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.classList.toggle(
    MATCH_ACTIVE_CLASS,
    active,
  );
}

/**
 * 회전 안내를 앱 위에 한 번 만들며 외부 이미지 없이 휴대전화 회전 모양을 그린다.
 */
export function ensureOrientationOverlay(
  container: HTMLElement,
): HTMLElement {
  const existing = document.getElementById(ORIENTATION_OVERLAY_ID);
  if (existing !== null) {
    return existing;
  }
  const overlay = document.createElement("section");
  overlay.id = ORIENTATION_OVERLAY_ID;
  overlay.className = "touch-orientation-overlay";
  overlay.setAttribute("role", "status");
  overlay.setAttribute("aria-live", "polite");
  overlay.innerHTML = `
    <div class="touch-orientation-glyph" aria-hidden="true">
      <span class="touch-orientation-phone"></span>
      <span class="touch-orientation-arrow">↻</span>
    </div>
    <strong>가로로 돌려서 플레이해 주세요</strong>
  `;
  container.append(overlay);
  return overlay;
}

/**
 * 터치 환경의 사용자 제스처 안에서 전체화면 진입 뒤 가로 잠금을 순서대로 시도한다.
 */
export async function requestLandscapeForMatch(): Promise<void> {
  if (
    !isCoarsePointerEnvironment() ||
    typeof document === "undefined" ||
    typeof screen === "undefined"
  ) {
    return;
  }
  matchOrientationRequested = true;
  const root = document.documentElement;
  if (
    document.fullscreenElement === null &&
    typeof root.requestFullscreen === "function"
  ) {
    try {
      await root.requestFullscreen();
    } catch {
      // 미지원·권한 거절 환경에서는 세로 안내만 사용한다.
    }
  }
  const orientation = screen.orientation as LockableOrientation;
  if (typeof orientation?.lock === "function") {
    try {
      await orientation.lock("landscape");
    } catch {
      // iPhone Safari 등 잠금 미지원 환경에서는 자동 회전을 유지한다.
    }
  }
}

/**
 * 메뉴 복귀 때 가로 잠금과 전체화면을 각각 최선 노력으로 해제한다.
 */
export async function releaseAfterMatch(): Promise<void> {
  setMatchOrientationActive(false);
  if (!matchOrientationRequested) {
    return;
  }
  matchOrientationRequested = false;
  if (
    typeof document === "undefined" ||
    typeof screen === "undefined"
  ) {
    return;
  }
  const orientation = screen.orientation as LockableOrientation;
  if (typeof orientation?.unlock === "function") {
    try {
      orientation.unlock();
    } catch {
      // 이미 풀렸거나 미지원인 환경에서는 추가 조치가 필요 없다.
    }
  }
  if (
    document.fullscreenElement !== null &&
    typeof document.exitFullscreen === "function"
  ) {
    try {
      await document.exitFullscreen();
    } catch {
      // 브라우저가 자체적으로 전체화면을 끝냈다면 그대로 메뉴를 연다.
    }
  }
}
