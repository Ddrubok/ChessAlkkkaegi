import { fileURLToPath } from "node:url";
import {
  CylinderGeometry,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from "three";
import { createServer } from "vite";

const webRoot = fileURLToPath(new URL("../..", import.meta.url));
const vite = await createServer({
  root: webRoot,
  configFile: false,
  logLevel: "error",
  appType: "custom",
  server: { middlewareMode: true },
});

/**
 * 터치 입력 계약이 다르면 측정값을 포함해 즉시 검증을 중단한다.
 */
function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * 부동소수 방향·세기가 기대값 오차 안인지 판정한다.
 */
function nearlyEqual(actual, expected, tolerance = 1e-9) {
  return Math.abs(actual - expected) <= tolerance;
}

try {
  const [
    capability,
    config,
    input,
    strikePanel,
    actionBar,
    aimParameters,
  ] = await Promise.all([
    vite.ssrLoadModule("/src/input-capability.ts"),
    vite.ssrLoadModule("/src/config.ts"),
    vite.ssrLoadModule("/src/input.ts"),
    vite.ssrLoadModule("/src/strike-panel.ts"),
    vite.ssrLoadModule("/src/action-bar.ts"),
    vite.ssrLoadModule("/src/aimparams.ts"),
  ]);

  assertCondition(
    capability.isCoarsePointerEnvironment() === false &&
      capability.isTouchPointerEvent({ pointerType: "touch" }) &&
      !capability.isTouchPointerEvent({ pointerType: "mouse" }),
    "DOM 없는 입력 역량 기본값 또는 이벤트별 터치 판정이 다릅니다.",
  );
  console.log(
    "[통과 a] 입력 역량: Node coarse=false, touch=true, mouse=false",
  );

  const radius = config.TOUCH_PIECE_HIT_RADIUS_PIXELS;
  const candidates = [
    { pieceId: "white-pawn-a2", clientX: 130, clientY: 100 },
    { pieceId: "white-rook-a1", clientX: 138, clientY: 100 },
  ];
  const touchPiece = input.findNearestTouchPieceInScreenSpace(
    { pointerType: "touch", clientX: 100, clientY: 100 },
    candidates,
  );
  const mousePiece = input.findNearestTouchPieceInScreenSpace(
    { pointerType: "mouse", clientX: 100, clientY: 100 },
    candidates,
  );
  assertCondition(
    radius === 44 &&
      touchPiece === "white-pawn-a2" &&
      mousePiece === null,
    `터치 최근접 또는 마우스 비적용이 다릅니다: radius=${radius}, touch=${touchPiece}, mouse=${mousePiece}`,
  );

  const boundaryPiece = input.findNearestTouchPieceInScreenSpace(
    { pointerType: "touch", clientX: 100, clientY: 100 },
    [
      {
        pieceId: "white-bishop-c1",
        clientX: 100 + radius,
        clientY: 100,
      },
    ],
  );
  const outsidePiece = input.findNearestTouchPieceInScreenSpace(
    { pointerType: "touch", clientX: 100, clientY: 100 },
    [
      {
        pieceId: "white-bishop-c1",
        clientX: 100 + radius + 0.001,
        clientY: 100,
      },
    ],
  );
  assertCondition(
    boundaryPiece === "white-bishop-c1" &&
      outsidePiece === null,
    `44px 경계 판정이 다릅니다: boundary=${boundaryPiece}, outside=${outsidePiece}`,
  );
  console.log(
    `[통과 b] 화면 좌표 폴백: touch=${touchPiece}@30px, mouse=${String(mousePiece)}, boundary=${boundaryPiece}@${radius}px, outside=${String(outsidePiece)}@${(radius + 0.001).toFixed(3)}px`,
  );

  const touchRedDotRadius =
    input.getRedDotHitRadiusPixels({
      pointerType: "touch",
    });
  const mouseRedDotRadius =
    input.getRedDotHitRadiusPixels({
      pointerType: "mouse",
    });
  const insideDistance = touchRedDotRadius;
  const outsideDistance = touchRedDotRadius + 0.001;
  const insideRoute =
    input.decideBilliardsTouchPointerRoute({
      hasSelectedPiece: true,
      strikeMode: false,
      redDotHit: insideDistance <= touchRedDotRadius,
      activeInputPointer: false,
      orbitTouchCount: 0,
    });
  const outsideRoute =
    input.decideBilliardsTouchPointerRoute({
      hasSelectedPiece: true,
      strikeMode: false,
      redDotHit: outsideDistance <= touchRedDotRadius,
      activeInputPointer: false,
      orbitTouchCount: 0,
    });
  assertCondition(
    config.TOUCH_RED_DOT_HIT_RADIUS_MULTIPLIER === 1.5 &&
      touchRedDotRadius === 36 &&
      mouseRedDotRadius === 24 &&
      insideRoute === "red-dot-aim" &&
      outsideRoute === "orbit",
    `빨간 점 터치 반경 또는 진입 경로가 다릅니다: multiplier=${config.TOUCH_RED_DOT_HIT_RADIUS_MULTIPLIER}, touch=${touchRedDotRadius}, mouse=${mouseRedDotRadius}, inside=${insideRoute}, outside=${outsideRoute}`,
  );

  const smallTouchMaxDrag =
    input.computeEffectiveMaxDragPixels(
      { pointerType: "touch" },
      400,
    );
  const largeTouchMaxDrag =
    input.computeEffectiveMaxDragPixels(
      { pointerType: "touch" },
      1000,
    );
  const mouseMaxDrag =
    input.computeEffectiveMaxDragPixels(
      { pointerType: "mouse" },
      400,
    );
  const upwardPower = input.computeRedDotPullPower(
    100,
    40,
    smallTouchMaxDrag,
  );
  const smallHalfPower = input.computeRedDotPullPower(
    100,
    100 + smallTouchMaxDrag / 2,
    smallTouchMaxDrag,
  );
  const smallFullPower = input.computeRedDotPullPower(
    100,
    100 + smallTouchMaxDrag,
    smallTouchMaxDrag,
  );
  const mouseAtTouchFullDistance =
    input.computeRedDotPullPower(
      100,
      100 + smallTouchMaxDrag,
      mouseMaxDrag,
    );
  const mouseFullPower = input.computeRedDotPullPower(
    100,
    100 + mouseMaxDrag,
    mouseMaxDrag,
  );
  assertCondition(
    config.TOUCH_MAX_DRAG_VIEWPORT_RATIO === 0.28 &&
      config.TOUCH_MAX_DRAG_MIN_PIXELS === 80 &&
      nearlyEqual(smallTouchMaxDrag, 112) &&
      largeTouchMaxDrag === 180 &&
      mouseMaxDrag === 180 &&
      upwardPower === 0 &&
      !input.shouldLaunchRedDotPull(upwardPower) &&
      nearlyEqual(smallHalfPower, 0.5) &&
      input.shouldLaunchRedDotPull(smallHalfPower) &&
      smallFullPower === 1 &&
      nearlyEqual(
        mouseAtTouchFullDistance,
        smallTouchMaxDrag / 180,
      ) &&
      mouseAtTouchFullDistance < 1 &&
      mouseFullPower === 1,
    `viewport별 빨간 점 충전이 다릅니다: smallMax=${smallTouchMaxDrag}, largeMax=${largeTouchMaxDrag}, mouseMax=${mouseMaxDrag}, upward=${upwardPower}, smallHalf=${smallHalfPower}, smallFull=${smallFullPower}, mouseAt112=${mouseAtTouchFullDistance}, mouseFull=${mouseFullPower}`,
  );

  const additionalAimFingerRoute =
    input.decideBilliardsTouchPointerRoute({
      hasSelectedPiece: true,
      strikeMode: false,
      redDotHit: false,
      activeInputPointer: true,
      orbitTouchCount: 0,
    });
  const strikeOrbitFirstRoute =
    input.decideBilliardsTouchPointerRoute({
      hasSelectedPiece: true,
      strikeMode: true,
      redDotHit: false,
      activeInputPointer: false,
      orbitTouchCount: 0,
    });
  const strikeOrbitSecondRoute =
    input.decideBilliardsTouchPointerRoute({
      hasSelectedPiece: true,
      strikeMode: true,
      // 두 번째 손가락이 빨간 점 위여도 이미 시작된 카메라 제스처가 우선한다.
      redDotHit: true,
      activeInputPointer: true,
      orbitTouchCount: 1,
    });
  assertCondition(
    additionalAimFingerRoute === "blocked" &&
      strikeOrbitFirstRoute === "orbit" &&
      strikeOrbitSecondRoute === "orbit",
    `멀티터치 소유권이 다릅니다: aimExtra=${additionalAimFingerRoute}, strikeFirst=${strikeOrbitFirstRoute}, strikeSecond=${strikeOrbitSecondRoute}`,
  );
  console.log(
    `[통과 c] 빨간 점 터치: radius=${touchRedDotRadius}px(${config.TOUCH_RED_DOT_HIT_RADIUS_MULTIPLIER}x), inside=${insideRoute}, outside=${outsideRoute}; viewport400 max=${smallTouchMaxDrag.toFixed(3)}, 56px=${smallHalfPower.toFixed(3)}, 112px=${smallFullPower.toFixed(3)}; viewport1000 max=${largeTouchMaxDrag.toFixed(3)}; mouse max=${mouseMaxDrag.toFixed(3)}, at112=${mouseAtTouchFullDistance.toFixed(3)}; upward=${upwardPower.toFixed(3)}→launch=${input.shouldLaunchRedDotPull(upwardPower)}; strikeOrbit=${strikeOrbitFirstRoute}→${strikeOrbitSecondRoute}, aimExtra=${additionalAimFingerRoute}`,
  );

  const cylinderGeometry = new CylinderGeometry(1, 1, 2, 64);
  const cylinderMaterial = new MeshBasicMaterial();
  const cylinder = new Mesh(cylinderGeometry, cylinderMaterial);
  cylinder.updateMatrixWorld(true);
  const projection = {
    center: new Vector3(0, 0, 0),
    cameraRight: new Vector3(1, 0, 0),
    worldUp: new Vector3(0, 1, 0),
    viewDirection: new Vector3(0, 0, 1),
    halfWidth: 1,
    halfHeight: 1,
    rayMargin: 3,
  };
  const centerHit = strikePanel.pickStrikePanelWorldPoint(
    cylinder,
    projection,
    0,
    0,
  );
  const rightHit = strikePanel.pickStrikePanelWorldPoint(
    cylinder,
    projection,
    0.5,
    0,
  );
  const highHit = strikePanel.pickStrikePanelWorldPoint(
    cylinder,
    projection,
    0,
    0.5,
  );
  const outsideHit = strikePanel.pickStrikePanelWorldPoint(
    cylinder,
    projection,
    1.2,
    0,
  );
  const projectedRight =
    rightHit === null
      ? null
      : strikePanel.projectStrikePointToPanel(
          rightHit,
          projection,
        );
  assertCondition(
    centerHit !== null &&
      nearlyEqual(centerHit.x, 0) &&
      nearlyEqual(centerHit.y, 0) &&
      rightHit !== null &&
      nearlyEqual(rightHit.x, 0.5) &&
      highHit !== null &&
      nearlyEqual(highHit.y, 0.5) &&
      outsideHit === null &&
      projectedRight !== null &&
      nearlyEqual(projectedRight.u, 0.5) &&
      nearlyEqual(projectedRight.v, 0),
    `타점 패널 직교 매핑이 다릅니다: center=${JSON.stringify(centerHit)}, right=${JSON.stringify(rightHit)}, high=${JSON.stringify(highHit)}, outside=${JSON.stringify(outsideHit)}, projected=${JSON.stringify(projectedRight)}`,
  );
  console.log(
    `[통과 d] 타점 패널 직교 매핑: center=(${centerHit.x.toFixed(3)},${centerHit.y.toFixed(3)}), +u x=${rightHit.x.toFixed(3)}, +v y=${highHit.y.toFixed(3)}, outside=${String(outsideHit)}, markerU=${projectedRight.u.toFixed(3)}`,
  );
  cylinderGeometry.dispose();
  cylinderMaterial.dispose();

  const viewport = {
    left: 0,
    top: 0,
    right: 400,
    bottom: 300,
  };
  const popup = { width: 100, height: 50 };
  const anchorAt = (x, y) => ({
    x,
    y,
    pieceRect: { left: x, top: y, right: x, bottom: y },
  });
  const centerPlacement = actionBar.computeActionBarPlacement(
    viewport,
    anchorAt(200, 150),
    popup,
    null,
  );
  const rightEdgePlacement = actionBar.computeActionBarPlacement(
    viewport,
    anchorAt(380, 150),
    popup,
    null,
  );
  const leftEdgePlacement = actionBar.computeActionBarPlacement(
    viewport,
    anchorAt(4, 150),
    popup,
    null,
  );
  const bottomEdgePlacement = actionBar.computeActionBarPlacement(
    viewport,
    anchorAt(200, 290),
    popup,
    null,
  );
  const panelFlipPlacement = actionBar.computeActionBarPlacement(
    viewport,
    anchorAt(250, 150),
    popup,
    { left: 260, top: 100, right: 390, bottom: 200 },
  );
  const narrowPieceAvoidPlacement =
    actionBar.computeActionBarPlacement(
      { left: 0, top: 0, right: 240, bottom: 300 },
      {
        x: 120,
        y: 150,
        pieceRect: {
          left: 100,
          top: 130,
          right: 140,
          bottom: 170,
        },
      },
      { width: 120, height: 50 },
      null,
    );
  assertCondition(
    centerPlacement.side === "right" &&
      centerPlacement.left === 212 &&
      centerPlacement.top === 125 &&
      rightEdgePlacement.side === "left" &&
      rightEdgePlacement.left === 268 &&
      leftEdgePlacement.side === "right" &&
      leftEdgePlacement.left === 16 &&
      bottomEdgePlacement.top === 242 &&
      panelFlipPlacement.side === "left" &&
      panelFlipPlacement.left === 138 &&
      narrowPieceAvoidPlacement.left === 60 &&
      narrowPieceAvoidPlacement.top === 68,
    `액션 바 배치가 다릅니다: center=${JSON.stringify(centerPlacement)}, right=${JSON.stringify(rightEdgePlacement)}, left=${JSON.stringify(leftEdgePlacement)}, bottom=${JSON.stringify(bottomEdgePlacement)}, panel=${JSON.stringify(panelFlipPlacement)}, narrow=${JSON.stringify(narrowPieceAvoidPlacement)}`,
  );
  console.log(
    `[통과 e] 액션 바 팝업: center=${centerPlacement.side}@(${centerPlacement.left},${centerPlacement.top}), right-edge=${rightEdgePlacement.side}@${rightEdgePlacement.left}, left-edge=${leftEdgePlacement.side}@${leftEdgePlacement.left}, bottom-top=${bottomEdgePlacement.top}, panel-flip=${panelFlipPlacement.side}@${panelFlipPlacement.left}, narrow-piece-avoid=(${narrowPieceAvoidPlacement.left},${narrowPieceAvoidPlacement.top})`,
  );

  const automaticStrikePoint = new Vector3(0.1, 0.2, 0.3);
  const overrideStrikePoint = new Vector3(9, 8, 7);
  const strikeRuntime = { strikePointOverride: null };
  aimParameters.setStrikePointOverride(strikeRuntime, overrideStrikePoint);
  const configuredOverride = strikeRuntime.strikePointOverride;
  const classicStrikePoint =
    aimParameters.resolveStrikeApplicationPoint(
      false,
      automaticStrikePoint,
      configuredOverride,
    );
  const billiardsStrikePoint =
    aimParameters.resolveStrikeApplicationPoint(
      true,
      automaticStrikePoint,
      configuredOverride,
    );
  assertCondition(
    classicStrikePoint.equals(automaticStrikePoint) &&
      !classicStrikePoint.equals(overrideStrikePoint) &&
      billiardsStrikePoint.equals(overrideStrikePoint) &&
      classicStrikePoint !== automaticStrikePoint &&
      billiardsStrikePoint !== overrideStrikePoint,
    `모드별 타점 분리가 다릅니다: classic=${JSON.stringify(classicStrikePoint)}, billiards=${JSON.stringify(billiardsStrikePoint)}`,
  );
  console.log(
    `[통과 f] 모드별 타점: classic=기본(${classicStrikePoint.toArray().join(",")}), billiards=override(${billiardsStrikePoint.toArray().join(",")})`,
  );
} finally {
  await vite.close();
}
