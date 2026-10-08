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
 * 두 사각형 간의 겹치는 면적을 계산한다.
 */
function computeOverlapArea(
  first: ActionBarRect,
  second: ActionBarRect,
): number {
  const overlapLeft = Math.max(first.left, second.left);
  const overlapRight = Math.min(first.right, second.right);
  const overlapTop = Math.max(first.top, second.top);
  const overlapBottom = Math.min(first.bottom, second.bottom);
  if (overlapRight > overlapLeft && overlapBottom > overlapTop) {
    return (overlapRight - overlapLeft) * (overlapBottom - overlapTop);
  }
  return 0;
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
 * 후보 위치를 화면 사각형으로 바꿔 충돌 검사를 수행한다.
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
 * 주어진 사각형이 장애물 목록 중 하나라도 겹치는지 검사한다.
 */
function overlapsAnyObstacle(
  rect: ActionBarRect,
  obstacles: readonly ActionBarRect[],
): boolean {
  for (let i = 0; i < obstacles.length; i++) {
    if (rectanglesOverlap(rect, obstacles[i])) {
      return true;
    }
  }
  return false;
}

/**
 * 팝업 중심의 상대 위치에 따라 말의 왼쪽/오른쪽 배치를 결정한다.
 */
function determineSide(
  left: number,
  width: number,
  anchor: ActionBarAnchor,
  viewport: ActionBarRect,
): "left" | "right" {
  const popupCenterX = left + width / 2;
  if (popupCenterX > anchor.x) {
    return "right";
  }
  if (popupCenterX < anchor.x) {
    return "left";
  }
  const rightRoom = viewport.right - anchor.pieceRect.right;
  const leftRoom = anchor.pieceRect.left - viewport.left;
  return rightRoom >= leftRoom ? "right" : "left";
}

/**
 * 후보 좌표를 뷰포트 범위로 제한하고 동일한 좌표만 제거한다.
 */
function collectUniqueCoordinates(
  values: readonly number[],
  minimum: number,
  maximum: number,
): number[] {
  return [...new Set(values.map(value => clampCoordinate(value, minimum, maximum)))];
}

/**
 * 충돌 없는 후보의 우선순위 점수를 계산한다.
 * 점수가 낮을수록 선택된 말에 가깝고 기본 정렬에 부합하는 위치다.
 */
function scoreFreeCandidate(
  left: number,
  top: number,
  popup: ActionBarSize,
  anchor: ActionBarAnchor,
  centeredTop: number,
): number {
  const centerX = left + popup.width / 2;
  const centerY = top + popup.height / 2;
  const dx = centerX - anchor.x;
  const dy = centerY - anchor.y;
  const dist = Math.hypot(dx, dy);

  // 오른쪽 배치 선호 (좌측 배치 시 미세 가중치 부여)
  const sidePenalty = centerX < anchor.x ? 5 : 0;
  // 기준 높이(centeredTop)와의 편차에 따른 가중치
  const verticalPenalty = Math.abs(top - centeredTop) * 0.1;
  // 말 아래쪽보다 위쪽을 미세하게 선호 (equidistant 시 상단 우선 보존)
  const belowPenalty = centerY > anchor.y ? 0.001 : 0;

  return dist + sidePenalty + verticalPenalty + belowPenalty;
}

/**
 * 선택 말 주변과 뷰포트 여백을 고려하여 충돌 없는 최적의 조작판 위치를 계산한다.
 * 4인자 기존 호출과의 하위 호환성을 보장한다.
 */
export function computeActionBarPlacement(
  viewport: ActionBarRect,
  anchor: ActionBarAnchor,
  popup: ActionBarSize,
  panelRect: ActionBarRect | null,
  occupiedRects: readonly ActionBarRect[] = [],
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

  // 전체 장애물 수집 (선택 말 외곽선 + 타점 패널 + 점유된 다른 기물 및 HUD)
  const obstacles: ActionBarRect[] = [{
    left: anchor.pieceRect.left - gap,
    top: anchor.pieceRect.top - gap,
    right: anchor.pieceRect.right + gap,
    bottom: anchor.pieceRect.bottom + gap,
  }];
  if (panelRect !== null) {
    obstacles.push(panelRect);
  }
  for (let i = 0; i < occupiedRects.length; i++) {
    obstacles.push(occupiedRects[i]);
  }

  // 1단계: 가장 자연스러운 기본 오른쪽 위치 시도
  const canFitHorizontally = (x: number) =>
    x >= minimumLeft && x <= maximumLeft;

  if (canFitHorizontally(rawLeftBySide.right)) {
    const rightRect = makePlacementRect(rawLeftBySide.right, centeredTop, popup);
    if (!overlapsAnyObstacle(rightRect, obstacles)) {
      return {
        left: rawLeftBySide.right,
        top: centeredTop,
        side: "right",
      };
    }
  }

  // 2단계: 오른쪽이 막혔거나 화면 밖이면 기본 왼쪽 위치 시도
  if (canFitHorizontally(rawLeftBySide.left)) {
    const leftRect = makePlacementRect(rawLeftBySide.left, centeredTop, popup);
    if (!overlapsAnyObstacle(leftRect, obstacles)) {
      return {
        left: rawLeftBySide.left,
        top: centeredTop,
        side: "left",
      };
    }
  }

  // 3단계: 기본 좌우 배치가 모두 막힌 경우 장애물 및 뷰포트 경계 기반 후보 탐색
  const rawCandidateXs: number[] = [
    rawLeftBySide.right,
    rawLeftBySide.left,
    anchor.x - popup.width / 2,
    anchor.pieceRect.left,
    anchor.pieceRect.right - popup.width,
    minimumLeft,
    maximumLeft,
    (minimumLeft + maximumLeft) / 2,
  ];
  for (let i = 0; i < obstacles.length; i++) {
    const obs = obstacles[i];
    rawCandidateXs.push(
      obs.right + gap,
      obs.left - gap - popup.width,
      obs.right,
      obs.left - popup.width,
      obs.left,
      obs.right - popup.width,
    );
  }

  const rawCandidateYs: number[] = [
    centeredTop,
    anchor.pieceRect.top - gap - popup.height,
    anchor.pieceRect.bottom + gap,
    minimumTop,
    maximumTop,
    (minimumTop + maximumTop) / 2,
  ];
  for (let i = 0; i < obstacles.length; i++) {
    const obs = obstacles[i];
    rawCandidateYs.push(
      obs.bottom + gap,
      obs.top - gap - popup.height,
      obs.bottom,
      obs.top - popup.height,
      obs.top,
      obs.bottom - popup.height,
    );
  }

  const candidateXs = collectUniqueCoordinates(
    rawCandidateXs,
    minimumLeft,
    maximumLeft,
  );
  const candidateYs = collectUniqueCoordinates(
    rawCandidateYs,
    minimumTop,
    maximumTop,
  );

  let bestFreePlacement: { left: number; top: number; score: number } | null = null;
  let bestFallbackPlacement: {
    left: number;
    top: number;
    overlapScore: number;
  } | null = null;

  for (let xi = 0; xi < candidateXs.length; xi++) {
    const cx = candidateXs[xi];
    for (let yi = 0; yi < candidateYs.length; yi++) {
      const cy = candidateYs[yi];
      const rect = makePlacementRect(cx, cy, popup);

      let totalOverlap = 0;
      let hasOverlap = false;

      for (let oi = 0; oi < obstacles.length; oi++) {
        const obs = obstacles[oi];
        if (rectanglesOverlap(rect, obs)) {
          hasOverlap = true;
          // 빈 후보를 찾은 뒤에는 겹치는 후보의 면적까지 계산할 필요가 없다.
          if (bestFreePlacement !== null) {
            break;
          }
          const area = computeOverlapArea(rect, obs);
          const weight = oi === 0 ? 2 : 1;
          totalOverlap += area * weight;
        }
      }

      if (!hasOverlap) {
        const score = scoreFreeCandidate(cx, cy, popup, anchor, centeredTop);
        if (bestFreePlacement === null || score < bestFreePlacement.score) {
          bestFreePlacement = { left: cx, top: cy, score };
        }
      } else if (bestFreePlacement === null) {
        // 완전 빈 공간이 없는 경우를 대비한 최소 겹침 폴백 계산
        const dist = Math.hypot(
          cx + popup.width / 2 - anchor.x,
          cy + popup.height / 2 - anchor.y,
        );
        const overlapScore = totalOverlap * 10000 + dist;
        if (
          bestFallbackPlacement === null ||
          overlapScore < bestFallbackPlacement.overlapScore
        ) {
          bestFallbackPlacement = { left: cx, top: cy, overlapScore };
        }
      }
    }
  }

  if (bestFreePlacement !== null) {
    const side = determineSide(
      bestFreePlacement.left,
      popup.width,
      anchor,
      viewport,
    );
    return {
      left: bestFreePlacement.left,
      top: bestFreePlacement.top,
      side,
    };
  }

  // 완전 빈 공간이 전혀 없는 극단적 밀집 상황에서의 최적 뷰포트 내 폴백
  const fallbackLeft =
    bestFallbackPlacement !== null
      ? bestFallbackPlacement.left
      : clampCoordinate(rawLeftBySide.right, minimumLeft, maximumLeft);
  const fallbackTop =
    bestFallbackPlacement !== null ? bestFallbackPlacement.top : centeredTop;
  const side = determineSide(fallbackLeft, popup.width, anchor, viewport);

  return {
    left: fallbackLeft,
    top: fallbackTop,
    side,
  };
}
