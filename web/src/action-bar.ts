export interface ActionBarRect {
  // 클라이언트 좌표계의 왼쪽 경계다.
  left: number;
  // 클라이언트 좌표계의 위쪽 경계다.
  top: number;
  // 클라이언트 좌표계의 오른쪽 경계다.
  right: number;
  // 클라이언트 좌표계의 아래쪽 경계다.
  bottom: number;
}

export interface ActionBarAnchor {
  // 선택 말 중심의 클라이언트 X 좌표다.
  x: number;
  // 선택 말 중심의 클라이언트 Y 좌표다.
  y: number;
  // 팝업이 말과 겹치지 않게 하는 투영 외곽선이다.
  pieceRect: ActionBarRect;
}

export interface ActionBarSize {
  // 현재 버튼 문구와 coarse 크기를 반영한 팝업 너비다.
  width: number;
  // 현재 버튼 문구와 coarse 크기를 반영한 팝업 높이다.
  height: number;
}

export interface ActionBarPlacement {
  // 팝업 왼쪽 위의 클라이언트 X 좌표다.
  left: number;
  // 팝업 왼쪽 위의 클라이언트 Y 좌표다.
  top: number;
  // 선택 말의 어느 쪽에 팝업을 놓았는지 나타낸다.
  side: "left" | "right";
}

// 선택 말 외곽과 팝업 사이를 손가락·마우스 모두 구별할 수 있게 띄우는 화면 간격이다.
const ACTION_BAR_GAP_PIXELS = 12;
// 작은 화면에서도 팝업 테두리가 뷰포트에 붙거나 잘리지 않게 하는 안쪽 여백이다.
const ACTION_BAR_VIEWPORT_MARGIN_PIXELS = 8;

/**
 * 두 화면 사각형의 실제 면적이 겹치는지 판정한다.
 */
function rectanglesOverlap(
  first: ActionBarRect,
  second: ActionBarRect,
): boolean {
  return (
    first.left < second.right &&
    first.right > second.left &&
    first.top < second.bottom &&
    first.bottom > second.top
  );
}

/**
 * 숫자를 뷰포트 안쪽 범위로 제한하며 좁은 화면에서는 최솟값을 유지한다.
 */
function clampCoordinate(
  value: number,
  minimum: number,
  maximum: number,
): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

/**
 * 후보 위치를 화면 사각형으로 바꿔 패널 겹침 검사를 한 곳에서 수행한다.
 */
function makePlacementRect(
  left: number,
  top: number,
  size: ActionBarSize,
): ActionBarRect {
  return {
    left,
    top,
    right: left + size.width,
    bottom: top + size.height,
  };
}

/**
 * 선택 말 오른쪽을 우선하고 화면·타점 패널과 충돌하면 왼쪽 또는 세로 여유로 옮긴다.
 */
export function computeActionBarPlacement(
  viewport: ActionBarRect,
  anchor: ActionBarAnchor,
  popup: ActionBarSize,
  panelRect: ActionBarRect | null,
): ActionBarPlacement {
  const margin = ACTION_BAR_VIEWPORT_MARGIN_PIXELS;
  const gap = ACTION_BAR_GAP_PIXELS;
  const minimumLeft = viewport.left + margin;
  const maximumLeft = viewport.right - margin - popup.width;
  const minimumTop = viewport.top + margin;
  const maximumTop = viewport.bottom - margin - popup.height;
  const centeredTop = clampCoordinate(
    anchor.y - popup.height / 2,
    minimumTop,
    maximumTop,
  );
  const rawLeftBySide = {
    right: anchor.pieceRect.right + gap,
    left: anchor.pieceRect.left - gap - popup.width,
  } as const;
  const horizontalFits = (side: "left" | "right"): boolean => {
    const left = rawLeftBySide[side];
    return left >= minimumLeft && left <= maximumLeft;
  };
  const centeredRect = (side: "left" | "right"): ActionBarRect =>
    makePlacementRect(rawLeftBySide[side], centeredTop, popup);
  const clearsPanel = (side: "left" | "right"): boolean =>
    panelRect === null ||
    !rectanglesOverlap(centeredRect(side), panelRect);

  let side: "left" | "right";
  if (horizontalFits("right") && clearsPanel("right")) {
    side = "right";
  } else if (horizontalFits("left") && clearsPanel("left")) {
    // 기본 오른쪽이 화면 밖이거나 타점 패널을 덮으면 반대편을 우선한다.
    side = "left";
  } else if (horizontalFits("right")) {
    side = "right";
  } else if (horizontalFits("left")) {
    side = "left";
  } else {
    const rightRoom = viewport.right - anchor.pieceRect.right;
    const leftRoom = anchor.pieceRect.left - viewport.left;
    side = rightRoom >= leftRoom ? "right" : "left";
  }

  let left = clampCoordinate(
    rawLeftBySide[side],
    minimumLeft,
    maximumLeft,
  );
  let top = centeredTop;
  if (
    rectanglesOverlap(
      makePlacementRect(left, top, popup),
      anchor.pieceRect,
    )
  ) {
    // 극단적으로 좁은 화면에서 좌우가 모두 모자라면 말 위·아래의 가까운 빈곳을 쓴다.
    const centeredLeft = clampCoordinate(
      anchor.x - popup.width / 2,
      minimumLeft,
      maximumLeft,
    );
    const pieceAvoidanceCandidates = [
      anchor.pieceRect.top - gap - popup.height,
      anchor.pieceRect.bottom + gap,
    ]
      .filter(
        (candidate) =>
          candidate >= minimumTop && candidate <= maximumTop,
      )
      .sort(
        (first, second) =>
          Math.abs(first - centeredTop) -
          Math.abs(second - centeredTop),
      );
    for (const candidate of pieceAvoidanceCandidates) {
      const candidateRect = makePlacementRect(
        centeredLeft,
        candidate,
        popup,
      );
      if (
        !rectanglesOverlap(candidateRect, anchor.pieceRect) &&
        (panelRect === null ||
          !rectanglesOverlap(candidateRect, panelRect))
      ) {
        left = centeredLeft;
        top = candidate;
        break;
      }
    }
  }
  if (
    panelRect !== null &&
    rectanglesOverlap(makePlacementRect(left, top, popup), panelRect)
  ) {
    const verticalCandidates = [
      panelRect.top - gap - popup.height,
      panelRect.bottom + gap,
    ]
      .filter(
        (candidate) =>
          candidate >= minimumTop && candidate <= maximumTop,
      )
      .sort(
        (first, second) =>
          Math.abs(first - centeredTop) -
          Math.abs(second - centeredTop),
      );
    for (const candidate of verticalCandidates) {
      if (
        !rectanglesOverlap(
          makePlacementRect(left, candidate, popup),
          panelRect,
        )
      ) {
        top = candidate;
        break;
      }
    }
  }
  return { left, top, side };
}
