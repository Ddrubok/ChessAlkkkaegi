import {
  Box3,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Quaternion,
  RingGeometry,
  Shape,
  ShapeGeometry,
  Sphere,
  SphereGeometry,
  Vector3,
} from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import {
  BOWSTRING_MAX_PULL,
  GRAVITY_Y,
  GROUND_LANE_LENGTH,
  GUIDE_ARC_LENGTH,
  MAX_DRAG_PIXELS,
  NOMINAL_GUIDE_SPEED,
} from "./config";
import type { PieceBodyBinding } from "./physics";
import type { SceneRuntime } from "./scene";

export interface FrozenCameraBasis {
  // 포인터를 누른 순간의 화면 가로축을 고정해 카메라 변화가 조준을 바꾸지 않게 한다.
  right: Vector3;
  // 포인터를 누른 순간의 화면 앞쪽을 판 평면 방향으로 보존한다.
  forward: Vector3;
}

export interface AimRelease {
  pieceId: string;
  direction: Vector3;
  normalizedPower: number;
}

export interface LaunchRequest extends AimRelease {
  applicationPoint: Vector3;
}

export interface ActiveAim {
  // 제거 또는 턴 변경 때 같은 말을 정확히 정리하기 위한 개체 id다.
  pieceId: string;
  // 드래그 길이와 방향을 일관되게 계산하는 화면 시작점이다.
  startX: number;
  startY: number;
  // 카메라가 움직여도 조준 방향이 바뀌지 않게 누른 순간의 축을 보존한다.
  basis: FrozenCameraBasis;
  // 물리 발사와 경로 안내가 공유하는 정규화된 월드 방향이다.
  direction: Vector3;
  // 화면 거리에서 계산한 0~1 범위의 발사 세기다.
  normalizedPower: number;
  // 클래식 드래그만 기존 독립 세기 숫자를 사용하고 당구식은 새 HUD 하나만 사용한다.
  showsPowerReadout: boolean;
  // 클래식 드래그는 항상 수평이라 고도 계기가 의미 없고 당구식에서만 표시한다.
  showsElevationGauge: boolean;
}

interface RenderPulse {
  // 공유 형상 대신 개별 렌더 크기만 바꾸기 위한 대상 메시다.
  mesh: Mesh;
  // 실제 화면 시간으로 0.12초 펄스를 진행하기 위한 기준 시각이다.
  startedAt: number;
}

export interface AimRuntime {
  sceneRuntime: SceneRuntime;
  // 말의 자식이 아닌 월드 수평 선택 표시다.
  marker: Mesh;
  // 보드 면 위에 깔려 시선과 비스듬히 만나는 덕분에 원근이 살아나는 고정 길이 진행 띠다.
  groundRibbon: Mesh<BufferGeometry, MeshBasicMaterial>;
  faintGroundRibbon: Mesh<BufferGeometry, MeshBasicMaterial>;
  // 매 프레임 카메라를 향해 폭을 다시 잡아 정면에서도 곡률이 읽히는 공중 고도 띠다.
  elevationRibbon: Mesh<BufferGeometry, MeshBasicMaterial>;
  faintElevationRibbon: Mesh<BufferGeometry, MeshBasicMaterial>;
  // 띠 위에서 전진 방향을 크게 알리는 화살표와, 밝고 어두운 칸 모두에서 실루엣을 분리하는 외곽선이다.
  groundChevrons: Array<Mesh<ShapeGeometry, MeshBasicMaterial>>;
  faintGroundChevrons: Array<Mesh<ShapeGeometry, MeshBasicMaterial>>;
  groundChevronOutlines: Array<Mesh<ShapeGeometry, MeshBasicMaterial>>;
  faintGroundChevronOutlines: Array<Mesh<ShapeGeometry, MeshBasicMaterial>>;
  // 충전 세기만 뒤쪽 V 형태로 보여 주는 깊이 판정 활줄과 희미한 보조 패스다.
  bowstring: Line2;
  faintBowstring: Line2;
  // 활줄이 뒤로 당겨지는 꼭짓점을 보존하는 주 패스와 보조 패스 표식이다.
  bowPullMarker: Mesh<SphereGeometry, MeshBasicMaterial>;
  faintBowPullMarker: Mesh<SphereGeometry, MeshBasicMaterial>;
  powerReadout: HTMLDivElement;
  // 카메라와 조준이 잠겨 있어 3차원 지시선으로는 읽을 수 없는 발사 고도를 화면 좌표에서 보여 주는 계기다.
  elevationGauge: HTMLDivElement;
  elevationNeedle: SVGPathElement;
  elevationValue: HTMLSpanElement;
  // 탭 선택은 조준이 끝난 뒤에도 유지될 수 있어 별도로 보존한다.
  selectedPieceId: string | null;
  // 활성 포인터 하나의 조준 데이터만 허용한다.
  activeAim: ActiveAim | null;
  // 경로 시작점과 실제 물리 적용점이 어긋나지 않도록 공유하는 월드 좌표다.
  applicationPoint: Vector3 | null;
  // 여러 프레임에 걸친 렌더 전용 발사 펄스를 개체별로 추적한다.
  pulses: Map<string, RenderPulse>;
}

// 선택 표시가 말과 함께 기울지 않도록 월드 장면에 놓는 얇은 수평 고리다.
const MARKER_GEOMETRY = new RingGeometry(0.23, 0.29, 48);

// 발사 직후 물리 형상은 그대로 둔 채 렌더 메시만 짧게 강조하는 시간이다.
const LAUNCH_PULSE_SECONDS = 0.12;

// 보드 아래나 말 뒤에서도 안내가 읽히되 주 패스보다 약하게 남는 보조 패스 불투명도다.
const FAINT_GUIDE_OPACITY = 0.35;

// 바닥 화살표 수를 제한해 진행 방향은 읽히되 거리 눈금처럼 보이지 않게 한다.
const GROUND_CHEVRON_COUNT = 5;

// 공중 리본이 급한 곡률에서도 꺾여 보이지 않도록 고정 개수의 호 길이 표본을 쓴다.
const GUIDE_CURVE_POINT_COUNT = 13;

// 보드 칸 무늬가 비쳐 길이 감각을 유지하도록 바닥 띠의 시작과 끝 폭을 좁혀 간다.
const GROUND_RIBBON_NEAR_WIDTH = 0.3;
const GROUND_RIBBON_FAR_WIDTH = 0.16;
const GROUND_RIBBON_OPACITY = 0.45;

// 공중 띠는 화면을 가리지 않으면서도 끝을 보는 시점에 곡률이 드러날 만큼만 폭을 준다.
const ELEVATION_RIBBON_WIDTH = 0.08;
const ELEVATION_RIBBON_OPACITY = 0.6;

// 화살표 외곽선은 밝고 어두운 보드 칸 모두에서 실루엣을 분리한다.
const GROUND_CHEVRON_OUTLINE_SCALE = 1.18;

// 바닥 화살표의 기준 폭과 길이는 띠 안에 머물면서 방향을 크게 읽히게 하고, 고정 간격 안에서 외곽선까지 겹치지 않는다.
const GROUND_CHEVRON_BASE_WIDTH = 0.27;
const GROUND_CHEVRON_BASE_LENGTH = 0.18;

// 외곽선이 힘 색과 경쟁하지 않고 실루엣만 분리하도록 고정하는 거의 검은색이다.
const GROUND_CHEVRON_OUTLINE_COLOR = 0x121212;

// 보드와 같은 깊이에서 깜박이지 않되 물리 좌표로 오해되지 않을 만큼만 띄운다.
const GUIDE_GROUND_Y = 0.003;
const GROUND_CHEVRON_FILL_Y = GUIDE_GROUND_Y + 0.001;
const GROUND_CHEVRON_OUTLINE_Y = GUIDE_GROUND_Y + 0.0005;

// 지면 화살표는 로컬 -z 방향을 진행 방향으로 삼아 회전만으로 재사용한다.
const GUIDE_GROUND_FORWARD = new Vector3(0, 0, -1);

// 바닥 그림자보다 약간 굵게 충전 장력을 보여 주는 화면 기준 활줄 두께다.
const BOWSTRING_LINE_WIDTH = 2.6;

// 당김 꼭짓점이 전방 착지 표식으로 오해되지 않으면서 손맛을 보강하는 작은 크기다.
const BOW_PULL_MARKER_GEOMETRY = new SphereGeometry(0.035, 12, 8);

// 고도 계기는 판을 옆에서 본 그림이라 원근 왜곡이 없고, 바늘은 회전만으로 발사 각도를 그대로 보여 준다.
const ELEVATION_GAUGE_MARKUP = `
<svg class="aim-elevation-dial" viewBox="-14 -52 104 104" aria-hidden="true">
  <line class="aim-elevation-limit" x1="0" y1="0" x2="26" y2="-45" />
  <line class="aim-elevation-limit" x1="0" y1="0" x2="26" y2="45" />
  <line class="aim-elevation-board" x1="-10" y1="0" x2="62" y2="0" />
  <path class="aim-elevation-needle" d="M 0 -3.2 L 40 -3.2 L 40 -8.4 L 56 0 L 40 8.4 L 40 3.2 L 0 3.2 Z" />
  <circle class="aim-elevation-pivot" cx="0" cy="0" r="5" />
</svg>
<span class="aim-elevation-value">고도 0°</span>`;

export interface GuideCurvePoint {
  // 실제 적용점을 기준으로 한 짧은 탄도 곡선의 월드 위치다.
  position: Vector3;
  // 공중 띠의 폭 방향이 순간 진행 방향과 직교하도록 정규화한 곡선 접선이다.
  tangent: Vector3;
  // 말 바깥 시작점과 보드 상면 도달점을 같은 곡선에서 다시 표본화하기 위한 탄도 시각이다.
  time: number;
}

export interface GuideCurve {
  // 그림자와 원뿔이 같은 곡선 해를 공유하도록 호 길이 순서로 보존한 표본이다.
  points: GuideCurvePoint[];
  // 마지막 표본이 고정 안내 호 길이에 도달했음을 수치 검증할 값이다.
  arcLength: number;
  // 같은 곡선에서 구 표면 바깥의 원뿔 위치를 다시 표본화하는 종료 시각이다.
  endTime: number;
}

/**
 * 수평 속도가 일정한 탄도에서 속력 적분의 원시함수를 계산한다.
 */
function computeSpeedPrimitive(
  verticalSpeed: number,
  horizontalSpeed: number,
): number {
  if (horizontalSpeed < 1e-12) {
    return 0.5 * verticalSpeed * Math.abs(verticalSpeed);
  }
  const speed = Math.hypot(verticalSpeed, horizontalSpeed);
  return 0.5 * (
    verticalSpeed * speed +
    horizontalSpeed * horizontalSpeed *
      Math.asinh(verticalSpeed / horizontalSpeed)
  );
}

/**
 * 실제 중력 아래 안내 탄도의 시작부터 지정 시각까지 정확한 호 길이를 구한다.
 */
function computeGuideArcLengthAtTime(
  direction: Vector3,
  time: number,
): number {
  const horizontalSpeed =
    NOMINAL_GUIDE_SPEED * Math.hypot(direction.x, direction.z);
  const initialVerticalSpeed = NOMINAL_GUIDE_SPEED * direction.y;
  const currentVerticalSpeed =
    initialVerticalSpeed + GRAVITY_Y * time;
  const primitiveDelta =
    computeSpeedPrimitive(currentVerticalSpeed, horizontalSpeed) -
    computeSpeedPrimitive(initialVerticalSpeed, horizontalSpeed);
  return Math.abs(primitiveDelta / GRAVITY_Y);
}

/**
 * 이분 탐색으로 원하는 호 길이에 해당하는 탄도 시각을 찾는다.
 */
function findGuideTimeAtArcLength(
  direction: Vector3,
  targetArcLength: number,
  maximumTime: number,
): number {
  let lowerTime = 0;
  let upperTime = maximumTime;
  for (let iteration = 0; iteration < 52; iteration += 1) {
    const middleTime = (lowerTime + upperTime) / 2;
    if (
      computeGuideArcLengthAtTime(direction, middleTime) <
      targetArcLength
    ) {
      lowerTime = middleTime;
    } else {
      upperTime = middleTime;
    }
  }
  return (lowerTime + upperTime) / 2;
}

/**
 * 탄도 시각 하나를 월드 위치와 순간 접선으로 변환한다.
 */
function computeGuidePointAtTime(
  start: Vector3,
  initialVelocity: Vector3,
  time: number,
): GuideCurvePoint {
  const position = start
    .clone()
    .addScaledVector(initialVelocity, time);
  position.y += 0.5 * GRAVITY_Y * time * time;
  const tangent = initialVelocity.clone();
  tangent.y += GRAVITY_Y * time;
  tangent.normalize();
  return { position, tangent, time };
}

/**
 * 세기와 충돌 정보를 쓰지 않고 방향·고정 속도·중력만으로 짧은 경로 안내를 만든다.
 */
export function computeGuideCurve(
  start: Vector3,
  direction: Vector3,
): GuideCurve {
  const normalizedDirection = direction.clone().normalize();
  let maximumTime = GUIDE_ARC_LENGTH / NOMINAL_GUIDE_SPEED;
  while (
    computeGuideArcLengthAtTime(normalizedDirection, maximumTime) <
    GUIDE_ARC_LENGTH
  ) {
    maximumTime *= 2;
  }
  const endTime = findGuideTimeAtArcLength(
    normalizedDirection,
    GUIDE_ARC_LENGTH,
    maximumTime,
  );
  const initialVelocity = normalizedDirection
    .clone()
    .multiplyScalar(NOMINAL_GUIDE_SPEED);
  const points: GuideCurvePoint[] = [];
  for (let index = 0; index < GUIDE_CURVE_POINT_COUNT; index += 1) {
    const targetArcLength =
      GUIDE_ARC_LENGTH * index / (GUIDE_CURVE_POINT_COUNT - 1);
    let time = 0;
    if (index === GUIDE_CURVE_POINT_COUNT - 1) {
      time = endTime;
    } else if (index > 0) {
      time = findGuideTimeAtArcLength(
        normalizedDirection,
        targetArcLength,
        endTime,
      );
    }
    points.push(computeGuidePointAtTime(start, initialVelocity, time));
  }
  return {
    points,
    arcLength: computeGuideArcLengthAtTime(
      normalizedDirection,
      endTime,
    ),
    endTime,
  };
}

/**
 * 공중 띠가 판 아래로 파고들지 않도록 명목 곡선이 보드 상면을 처음 지나는 시각을 찾는다.
 */
function findGuideBoardClipTime(
  start: Vector3,
  direction: Vector3,
  endTime: number,
): number {
  const initialVelocity = direction
    .clone()
    .normalize()
    .multiplyScalar(NOMINAL_GUIDE_SPEED);
  const heightAt = (time: number): number =>
    start.y + initialVelocity.y * time + 0.5 * GRAVITY_Y * time * time;
  // 호 길이 안에서 끝까지 상면 위에 있으면 자를 구간이 없다.
  if (heightAt(endTime) >= GUIDE_GROUND_Y) {
    return endTime;
  }
  if (heightAt(0) <= GUIDE_GROUND_Y) {
    return 0;
  }
  // 높이는 위로 볼록한 포물선이라 상면 위 구간이 시작부터 이어지는 하나의 구간이다.
  let lowerTime = 0;
  let upperTime = endTime;
  for (let iteration = 0; iteration < 52; iteration += 1) {
    const middleTime = (lowerTime + upperTime) / 2;
    if (heightAt(middleTime) > GUIDE_GROUND_Y) {
      lowerTime = middleTime;
    } else {
      upperTime = middleTime;
    }
  }
  return upperTime;
}

/**
 * 같은 탄도 해에서 지정한 두 시각 사이만 다시 표본화해 보이는 구간에 표본을 집중시킨다.
 */
function sampleGuideCurveRange(
  start: Vector3,
  direction: Vector3,
  fromTime: number,
  toTime: number,
  pointCount: number,
): GuideCurvePoint[] {
  const initialVelocity = direction
    .clone()
    .normalize()
    .multiplyScalar(NOMINAL_GUIDE_SPEED);
  const points: GuideCurvePoint[] = [];
  for (let index = 0; index < pointCount; index += 1) {
    const ratio = index / (pointCount - 1);
    points.push(
      computeGuidePointAtTime(
        start,
        initialVelocity,
        fromTime + (toTime - fromTime) * ratio,
      ),
    );
  }
  return points;
}

/**
 * 바닥 리본이 선택 말 안에서 시작하지 않도록 실제 월드 구를 처음 벗어나는 곡선 지점을 찾는다.
 */
function computeGuideVisibleStart(
  start: Vector3,
  direction: Vector3,
  endTime: number,
  exclusionSphere: Sphere,
): GuideCurvePoint {
  const normalizedDirection = direction.clone().normalize();
  const initialVelocity = normalizedDirection
    .clone()
    .multiplyScalar(NOMINAL_GUIDE_SPEED);
  const endPoint = computeGuidePointAtTime(
    start,
    initialVelocity,
    endTime,
  );
  if (
    endPoint.position.distanceTo(exclusionSphere.center) <
    exclusionSphere.radius
  ) {
    throw new Error(
      "선택한 말의 실제 bounding sphere 바깥에서 바닥 리본을 시작할 공간이 없습니다.",
    );
  }

  let lowerTime = 0;
  let upperTime = endTime;
  for (let iteration = 0; iteration < 52; iteration += 1) {
    const middleTime = (lowerTime + upperTime) / 2;
    const middlePoint = computeGuidePointAtTime(
      start,
      initialVelocity,
      middleTime,
    );
    if (
      middlePoint.position.distanceTo(exclusionSphere.center) <
      exclusionSphere.radius
    ) {
      lowerTime = middleTime;
    } else {
      upperTime = middleTime;
    }
  }
  return computeGuidePointAtTime(start, initialVelocity, upperTime);
}

/**
 * 선택 메시의 실제 POSITION 정점 구를 월드 중심과 반경까지 보존해 가림 영역으로 만든다.
 */
function computePieceWorldBoundingSphere(mesh: Mesh): Sphere {
  if (mesh.geometry.boundingSphere === null) {
    mesh.geometry.computeBoundingSphere();
  }
  const localSphere = mesh.geometry.boundingSphere;
  if (localSphere === null) {
    throw new Error(`${mesh.name} 말의 실제 bounding sphere를 계산하지 못했습니다.`);
  }
  mesh.updateMatrixWorld(true);
  return localSphere.clone().applyMatrix4(mesh.matrixWorld);
}

/**
 * 마지막 경로 조각과 바닥 그림자를 잇는 두 점짜리 연결선을 만든다.
 */
/**
 * 두 렌더 패스가 같은 위치 자료를 공유해 힘에 따라 형상이 달라질 여지를 없앤다.
 */
function createRibbonPass(
  name: string,
  geometry: BufferGeometry,
  depthTest: boolean,
  opacity: number,
  renderOrder: number,
): Mesh<BufferGeometry, MeshBasicMaterial> {
  const material = new MeshBasicMaterial({
    color: 0xffffff,
    side: DoubleSide,
    depthTest,
    depthWrite: false,
    transparent: true,
    opacity,
  });
  const ribbon = new Mesh(geometry, material);
  ribbon.name = name;
  ribbon.visible = false;
  ribbon.renderOrder = renderOrder;
  ribbon.frustumCulled = false;
  return ribbon;
}

/**
 * 굵은 V 모양이 띠 위에서 전진 방향을 가리키도록 재사용할 평면 형상을 만든다.
 */
function createGroundChevronGeometry(): ShapeGeometry {
  const halfWidth = GROUND_CHEVRON_BASE_WIDTH / 2;
  const halfLength = GROUND_CHEVRON_BASE_LENGTH / 2;
  const innerWidth = halfWidth * 0.48;
  const innerForward = halfLength * 0.18;
  const shape = new Shape();
  shape.moveTo(-halfWidth, -halfLength);
  shape.lineTo(0, halfLength);
  shape.lineTo(halfWidth, -halfLength);
  shape.lineTo(innerWidth, -halfLength);
  shape.lineTo(0, innerForward);
  shape.lineTo(-innerWidth, -halfLength);
  shape.closePath();
  const geometry = new ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/**
 * 바닥 진행 방향을 표시할 평면 화살표들을 같은 재질 규칙으로 준비한다.
 */
function createGroundChevrons(
  namePrefix: string,
  geometry: ShapeGeometry,
  color: number,
  depthTest: boolean,
  opacity: number,
  renderOrder: number,
): Array<Mesh<ShapeGeometry, MeshBasicMaterial>> {
  return Array.from({ length: GROUND_CHEVRON_COUNT }, (_, index) => {
    const material = new MeshBasicMaterial({
      color,
      side: DoubleSide,
      depthTest,
      depthWrite: false,
      transparent: true,
      opacity,
    });
    const chevron = new Mesh(geometry, material);
    chevron.name = `${namePrefix}${index + 1}`;
    chevron.visible = false;
    chevron.renderOrder = renderOrder;
    chevron.frustumCulled = false;
    return chevron;
  });
}

/**
 * 양쪽 고정점과 뒤쪽 당김점을 잇는 굵은 V자 활줄 렌더 패스를 만든다.
 */
function createBowstring(
  name: string,
  depthTest: boolean,
  opacity: number,
  renderOrder: number,
): Line2 {
  const geometry = new LineGeometry();
  geometry.setPositions(new Array<number>(9).fill(0));
  const material = new LineMaterial({
    color: 0xffffff,
    linewidth: BOWSTRING_LINE_WIDTH,
    depthTest,
    depthWrite: false,
    transparent: true,
    opacity,
  });
  const line = new Line2(geometry, material);
  line.name = name;
  line.visible = false;
  line.renderOrder = renderOrder;
  line.frustumCulled = false;
  return line;
}

/**
 * 활줄 꼭짓점이 말 뒤로 당겨지는 위치를 작게 강조하는 렌더 표식을 만든다.
 */
function createBowPullMarker(
  name: string,
  depthTest: boolean,
  opacity: number,
  renderOrder: number,
): Mesh<SphereGeometry, MeshBasicMaterial> {
  const marker = new Mesh(
    BOW_PULL_MARKER_GEOMETRY,
    new MeshBasicMaterial({
      color: 0xffffff,
      depthTest,
      depthWrite: false,
      transparent: true,
      opacity,
    }),
  );
  marker.name = name;
  marker.visible = false;
  marker.renderOrder = renderOrder;
  marker.frustumCulled = false;
  return marker;
}

/**
 * 띠의 좌우 정점을 담을 고정 크기 버퍼와 삼각형 인덱스를 준비한다.
 */
function createRibbonGeometry(pointCount: number): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(pointCount * 2 * 3, 3),
  );
  const indices: number[] = [];
  for (let index = 0; index < pointCount - 1; index += 1) {
    const first = index * 2;
    indices.push(first, first + 1, first + 2);
    indices.push(first + 2, first + 1, first + 3);
  }
  geometry.setIndex(indices);
  return geometry;
}

/**
 * 고도와 세기 어디에도 반응하지 않도록 말 바깥에서 시작하는 고정 길이 바닥 띠의 두 끝점을 만든다.
 */
function computeGroundLane(
  direction: Vector3,
  exclusionSphere: Sphere,
): { start: Vector3; end: Vector3; forward: Vector3 } {
  const forward = new Vector3(direction.x, 0, direction.z);
  if (forward.lengthSq() < 1e-12) {
    throw new Error("조준 방향의 수평 성분이 없어 바닥 띠를 만들 수 없습니다.");
  }
  forward.normalize();
  const start = new Vector3(
    exclusionSphere.center.x,
    GUIDE_GROUND_Y,
    exclusionSphere.center.z,
  ).addScaledVector(forward, exclusionSphere.radius);
  const end = start.clone().addScaledVector(forward, GROUND_LANE_LENGTH);
  return { start, end, forward };
}

/**
 * 보드 면에 깔린 사다리꼴 띠의 좌우 정점만 갱신해 시선과 비스듬히 만나는 원근을 유지한다.
 */
function setGroundRibbonGeometry(
  geometry: BufferGeometry,
  start: Vector3,
  end: Vector3,
  forward: Vector3,
): void {
  const side = new Vector3(-forward.z, 0, forward.x);
  const position = geometry.getAttribute("position");
  const startHalfWidth = GROUND_RIBBON_NEAR_WIDTH / 2;
  const endHalfWidth = GROUND_RIBBON_FAR_WIDTH / 2;
  const vertices = [
    start.clone().addScaledVector(side, startHalfWidth),
    start.clone().addScaledVector(side, -startHalfWidth),
    end.clone().addScaledVector(side, endHalfWidth),
    end.clone().addScaledVector(side, -endHalfWidth),
  ];
  vertices.forEach((vertex, index) => {
    position.setXYZ(index, vertex.x, GUIDE_GROUND_Y, vertex.z);
  });
  position.needsUpdate = true;
  geometry.computeBoundingSphere();
}

/**
 * 곡선 접선과 시선에 모두 수직인 폭 방향을 매 프레임 계산해 공중 띠가 카메라를 향하게 한다.
 */
export function computeBillboardCross(
  tangent: Vector3,
  point: Vector3,
  camera: PerspectiveCamera,
): Vector3 {
  const view = camera.position.clone().sub(point).normalize();
  const cross = tangent.clone().cross(view);
  if (cross.lengthSq() < 1e-12) {
    camera.updateMatrixWorld(true);
    cross.setFromMatrixColumn(camera.matrixWorld, 0);
    cross.addScaledVector(
      tangent,
      -cross.dot(tangent),
    );
  }
  if (cross.lengthSq() < 1e-12) {
    cross.set(0, 1, 0);
    cross.addScaledVector(
      tangent,
      -cross.dot(tangent),
    );
  }
  if (cross.lengthSq() < 1e-12) {
    cross.set(1, 0, 0);
    cross.addScaledVector(
      tangent,
      -cross.dot(tangent),
    );
  }
  return cross.normalize();
}

/**
 * 현재 카메라를 향하는 좌우 폭을 곡선의 모든 표본에서 다시 계산해 공중 띠를 갱신한다.
 */
function setElevationRibbonGeometry(
  geometry: BufferGeometry,
  points: readonly GuideCurvePoint[],
  camera: PerspectiveCamera,
): void {
  const position = geometry.getAttribute("position");
  points.forEach((point, index) => {
    const halfWidth = computeBillboardCross(
      point.tangent,
      point.position,
      camera,
    ).multiplyScalar(ELEVATION_RIBBON_WIDTH / 2);
    const left = point.position.clone().add(halfWidth);
    const right = point.position.clone().sub(halfWidth);
    position.setXYZ(index * 2, left.x, left.y, left.z);
    position.setXYZ(index * 2 + 1, right.x, right.y, right.z);
  });
  position.needsUpdate = true;
  geometry.computeBoundingSphere();
}

/**
 * 띠 안의 큰 화살표를 균등 배치하고 끝으로 갈수록 띠 폭에 맞춰 줄인다.
 */
function setGroundChevronTransforms(
  chevrons: readonly Mesh<ShapeGeometry, MeshBasicMaterial>[],
  start: Vector3,
  end: Vector3,
  forward: Vector3,
  y: number,
  outlineScale = 1,
): void {
  const orientation = new Quaternion().setFromUnitVectors(
    GUIDE_GROUND_FORWARD,
    forward,
  );
  chevrons.forEach((chevron, index) => {
    const progress = (index + 1) / (GROUND_CHEVRON_COUNT + 1);
    const width =
      GROUND_RIBBON_NEAR_WIDTH +
      (GROUND_RIBBON_FAR_WIDTH - GROUND_RIBBON_NEAR_WIDTH) *
        progress;
    const scale =
      (width / GROUND_CHEVRON_BASE_WIDTH) * outlineScale;
    chevron.position.lerpVectors(start, end, progress);
    chevron.position.y = y;
    chevron.quaternion.copy(orientation);
    chevron.scale.setScalar(scale);
  });
}

/**
 * 활줄 양끝과 뒤쪽 당김점을 하나의 V자 선으로 갱신한다.
 */
function setBowstringPoints(
  line: Line2,
  firstAnchor: Vector3,
  pullPoint: Vector3,
  secondAnchor: Vector3,
): void {
  line.geometry.setPositions([
    firstAnchor.x,
    firstAnchor.y,
    firstAnchor.z,
    pullPoint.x,
    pullPoint.y,
    pullPoint.z,
    secondAnchor.x,
    secondAnchor.y,
    secondAnchor.z,
  ]);
}

/**
 * 방향 안내 세 요소의 깊이 판정·희미한 패스를 같은 표시 상태로 묶는다.
 */
function setAimGuidesVisible(
  runtime: AimRuntime,
  visible: boolean,
): void {
  runtime.groundRibbon.visible = visible;
  runtime.faintGroundRibbon.visible = visible;
  runtime.elevationRibbon.visible = visible;
  runtime.faintElevationRibbon.visible = visible;
  runtime.groundChevrons.forEach((chevron) => {
    chevron.visible = visible;
  });
  runtime.faintGroundChevrons.forEach((chevron) => {
    chevron.visible = visible;
  });
  runtime.groundChevronOutlines.forEach((outline) => {
    outline.visible = visible;
  });
  runtime.faintGroundChevronOutlines.forEach((outline) => {
    outline.visible = visible;
  });
}

/**
 * 활줄은 실제 충전 중에만 두 렌더 패스와 당김점 표식을 함께 보여 준다.
 */
function setBowstringVisible(
  runtime: AimRuntime,
  visible: boolean,
): void {
  runtime.bowstring.visible = visible;
  runtime.faintBowstring.visible = visible;
  runtime.bowPullMarker.visible = visible;
  runtime.faintBowPullMarker.visible = visible;
}

/**
 * 세기는 형상을 바꾸지 않고 리본·화살표·활줄의 힘 색으로만 전달한다.
 */
function setAimGuideColor(
  runtime: AimRuntime,
  color: Color,
): void {
  runtime.groundRibbon.material.color.copy(color);
  runtime.faintGroundRibbon.material.color.copy(color);
  runtime.elevationRibbon.material.color.copy(color);
  runtime.faintElevationRibbon.material.color.copy(color);
  runtime.groundChevrons.forEach((chevron, index) => {
    chevron.material.color.copy(color);
    runtime.faintGroundChevrons[index].material.color.copy(color);
  });
  runtime.bowstring.material.color.copy(color);
  runtime.faintBowstring.material.color.copy(color);
  runtime.bowPullMarker.material.color.copy(color);
  runtime.faintBowPullMarker.material.color.copy(color);
}

/**
 * 발사 방향의 수직 성분만 각도로 바꿔 옆에서 본 계기의 바늘 회전과 숫자를 갱신한다.
 */
function updateElevationGauge(
  runtime: AimRuntime,
  direction: Vector3,
): void {
  const clampedHeight = Math.min(Math.max(direction.y, -1), 1);
  const degrees = Math.asin(clampedHeight) * (180 / Math.PI);
  // SVG는 y가 아래로 증가하므로 위로 향하는 고도를 음수 회전으로 바꾼다.
  runtime.elevationNeedle.setAttribute(
    "transform",
    `rotate(${(-degrees).toFixed(2)})`,
  );
  const rounded = Math.round(degrees);
  runtime.elevationValue.textContent =
    `고도 ${rounded > 0 ? "+" : ""}${rounded}°`;
}

/**
 * 물리 자세와 단위 렌더 크기로 현재 말의 월드 AABB를 계산한다.
 */
export function computePieceWorldAabb(
  binding: PieceBodyBinding,
  mesh: Mesh,
  target = new Box3(),
): Box3 {
  if (mesh.geometry.boundingBox === null) {
    mesh.geometry.computeBoundingBox();
  }
  const localBounds = mesh.geometry.boundingBox;
  if (localBounds === null) {
    throw new Error(`${binding.instance.id} 말의 로컬 AABB를 계산하지 못했습니다.`);
  }
  const translation = binding.body.translation();
  const rotation = binding.body.rotation();
  const matrix = new Matrix4().compose(
    new Vector3(translation.x, translation.y, translation.z),
    new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
    new Vector3(1, 1, 1),
  );
  return target.copy(localBounds).applyMatrix4(matrix);
}

/**
 * 카메라의 화면 축을 판 평면에 투영하고 정규화해 조준 동안 사용할 기준을 만든다.
 */
export function freezeCameraBasis(
  camera: PerspectiveCamera,
): FrozenCameraBasis {
  camera.updateMatrixWorld(true);
  const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  right.y = 0;
  const forward = new Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  if (right.lengthSq() < 1e-12 || forward.lengthSq() < 1e-12) {
    throw new Error("카메라의 수평 조준 기준을 계산하지 못했습니다.");
  }
  right.normalize();
  forward.normalize();
  return { right, forward };
}

/**
 * 선택 고리, 짧은 경로 안내와 세기 표시를 장면 및 화면에 준비한다.
 */
export function createAimRuntime(
  sceneRuntime: SceneRuntime,
): AimRuntime {
  const markerMaterial = new MeshBasicMaterial({
    color: 0xffd54a,
    depthTest: false,
    transparent: true,
    opacity: 0.9,
  });
  const marker = new Mesh(MARKER_GEOMETRY, markerMaterial);
  marker.name = "SelectionMarker";
  marker.rotation.x = -Math.PI / 2;
  marker.renderOrder = 10;
  marker.visible = false;
  sceneRuntime.scene.add(marker);

  const groundRibbonGeometry = createRibbonGeometry(2);
  const groundRibbon = createRibbonPass(
    "AimGroundRibbon",
    groundRibbonGeometry,
    true,
    GROUND_RIBBON_OPACITY,
    20,
  );
  const faintGroundRibbon = createRibbonPass(
    "AimGroundRibbonFaint",
    groundRibbonGeometry,
    false,
    FAINT_GUIDE_OPACITY,
    19,
  );
  const elevationRibbonGeometry = createRibbonGeometry(
    GUIDE_CURVE_POINT_COUNT,
  );
  const elevationRibbon = createRibbonPass(
    "AimElevationRibbon",
    elevationRibbonGeometry,
    true,
    ELEVATION_RIBBON_OPACITY,
    20,
  );
  const faintElevationRibbon = createRibbonPass(
    "AimElevationRibbonFaint",
    elevationRibbonGeometry,
    false,
    FAINT_GUIDE_OPACITY,
    19,
  );
  const groundChevronGeometry = createGroundChevronGeometry();
  const groundChevrons = createGroundChevrons(
    "AimGroundChevron",
    groundChevronGeometry,
    0xffffff,
    true,
    1,
    20,
  );
  const faintGroundChevrons = createGroundChevrons(
    "AimGroundChevronFaint",
    groundChevronGeometry,
    0xffffff,
    false,
    FAINT_GUIDE_OPACITY,
    19,
  );
  const groundChevronOutlines = createGroundChevrons(
    "AimGroundChevronOutline",
    groundChevronGeometry,
    GROUND_CHEVRON_OUTLINE_COLOR,
    true,
    1,
    20,
  );
  const faintGroundChevronOutlines = createGroundChevrons(
    "AimGroundChevronOutlineFaint",
    groundChevronGeometry,
    GROUND_CHEVRON_OUTLINE_COLOR,
    false,
    FAINT_GUIDE_OPACITY,
    19,
  );
  sceneRuntime.scene.add(
    groundRibbon,
    faintGroundRibbon,
    elevationRibbon,
    faintElevationRibbon,
    ...groundChevrons,
    ...faintGroundChevrons,
    ...groundChevronOutlines,
    ...faintGroundChevronOutlines,
  );

  const bowstring = createBowstring(
    "AimBowstring",
    true,
    1,
    20,
  );
  const faintBowstring = createBowstring(
    "AimBowstringFaint",
    false,
    FAINT_GUIDE_OPACITY,
    19,
  );
  const bowPullMarker = createBowPullMarker(
    "AimBowPullMarker",
    true,
    1,
    20,
  );
  const faintBowPullMarker = createBowPullMarker(
    "AimBowPullMarkerFaint",
    false,
    FAINT_GUIDE_OPACITY,
    19,
  );
  sceneRuntime.scene.add(
    bowstring,
    faintBowstring,
    bowPullMarker,
    faintBowPullMarker,
  );

  const powerReadout = document.createElement("div");
  powerReadout.className = "aim-power";
  powerReadout.setAttribute("aria-live", "polite");
  powerReadout.hidden = true;

  const elevationGauge = document.createElement("div");
  elevationGauge.className = "aim-elevation";
  elevationGauge.hidden = true;
  elevationGauge.innerHTML = ELEVATION_GAUGE_MARKUP;
  const elevationNeedle = elevationGauge.querySelector<SVGPathElement>(
    ".aim-elevation-needle",
  );
  const elevationValue = elevationGauge.querySelector<HTMLSpanElement>(
    ".aim-elevation-value",
  );
  if (elevationNeedle === null || elevationValue === null) {
    throw new Error("고도 계기의 바늘 또는 값 요소를 만들지 못했습니다.");
  }
  sceneRuntime.renderer.domElement.parentElement?.append(
    powerReadout,
    elevationGauge,
  );

  return {
    sceneRuntime,
    marker,
    groundRibbon,
    faintGroundRibbon,
    elevationRibbon,
    faintElevationRibbon,
    groundChevrons,
    faintGroundChevrons,
    groundChevronOutlines,
    faintGroundChevronOutlines,
    bowstring,
    faintBowstring,
    bowPullMarker,
    faintBowPullMarker,
    powerReadout,
    elevationGauge,
    elevationNeedle,
    elevationValue,
    selectedPieceId: null,
    activeAim: null,
    applicationPoint: null,
    pulses: new Map(),
  };
}

/**
 * 현재 선택을 바꾸고 월드 수평 선택 고리의 표시 여부를 함께 갱신한다.
 */
export function selectAimPiece(
  runtime: AimRuntime,
  pieceId: string | null,
): void {
  runtime.selectedPieceId = pieceId;
  runtime.marker.visible = pieceId !== null;
  if (pieceId === null) {
    cancelAim(runtime, false);
  }
}

/**
 * 선택된 말에서 포인터 기준과 카메라 기준을 고정해 새 조준을 시작한다.
 */
export function beginAim(
  runtime: AimRuntime,
  pieceId: string,
  startX: number,
  startY: number,
  basis: FrozenCameraBasis,
  showsPowerReadout = true,
): void {
  selectAimPiece(runtime, pieceId);
  runtime.activeAim = {
    pieceId,
    startX,
    startY,
    basis,
    direction: basis.forward.clone(),
    normalizedPower: 0,
    showsPowerReadout,
    showsElevationGauge: !showsPowerReadout,
  };
  setAimGuideColor(runtime, new Color(0xffffff));
  setAimGuidesVisible(runtime, true);
  setBowstringVisible(runtime, false);
  runtime.powerReadout.hidden = !showsPowerReadout;
  runtime.powerReadout.textContent = "0%";
  runtime.elevationGauge.hidden = showsPowerReadout;
}

/**
 * 당구식 카메라 방위로 정한 방향을 공유 조준 미리보기 상태에 넣는다.
 */
export function beginDirectedAim(
  runtime: AimRuntime,
  pieceId: string,
  direction: Vector3,
): void {
  const normalizedDirection = direction.clone().normalize();
  const right = normalizedDirection
    .clone()
    .cross(new Vector3(0, 1, 0))
    .normalize();
  beginAim(
    runtime,
    pieceId,
    0,
    0,
    {
      right,
      forward: normalizedDirection,
    },
    false,
  );
}

/**
 * 빨간 점 드래그의 방향과 세기를 경로 색·숫자 피드백에 함께 반영한다.
 */
export function updateDirectedAim(
  runtime: AimRuntime,
  direction: Vector3,
  normalizedPower: number,
): void {
  const activeAim = runtime.activeAim;
  if (activeAim === null) {
    return;
  }
  activeAim.direction.copy(direction).normalize();
  activeAim.normalizedPower = Math.min(
    Math.max(normalizedPower, 0),
    1,
  );
  const color = new Color(0xffffff).lerp(
    new Color(0xff3b30),
    activeAim.normalizedPower,
  );
  if (activeAim.showsPowerReadout) {
    runtime.powerReadout.textContent =
      `${Math.round(activeAim.normalizedPower * 100)}%`;
    runtime.powerReadout.style.color = color.getStyle();
  }
  setAimGuideColor(runtime, color);
  setAimGuidesVisible(runtime, true);
  setBowstringVisible(runtime, activeAim.normalizedPower > 0);
}

/**
 * 화면 드래그의 반대 방향을 고정된 카메라 축으로 월드 발사 방향과 세기로 바꾼다.
 */
export function updateAimPointer(
  runtime: AimRuntime,
  clientX: number,
  clientY: number,
): void {
  const activeAim = runtime.activeAim;
  if (activeAim === null) {
    return;
  }
  const deltaX = clientX - activeAim.startX;
  const deltaY = clientY - activeAim.startY;
  const dragLength = Math.hypot(deltaX, deltaY);
  activeAim.normalizedPower = Math.min(dragLength / MAX_DRAG_PIXELS, 1);

  // 화면 아래로 당기면 백 시점에서는 +z, 흑 시점에서는 -z로 발사되도록 카메라 forward의 부호를 유지한다.
  activeAim.direction
    .copy(activeAim.basis.right)
    .multiplyScalar(-deltaX)
    .addScaledVector(activeAim.basis.forward, deltaY);
  if (activeAim.direction.lengthSq() > 1e-12) {
    activeAim.direction.normalize();
  } else {
    activeAim.direction.copy(activeAim.basis.forward);
  }

  const color = new Color(0xffffff).lerp(
    new Color(0xff3b30),
    activeAim.normalizedPower,
  );
  runtime.powerReadout.textContent =
    `${Math.round(activeAim.normalizedPower * 100)}%`;
  runtime.powerReadout.style.color = color.getStyle();
  setAimGuideColor(runtime, color);
  setAimGuidesVisible(runtime, true);
  setBowstringVisible(runtime, activeAim.normalizedPower > 0);
}

/**
 * 미리보기와 발사 요청이 공유하는 현재 자세의 중심 적용점을 경로 시작점으로 보존한다.
 */
export function setAimApplicationPoint(
  runtime: AimRuntime,
  applicationPoint: Vector3,
): void {
  runtime.applicationPoint = applicationPoint.clone();
  if (runtime.activeAim !== null) {
    setAimGuidesVisible(runtime, true);
  }
}

/**
 * 발사 없이 조준만 정리하고 필요할 때 기존 선택도 함께 해제한다.
 */
export function cancelAim(
  runtime: AimRuntime,
  clearSelection: boolean,
): void {
  runtime.activeAim = null;
  runtime.applicationPoint = null;
  setAimGuidesVisible(runtime, false);
  setBowstringVisible(runtime, false);
  runtime.powerReadout.hidden = true;
  runtime.elevationGauge.hidden = true;
  if (clearSelection) {
    runtime.selectedPieceId = null;
    runtime.marker.visible = false;
  }
}

/**
 * 제거된 말을 선택 또는 조준 중이었다면 남은 입력 상태가 없도록 정리한다.
 */
export function handleAimPieceRemoved(
  runtime: AimRuntime,
  pieceId: string,
): void {
  runtime.pulses.delete(pieceId);
  if (
    runtime.selectedPieceId === pieceId ||
    runtime.activeAim?.pieceId === pieceId
  ) {
    cancelAim(runtime, true);
  }
}

/**
 * 발사한 말의 렌더 메시만 짧게 확대했다 되돌리는 펄스를 시작한다.
 */
export function startLaunchPulse(
  runtime: AimRuntime,
  pieceId: string,
): void {
  const mesh = runtime.sceneRuntime.pieceMeshes.get(pieceId);
  if (mesh === undefined) {
    return;
  }
  runtime.pulses.set(pieceId, {
    mesh,
    startedAt: performance.now(),
  });
}

/**
 * 현재 자세의 AABB와 짧은 탄도로 선택·조준 표시를 갱신하고 렌더 전용 펄스를 진행한다.
 */
export function updateAimVisuals(
  runtime: AimRuntime,
  bindings: ReadonlyMap<string, PieceBodyBinding>,
  now: number,
): void {
  const selectedId = runtime.selectedPieceId;
  if (selectedId !== null) {
    const binding = bindings.get(selectedId);
    const mesh = runtime.sceneRuntime.pieceMeshes.get(selectedId);
    if (binding !== undefined && mesh !== undefined) {
      const bounds = computePieceWorldAabb(binding, mesh);
      const center = bounds.getCenter(new Vector3());
      const markerDiameter = Math.max(
        bounds.max.x - bounds.min.x,
        bounds.max.z - bounds.min.z,
        0.35,
      );
      runtime.marker.position.set(center.x, bounds.min.y + 0.003, center.z);
      runtime.marker.scale.setScalar(markerDiameter / 0.42);
      runtime.marker.visible = true;

      const activeAim = runtime.activeAim;
      if (activeAim !== null && runtime.applicationPoint !== null) {
        if (activeAim.showsElevationGauge) {
          updateElevationGauge(runtime, activeAim.direction);
        }

        const pieceSphere = computePieceWorldBoundingSphere(mesh);
        // 바닥 띠는 고정 길이라 곡선과 무관하게 수평 방향과 말 크기만으로 정해진다.
        const lane = computeGroundLane(activeAim.direction, pieceSphere);
        setGroundRibbonGeometry(
          runtime.groundRibbon.geometry,
          lane.start,
          lane.end,
          lane.forward,
        );
        setGroundChevronTransforms(
          runtime.groundChevrons,
          lane.start,
          lane.end,
          lane.forward,
          GROUND_CHEVRON_FILL_Y,
        );
        setGroundChevronTransforms(
          runtime.faintGroundChevrons,
          lane.start,
          lane.end,
          lane.forward,
          GROUND_CHEVRON_FILL_Y,
        );
        setGroundChevronTransforms(
          runtime.groundChevronOutlines,
          lane.start,
          lane.end,
          lane.forward,
          GROUND_CHEVRON_OUTLINE_Y,
          GROUND_CHEVRON_OUTLINE_SCALE,
        );
        setGroundChevronTransforms(
          runtime.faintGroundChevronOutlines,
          lane.start,
          lane.end,
          lane.forward,
          GROUND_CHEVRON_OUTLINE_Y,
          GROUND_CHEVRON_OUTLINE_SCALE,
        );

        // 공중 띠는 말을 벗어난 지점부터 보드 상면에 닿는 순간까지만 남겨 판 아래 잔상을 없앤다.
        const guideCurve = computeGuideCurve(
          runtime.applicationPoint,
          activeAim.direction,
        );
        const visibleStart = computeGuideVisibleStart(
          runtime.applicationPoint,
          activeAim.direction,
          guideCurve.endTime,
          pieceSphere,
        );
        const clipTime = findGuideBoardClipTime(
          runtime.applicationPoint,
          activeAim.direction,
          guideCurve.endTime,
        );
        const hasElevationArc = clipTime > visibleStart.time;
        runtime.elevationRibbon.visible = hasElevationArc;
        runtime.faintElevationRibbon.visible = hasElevationArc;
        if (hasElevationArc) {
          setElevationRibbonGeometry(
            runtime.elevationRibbon.geometry,
            sampleGuideCurveRange(
              runtime.applicationPoint,
              activeAim.direction,
              visibleStart.time,
              clipTime,
              GUIDE_CURVE_POINT_COUNT,
            ),
            runtime.sceneRuntime.camera,
          );
        }

        const isCharging = activeAim.normalizedPower > 0;
        setBowstringVisible(runtime, isCharging);
        if (isCharging) {
          const sideways = activeAim.direction
            .clone()
            .cross(new Vector3(0, 1, 0));
          if (sideways.lengthSq() < 1e-12) {
            throw new Error("활줄의 좌우 고정 방향을 계산하지 못했습니다.");
          }
          sideways.normalize();
          const firstAnchor = runtime.applicationPoint
            .clone()
            .addScaledVector(sideways, pieceSphere.radius);
          const secondAnchor = runtime.applicationPoint
            .clone()
            .addScaledVector(sideways, -pieceSphere.radius);
          const pullPoint = runtime.applicationPoint
            .clone()
            .addScaledVector(
              activeAim.direction,
              -activeAim.normalizedPower * BOWSTRING_MAX_PULL,
            );
          setBowstringPoints(
            runtime.bowstring,
            firstAnchor,
            pullPoint,
            secondAnchor,
          );
          setBowstringPoints(
            runtime.faintBowstring,
            firstAnchor,
            pullPoint,
            secondAnchor,
          );
          runtime.bowPullMarker.position.copy(pullPoint);
          runtime.faintBowPullMarker.position.copy(pullPoint);
        }
      }
    } else {
      cancelAim(runtime, true);
    }
  }

  for (const [pieceId, pulse] of runtime.pulses) {
    const progress =
      (now - pulse.startedAt) / 1000 / LAUNCH_PULSE_SECONDS;
    if (progress >= 1) {
      pulse.mesh.scale.setScalar(1);
      runtime.pulses.delete(pieceId);
      continue;
    }
    pulse.mesh.scale.setScalar(1 + Math.sin(progress * Math.PI) * 0.06);
  }
}
