import {
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Spherical,
  Vector3,
} from "three";
import { computePieceWorldAabb } from "./aim";
import { CAM_PITCH_MAX, CAM_PITCH_MIN } from "./config";
import type { PieceBodyBinding } from "./physics";
import type { SceneRuntime } from "./scene";
import type { TuningRuntime } from "./tuning";

export interface StrikeSolution {
  // 카메라 피치와 방위에서 파생되어 실제 임펄스가 향하는 정규화 방향이다.
  direction: Vector3;
  // 무게중심과 현재 자세의 시각적 중심 사이에서 정해 빨간 점과 물리가 함께 쓰는 적용점이다.
  applicationPoint: Vector3;
  // 플레이어가 현재 세기로 예상할 수 있도록 표시하는 초기 선속도 변화량이다.
  initialDeltaVelocity: Vector3;
  // 적용점 레버암과 관성에서 계산해 회전 방향을 미리 보여 주는 각속도 변화량이다.
  initialDeltaOmega: Vector3;
  // 별도 조준 상태 없이 카메라 자세에서 직접 파생한 고도다.
  cameraPitchDegrees: number;
  elevationDegrees: number;
}

export interface AimParametersRuntime {
  // 조준 계산이 현재 카메라와 렌더 씬을 단일 원본으로 사용하기 위한 연결이다.
  sceneRuntime: SceneRuntime;
  // 발사 속도와 초기 피치·키 회전 속도를 라이브 조절판과 공유한다.
  tuningRuntime: TuningRuntime;
  // 슬라이더를 대체해 파생값과 실패 원인만 간결하게 보여 주는 상태 영역이다.
  root: HTMLElement;
  feedback: HTMLElement;
  error: HTMLElement;
  // 실제 적용점을 복사해 그리는 깊이 무시 중심 표식이다.
  redDot: Mesh;
  normalizedPower: number;
  currentSolution: StrikeSolution | null;
  // 타점선택 모드에서 사용자가 직접 지정한 타점. null이면 자동 계산 타점을 쓴다.
  strikePointOverride: Vector3 | null;
  // 같은 거절 원인을 매 프레임 콘솔에 반복하지 않도록 마지막 로그만 기억한다.
  lastLoggedError: string | null;
}

// 작은 월드 점은 화면에서 24픽셀 히트 영역을 따로 제공해도 시각적으로 정밀한 타점을 유지한다.
const RED_DOT_GEOMETRY = new SphereGeometry(0.028, 20, 12);

/**
 * 월드 역관성에 각임펄스를 곱해 발사 직후 각속도 변화를 예측한다.
 */
function multiplyWorldInverseInertia(
  binding: PieceBodyBinding,
  angularImpulse: Vector3,
): Vector3 {
  const inverseInertia = binding.body.effectiveWorldInvInertia();
  return new Vector3(
    inverseInertia.m11 * angularImpulse.x +
      inverseInertia.m12 * angularImpulse.y +
      inverseInertia.m13 * angularImpulse.z,
    inverseInertia.m21 * angularImpulse.x +
      inverseInertia.m22 * angularImpulse.y +
      inverseInertia.m23 * angularImpulse.z,
    inverseInertia.m31 * angularImpulse.x +
      inverseInertia.m32 * angularImpulse.y +
      inverseInertia.m33 * angularImpulse.z,
  );
}

/**
 * 현재 공전 오프셋에서 카메라 피치를 구해 설계 범위 안의 조준값으로 제한한다.
 */
export function getCameraAimPitchDegrees(
  runtime: AimParametersRuntime,
): number {
  const offset = runtime.sceneRuntime.camera.position
    .clone()
    .sub(runtime.sceneRuntime.controls.target);
  const spherical = new Spherical().setFromVector3(offset);
  const pitch = 90 - MathUtils.radToDeg(spherical.phi);
  return MathUtils.clamp(pitch, CAM_PITCH_MIN, CAM_PITCH_MAX);
}

/**
 * 현재 강체 자세에서 무게중심과 월드 AABB 중심을 잇는 고정 타격점을 계산한다.
 */
export function computeStrikeApplicationPoint(
  binding: PieceBodyBinding,
  mesh: Mesh,
  strikeHeightRatio: number,
): Vector3 {
  const bounds = computePieceWorldAabb(binding, mesh);
  const visualCenter = bounds.getCenter(new Vector3());
  const worldCom = binding.body.worldCom();
  return new Vector3(worldCom.x, worldCom.y, worldCom.z).lerp(
    visualCenter,
    strikeHeightRatio,
  );
}

/**
 * 타점 UI를 허용한 모드만 사용자 override를 쓰고 클래식은 항상 기본 높이점을 복사한다.
 */
export function resolveStrikeApplicationPoint(
  allowOverride: boolean,
  automaticPoint: Vector3,
  overridePoint: Vector3 | null,
): Vector3 {
  return allowOverride && overridePoint !== null
    ? overridePoint.clone()
    : automaticPoint.clone();
}

/**
 * 카메라 피치와 고정 중심 타격점을 하나의 계산으로 방향·적용점·예상 속도에 변환한다.
 */
export function computeStrikeSolution(
  runtime: AimParametersRuntime,
  binding: PieceBodyBinding,
  mesh: Mesh,
  horizontalDirection: Vector3,
  normalizedPower: number,
): StrikeSolution {
  const horizontal = horizontalDirection.clone();
  horizontal.y = 0;
  if (horizontal.lengthSq() < 1e-12) {
    throw new Error("당구식 수평 발사 방위가 유효하지 않습니다.");
  }
  horizontal.normalize();

  const cameraPitchDegrees = getCameraAimPitchDegrees(runtime);
  const pitchRatio = MathUtils.clamp(
    (cameraPitchDegrees - CAM_PITCH_MIN) /
      (CAM_PITCH_MAX - CAM_PITCH_MIN),
    0,
    1,
  );
  const elevationDegrees = 60 - 120 * pitchRatio;
  const elevation = MathUtils.degToRad(elevationDegrees);
  const direction = horizontal
    .clone()
    .multiplyScalar(Math.cos(elevation))
    .addScaledVector(new Vector3(0, 1, 0), Math.sin(elevation))
    .normalize();

  const worldCom = binding.body.worldCom();
  const applicationPoint = resolveStrikeApplicationPoint(
    true,
    computeStrikeApplicationPoint(
      binding,
      mesh,
      runtime.tuningRuntime.settings.strikeHeightRatio,
    ),
    runtime.strikePointOverride,
  );
  const initialSpeed =
    MathUtils.clamp(normalizedPower, 0, 1) *
    runtime.tuningRuntime.settings.maxLaunchSpeed;
  const initialDeltaVelocity = direction
    .clone()
    .multiplyScalar(initialSpeed);
  const impulse = direction
    .clone()
    .multiplyScalar(binding.body.mass() * initialSpeed);
  const leverArm = applicationPoint
    .clone()
    .sub(new Vector3(worldCom.x, worldCom.y, worldCom.z));
  const initialDeltaOmega = multiplyWorldInverseInertia(
    binding,
    leverArm.cross(impulse),
  );
  return {
    direction,
    applicationPoint,
    initialDeltaVelocity,
    initialDeltaOmega,
    cameraPitchDegrees,
    elevationDegrees,
  };
}

/**
 * 퍼센트 슬라이더 없이 현재 카메라 조준 결과와 실패 이유만 보여 주는 HUD를 만든다.
 */
export function createAimParametersRuntime(
  container: HTMLElement,
  tuningRuntime: TuningRuntime,
  sceneRuntime: SceneRuntime,
): AimParametersRuntime {
  const root = document.createElement("section");
  root.className = "aim-parameters";
  root.hidden = true;
  const feedback = document.createElement("pre");
  feedback.className = "strike-feedback";
  const error = document.createElement("p");
  error.className = "aim-error";
  error.hidden = true;
  root.append(feedback, error);
  container.append(root);

  const redDot = new Mesh(
    RED_DOT_GEOMETRY,
    new MeshBasicMaterial({
      color: 0xff2d2d,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 1,
    }),
  );
  redDot.name = "StrikePoint";
  redDot.renderOrder = 30;
  redDot.visible = false;
  sceneRuntime.scene.add(redDot);

  return {
    sceneRuntime,
    tuningRuntime,
    root,
    feedback,
    error,
    redDot,
    normalizedPower: 0,
    currentSolution: null,
    strikePointOverride: null,
    lastLoggedError: null,
  };
}

/**
 * 선택 상태에서 파생 조준값을 계산하고 같은 적용점을 빨간 점과 발사 요청에 공유한다.
 */
export function updateStrikePreview(
  runtime: AimParametersRuntime,
  binding: PieceBodyBinding,
  mesh: Mesh,
  horizontalDirection: Vector3,
): StrikeSolution {
  const solution = computeStrikeSolution(
    runtime,
    binding,
    mesh,
    horizontalDirection,
    runtime.normalizedPower,
  );
  runtime.currentSolution = solution;
  runtime.redDot.position.copy(solution.applicationPoint);
  runtime.redDot.visible = true;
  runtime.root.hidden = false;
  runtime.error.hidden = true;
  const velocity = solution.initialDeltaVelocity;
  const omega = solution.initialDeltaOmega;
  runtime.feedback.textContent = [
    `세기 ${Math.round(runtime.normalizedPower * 100)}% · 피치 ${solution.cameraPitchDegrees.toFixed(1)}°`,
    `고도 ${solution.elevationDegrees.toFixed(1)}°`,
    `Δv (${velocity.x.toFixed(2)}, ${velocity.y.toFixed(2)}, ${velocity.z.toFixed(2)})`,
    `Δω (${omega.x.toFixed(2)}, ${omega.y.toFixed(2)}, ${omega.z.toFixed(2)})`,
  ].join("\n");
  return solution;
}

/**
 * 아래 방향 드래그에서 얻은 세기를 다음 미리보기와 발사 계산이 공유하도록 제한한다.
 */
export function setAimPower(
  runtime: AimParametersRuntime,
  normalizedPower: number,
): void {
  runtime.normalizedPower = MathUtils.clamp(normalizedPower, 0, 1);
  if (runtime.redDot.visible) {
    runtime.redDot.scale.setScalar(1 + runtime.normalizedPower * 2);
    const material = runtime.redDot.material as MeshBasicMaterial;
    material.color.setRGB(1, 1 - runtime.normalizedPower, 1 - runtime.normalizedPower);
  }
}

/**
 * 선택 해제나 취소 때 빨간 점과 계산 캐시를 함께 숨기되 오류 문구는 별도 호출로 표시할 수 있게 한다.
 */
export function clearStrikePreview(
  runtime: AimParametersRuntime,
): void {
  runtime.currentSolution = null;
  runtime.normalizedPower = 0;
  runtime.redDot.scale.setScalar(1);
  (runtime.redDot.material as MeshBasicMaterial).color.setHex(0xff2d2d);
  runtime.redDot.visible = false;
  runtime.root.hidden = true;
  runtime.error.hidden = true;
  runtime.lastLoggedError = null;
}

/**
 * 발사 큐 거절이나 조준 계산 실패를 화면과 콘솔에 같은 원문으로 남긴다.
 */
export function showAimError(
  runtime: AimParametersRuntime,
  reason: string,
): void {
  runtime.root.hidden = false;
  runtime.error.hidden = false;
  runtime.error.textContent = reason;
  if (runtime.lastLoggedError !== reason) {
    console.error(`[조준] ${reason}`);
    runtime.lastLoggedError = reason;
  }
}

/**
 * 작은 월드 점을 모바일에서도 누를 수 있도록 화면 투영 중심에 최소 반경을 적용한다.
 */
export function isRedDotHit(
  runtime: AimParametersRuntime,
  clientX: number,
  clientY: number,
  radiusPixels = 24,
): boolean {
  if (!runtime.redDot.visible || runtime.currentSolution === null) {
    return false;
  }
  const rect =
    runtime.sceneRuntime.renderer.domElement.getBoundingClientRect();
  const projected = runtime.redDot.position
    .clone()
    .project(runtime.sceneRuntime.camera);
  const screenX = rect.left + ((projected.x + 1) / 2) * rect.width;
  const screenY = rect.top + ((1 - projected.y) / 2) * rect.height;
  return Math.hypot(clientX - screenX, clientY - screenY) <= radiusPixels;
}
/**
 * 사용자가 직접 지정한 타점을 저장한다.
 */
export function setStrikePointOverride(
  runtime: AimParametersRuntime,
  point: Vector3,
): void {
  runtime.strikePointOverride = point.clone();
}

/**
 * 사용자 지정 타점을 해제하고 자동 계산으로 되돌린다.
 */
export function clearStrikePointOverride(
  runtime: AimParametersRuntime,
): void {
  runtime.strikePointOverride = null;
}
