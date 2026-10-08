import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const webRoot = fileURLToPath(new URL("../..", import.meta.url));
const vite = await createServer({
  root: webRoot,
  configFile: false,
  logLevel: "error",
  appType: "custom",
  server: { middlewareMode: true },
});

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function overlap(first, second) {
  return (
    first.left < second.right &&
    first.right > second.left &&
    first.top < second.bottom &&
    first.bottom > second.top
  );
}

function makeRect(left, top, width, height) {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
  };
}

try {
  const actionBar = await vite.ssrLoadModule("/src/action-bar.ts");
  const { computeActionBarPlacement } = actionBar;

  const defaultPopup = { width: 100, height: 50 };
  const anchorAt = (x, y, radius = 0) => ({
    x,
    y,
    pieceRect: {
      left: x - radius,
      top: y - radius,
      right: x + radius,
      bottom: y + radius,
    },
  });

  // 1. 기존 4인자 하위 호환성 (레거시 검증과 100% 동일한 결과)
  const legacyViewport = { left: 0, top: 0, right: 400, bottom: 300 };
  const legacyCenter = computeActionBarPlacement(
    legacyViewport,
    anchorAt(200, 150),
    defaultPopup,
    null,
  );
  const legacyRightEdge = computeActionBarPlacement(
    legacyViewport,
    anchorAt(380, 150),
    defaultPopup,
    null,
  );
  const legacyLeftEdge = computeActionBarPlacement(
    legacyViewport,
    anchorAt(4, 150),
    defaultPopup,
    null,
  );
  const legacyBottomEdge = computeActionBarPlacement(
    legacyViewport,
    anchorAt(200, 290),
    defaultPopup,
    null,
  );
  const legacyPanelFlip = computeActionBarPlacement(
    legacyViewport,
    anchorAt(250, 150),
    defaultPopup,
    { left: 260, top: 100, right: 390, bottom: 200 },
  );
  const legacyNarrow = computeActionBarPlacement(
    { left: 0, top: 0, right: 240, bottom: 300 },
    {
      x: 120,
      y: 150,
      pieceRect: { left: 100, top: 130, right: 140, bottom: 170 },
    },
    { width: 120, height: 50 },
    null,
  );
  assertCondition(
    legacyCenter.side === "right" &&
      legacyCenter.left === 212 &&
      legacyCenter.top === 125 &&
      legacyRightEdge.side === "left" &&
      legacyRightEdge.left === 268 &&
      legacyLeftEdge.side === "right" &&
      legacyLeftEdge.left === 16 &&
      legacyBottomEdge.top === 242 &&
      legacyPanelFlip.side === "left" &&
      legacyPanelFlip.left === 138 &&
      legacyNarrow.left === 60 &&
      legacyNarrow.top === 68 &&
      legacyNarrow.side === "right",
    `[실패 1] 레거시 4인자 계약 결과가 다릅니다: center=${JSON.stringify(legacyCenter)}, right=${JSON.stringify(legacyRightEdge)}, left=${JSON.stringify(legacyLeftEdge)}, panel=${JSON.stringify(legacyPanelFlip)}, narrow=${JSON.stringify(legacyNarrow)}`,
  );
  console.log(
    "[통과 1] 기존 4인자 하위 호환성: center(212,125), right-edge(268,125), left-edge(16,125), panel(138,125), narrow(60,68)",
  );

  // 2. 이웃 기물 회피 (우측 이웃 기물이 있을 때 좌측으로 전환)
  const neighborViewport = { left: 0, top: 0, right: 400, bottom: 300 };
  const neighborAnchor = anchorAt(200, 150, 10);
  const rightNeighbor = { left: 215, top: 130, right: 265, bottom: 170 };
  const neighborPlacement = computeActionBarPlacement(
    neighborViewport,
    neighborAnchor,
    defaultPopup,
    null,
    [rightNeighbor],
  );
  const neighborRect = makeRect(
    neighborPlacement.left,
    neighborPlacement.top,
    defaultPopup.width,
    defaultPopup.height,
  );
  assertCondition(
    !overlap(neighborRect, rightNeighbor) &&
      !overlap(neighborRect, neighborAnchor.pieceRect) &&
      neighborPlacement.side === "left" &&
      neighborPlacement.left === 190 - 12 - 100 &&
      neighborPlacement.top === 125,
    `[실패 2] 우측 이웃 기물 회피 실패: placement=${JSON.stringify(neighborPlacement)}, overlapsNeighbor=${overlap(neighborRect, rightNeighbor)}`,
  );
  console.log(
    `[통과 2] 이웃 기물 회피: right-blocked -> side=${neighborPlacement.side}@(${neighborPlacement.left},${neighborPlacement.top})`,
  );

  // 3. 밀집 군집 (전후좌우 둘러싸인 군집에서 군집 외곽 빈공간 또는 뷰포트 여백으로 회피)
  const clusterViewport = { left: 0, top: 0, right: 500, bottom: 500 };
  const clusterAnchor = anchorAt(250, 250, 15);
  const clusterPieces = [
    { left: 270, top: 230, right: 310, bottom: 270 }, // 우
    { left: 190, top: 230, right: 230, bottom: 270 }, // 좌
    { left: 230, top: 190, right: 270, bottom: 230 }, // 상
    { left: 230, top: 270, right: 270, bottom: 310 }, // 하
    { left: 270, top: 190, right: 310, bottom: 230 }, // 우상
    { left: 270, top: 270, right: 310, bottom: 310 }, // 우하
    { left: 190, top: 190, right: 230, bottom: 230 }, // 좌상
    { left: 190, top: 270, right: 230, bottom: 310 }, // 좌하
  ];
  const clusterPlacement = computeActionBarPlacement(
    clusterViewport,
    clusterAnchor,
    defaultPopup,
    null,
    clusterPieces,
  );
  const clusterRect = makeRect(
    clusterPlacement.left,
    clusterPlacement.top,
    defaultPopup.width,
    defaultPopup.height,
  );
  const overlapsClusterPiece = clusterPieces.some((p) =>
    overlap(clusterRect, p),
  );
  assertCondition(
    !overlap(clusterRect, clusterAnchor.pieceRect) &&
      !overlapsClusterPiece &&
      clusterPlacement.left >= clusterViewport.left + 8 &&
      clusterPlacement.left + defaultPopup.width <= clusterViewport.right - 8 &&
      clusterPlacement.top >= clusterViewport.top + 8 &&
      clusterPlacement.top + defaultPopup.height <= clusterViewport.bottom - 8,
    `[실패 3] 밀집 군집 회피 실패: placement=${JSON.stringify(clusterPlacement)}, overlapAnchor=${overlap(clusterRect, clusterAnchor.pieceRect)}, overlapCluster=${overlapsClusterPiece}`,
  );
  console.log(
    `[통과 3] 밀집 군집 회피: 빈 외곽 배치 성립 side=${clusterPlacement.side}@(${clusterPlacement.left},${clusterPlacement.top})`,
  );

  // 4. 좌우 화면 경계 근처에서의 회피
  const edgeViewport = { left: 0, top: 0, right: 400, bottom: 400 };
  // 좌측 경계 근처 말인데 우측에 장애물 기물이 놓인 경우
  const leftEdgeAnchor = anchorAt(20, 200, 10);
  const leftEdgeObstacle = { left: 35, top: 180, right: 85, bottom: 220 };
  const leftEdgePlacement = computeActionBarPlacement(
    edgeViewport,
    leftEdgeAnchor,
    defaultPopup,
    null,
    [leftEdgeObstacle],
  );
  const leftEdgeRect = makeRect(
    leftEdgePlacement.left,
    leftEdgePlacement.top,
    defaultPopup.width,
    defaultPopup.height,
  );
  assertCondition(
    !overlap(leftEdgeRect, leftEdgeObstacle) &&
      !overlap(leftEdgeRect, leftEdgeAnchor.pieceRect) &&
      leftEdgePlacement.left >= edgeViewport.left + 8 &&
      leftEdgePlacement.left + defaultPopup.width <= edgeViewport.right - 8,
    `[실패 4-1] 좌측 경계 장애물 회피 실패: placement=${JSON.stringify(leftEdgePlacement)}`,
  );

  // 우측 경계 근처 말인데 좌측에 장애물 기물이 놓인 경우
  const rightEdgeAnchor = anchorAt(380, 200, 10);
  const rightEdgeObstacle = { left: 260, top: 180, right: 310, bottom: 220 };
  const rightEdgePlacement = computeActionBarPlacement(
    edgeViewport,
    rightEdgeAnchor,
    defaultPopup,
    null,
    [rightEdgeObstacle],
  );
  const rightEdgeRect = makeRect(
    rightEdgePlacement.left,
    rightEdgePlacement.top,
    defaultPopup.width,
    defaultPopup.height,
  );
  assertCondition(
    !overlap(rightEdgeRect, rightEdgeObstacle) &&
      !overlap(rightEdgeRect, rightEdgeAnchor.pieceRect) &&
      rightEdgePlacement.left >= edgeViewport.left + 8 &&
      rightEdgePlacement.left + defaultPopup.width <= edgeViewport.right - 8,
    `[실패 4-2] 우측 경계 장애물 회피 실패: placement=${JSON.stringify(rightEdgePlacement)}`,
  );
  console.log(
    `[통과 4] 좌우 경계 회피: leftEdge@(${leftEdgePlacement.left},${leftEdgePlacement.top}), rightEdge@(${rightEdgePlacement.left},${rightEdgePlacement.top})`,
  );

  // 5. 세로(Portrait: 360x800) 및 가로(Landscape: 844x390) 뷰포트
  const portraitViewport = { left: 0, top: 0, right: 360, bottom: 800 };
  const portraitAnchor = anchorAt(180, 400, 15);
  // QA 보고서 HUD-01에서 지적된 폰 우측 가림 현상 재현 데이터
  const portraitNeighbor = { left: 202, top: 380, right: 242, bottom: 420 };
  const portraitPlacement = computeActionBarPlacement(
    portraitViewport,
    portraitAnchor,
    defaultPopup,
    null,
    [portraitNeighbor],
  );
  const portraitRect = makeRect(
    portraitPlacement.left,
    portraitPlacement.top,
    defaultPopup.width,
    defaultPopup.height,
  );
  assertCondition(
    !overlap(portraitRect, portraitNeighbor) &&
      !overlap(portraitRect, portraitAnchor.pieceRect) &&
      portraitPlacement.left >= portraitViewport.left + 8 &&
      portraitPlacement.left + defaultPopup.width <= portraitViewport.right - 8 &&
      portraitPlacement.top >= portraitViewport.top + 8 &&
      portraitPlacement.top + defaultPopup.height <= portraitViewport.bottom - 8,
    `[실패 5-1] 세로 화면 기물 회피 실패: placement=${JSON.stringify(portraitPlacement)}`,
  );

  const landscapeViewport = { left: 0, top: 0, right: 844, bottom: 390 };
  const landscapeAnchor = anchorAt(422, 195, 15);
  const landscapeNeighbor = { left: 445, top: 175, right: 485, bottom: 215 };
  const landscapePlacement = computeActionBarPlacement(
    landscapeViewport,
    landscapeAnchor,
    defaultPopup,
    null,
    [landscapeNeighbor],
  );
  const landscapeRect = makeRect(
    landscapePlacement.left,
    landscapePlacement.top,
    defaultPopup.width,
    defaultPopup.height,
  );
  assertCondition(
    !overlap(landscapeRect, landscapeNeighbor) &&
      !overlap(landscapeRect, landscapeAnchor.pieceRect) &&
      landscapePlacement.left >= landscapeViewport.left + 8 &&
      landscapePlacement.left + defaultPopup.width <= landscapeViewport.right - 8 &&
      landscapePlacement.top >= landscapeViewport.top + 8 &&
      landscapePlacement.top + defaultPopup.height <= landscapeViewport.bottom - 8,
    `[실패 5-2] 가로 화면 기물 회피 실패: placement=${JSON.stringify(landscapePlacement)}`,
  );
  console.log(
    `[통과 5] 화면 방향 적응: portrait(360x800)@(${portraitPlacement.left},${portraitPlacement.top}), landscape(844x390)@(${landscapePlacement.left},${landscapePlacement.top})`,
  );

  // 6. 타점 미리보기 패널과 점유 기물의 동시 회피
  const panelJointViewport = { left: 0, top: 0, right: 500, bottom: 400 };
  const panelJointAnchor = anchorAt(220, 200, 10);
  const panelJointPanel = { left: 40, top: 100, right: 180, bottom: 300 }; // 좌측 패널 점유
  const panelJointPiece = { left: 235, top: 180, right: 285, bottom: 220 }; // 우측 기물 점유
  const panelJointPlacement = computeActionBarPlacement(
    panelJointViewport,
    panelJointAnchor,
    defaultPopup,
    panelJointPanel,
    [panelJointPiece],
  );
  const panelJointRect = makeRect(
    panelJointPlacement.left,
    panelJointPlacement.top,
    defaultPopup.width,
    defaultPopup.height,
  );
  assertCondition(
    !overlap(panelJointRect, panelJointPanel) &&
      !overlap(panelJointRect, panelJointPiece) &&
      !overlap(panelJointRect, panelJointAnchor.pieceRect) &&
      panelJointPlacement.left >= panelJointViewport.left + 8 &&
      panelJointPlacement.left + defaultPopup.width <= panelJointViewport.right - 8,
    `[실패 6] 패널+기물 동시 회피 실패: placement=${JSON.stringify(panelJointPlacement)}`,
  );
  console.log(
    `[통과 6] 패널+점유기물 동시 회피: side=${panelJointPlacement.side}@(${panelJointPlacement.left},${panelJointPlacement.top})`,
  );

  // 7. 뷰포트 좌표 오프셋 (viewport.left/top이 0이 아닌 경우 margin 준수)
  const offsetViewport = { left: 100, top: 150, right: 600, bottom: 650 };
  const offsetAnchor = anchorAt(350, 400, 10);
  const offsetPiece = { left: 365, top: 380, right: 415, bottom: 420 };
  const offsetPlacement = computeActionBarPlacement(
    offsetViewport,
    offsetAnchor,
    defaultPopup,
    null,
    [offsetPiece],
  );
  const offsetRect = makeRect(
    offsetPlacement.left,
    offsetPlacement.top,
    defaultPopup.width,
    defaultPopup.height,
  );
  assertCondition(
    offsetPlacement.left >= offsetViewport.left + 8 &&
      offsetPlacement.left + defaultPopup.width <= offsetViewport.right - 8 &&
      offsetPlacement.top >= offsetViewport.top + 8 &&
      offsetPlacement.top + defaultPopup.height <= offsetViewport.bottom - 8 &&
      !overlap(offsetRect, offsetPiece) &&
      !overlap(offsetRect, offsetAnchor.pieceRect),
    `[실패 7] 뷰포트 오프셋 경계 미준수: placement=${JSON.stringify(offsetPlacement)}, bounds=[${offsetViewport.left + 8}, ${offsetViewport.right - 8 - defaultPopup.width}]`,
  );
  console.log(
    `[통과 7] 뷰포트 오프셋(L=100,T=150): placement=(${offsetPlacement.left},${offsetPlacement.top})`,
  );

  // 8. 공간 부족 폴백 (뷰포트 전체가 꽉 차서 물리적으로 완전한 빈 사각형이 없는 경우)
  const tinyViewport = { left: 0, top: 0, right: 120, bottom: 80 };
  const tinyAnchor = anchorAt(60, 40, 20);
  // 사방을 전부 채워서 100x50 크기가 완전히 들어갈 빈 영역이 없도록 구성
  const wallPieces = [
    { left: 0, top: 0, right: 60, bottom: 40 },
    { left: 60, top: 0, right: 120, bottom: 40 },
    { left: 0, top: 40, right: 60, bottom: 80 },
    { left: 60, top: 40, right: 120, bottom: 80 },
  ];
  const fallbackPlacement = computeActionBarPlacement(
    tinyViewport,
    tinyAnchor,
    defaultPopup,
    null,
    wallPieces,
  );
  assertCondition(
    fallbackPlacement !== null &&
      typeof fallbackPlacement.left === "number" &&
      typeof fallbackPlacement.top === "number" &&
      (fallbackPlacement.side === "left" || fallbackPlacement.side === "right") &&
      fallbackPlacement.left >= tinyViewport.left + 8 &&
      fallbackPlacement.top >= tinyViewport.top + 8,
    `[실패 8] 공간 부족 최적 폴백 실패: placement=${JSON.stringify(fallbackPlacement)}`,
  );
  console.log(
    `[통과 8] 공간 부족 시 최적 뷰포트 내 폴백: side=${fallbackPlacement.side}@(${fallbackPlacement.left},${fallbackPlacement.top})`,
  );

  // 9. 결정론적 일관성 (동일 입력 시 결과가 100% 동일)
  const run1 = computeActionBarPlacement(
    clusterViewport,
    clusterAnchor,
    defaultPopup,
    null,
    clusterPieces,
  );
  const run2 = computeActionBarPlacement(
    clusterViewport,
    clusterAnchor,
    defaultPopup,
    null,
    clusterPieces,
  );
  assertCondition(
    run1.left === run2.left &&
      run1.top === run2.top &&
      run1.side === run2.side,
    `[실패 9] 비결정론적 동작 발생: run1=${JSON.stringify(run1)}, run2=${JSON.stringify(run2)}`,
  );
  console.log(
    `[통과 9] 결정론적 일관성: run1==run2 side=${run1.side}@(${run1.left},${run1.top})`,
  );

  // 좁은 빈 통로도 놓치지 않으며 선택 말의 12px 여백은 모든 후보에 적용한다.
  const corridorAnchor = anchorAt(200, 220, 5);
  const corridorObstacles = [
    makeRect(0, 0, 149, 300), makeRect(250, 0, 150, 300),
    makeRect(0, 0, 400, 60), makeRect(0, 110, 400, 190),
  ];
  const corridor = computeActionBarPlacement(legacyViewport, corridorAnchor, defaultPopup, null, corridorObstacles);
  const corridorRect = makeRect(corridor.left, corridor.top, defaultPopup.width, defaultPopup.height);
  assertCondition(corridor.top === 60 && corridor.left >= 149 && corridor.left <= 150 &&
    !corridorObstacles.some(r => overlap(corridorRect, r)),
    `빈 통로를 놓쳤습니다: ${JSON.stringify(corridor)}`);
  const paddedSelected = {
    left: clusterAnchor.pieceRect.left - 12, top: clusterAnchor.pieceRect.top - 12,
    right: clusterAnchor.pieceRect.right + 12, bottom: clusterAnchor.pieceRect.bottom + 12,
  };
  assertCondition(!overlap(clusterRect, paddedSelected), '대체 배치가 선택 말의 12px 여백을 침범합니다.');
  console.log('[통과 10] 좁은 빈 통로 탐색 및 선택 말의 12px 여백 유지');
  const subpixelAnchor = { x: 382, y: 200, pieceRect: makeRect(372, 190, 20, 20) };
  const subpixelWalls = [makeRect(0, 0, 260.2, 400), makeRect(360.4, 0, 239.6, 400)];
  const subpixel = computeActionBarPlacement(makeRect(0, 0, 600, 400), subpixelAnchor, defaultPopup, null, subpixelWalls);
  const subpixelRect = makeRect(subpixel.left, subpixel.top, defaultPopup.width, defaultPopup.height);
  assertCondition(!subpixelWalls.some(r => overlap(subpixelRect, r)), `소수 좌표의 빈 통로를 놓쳤습니다: ${JSON.stringify(subpixel)}`);
  console.log('[통과 11] 소수 좌표의 후보를 임의로 합치지 않음');
  console.log("\n모든 조작판 배치 계약 검사(1~11)가 성공적으로 통과했습니다.");
} finally {
  await vite.close();
}
