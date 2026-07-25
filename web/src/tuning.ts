import type { PhysicsRuntime } from "./physics";
import {
  CAM_INITIAL_AIM_PITCH_DEG,
  CAM_KEY_DEG_PER_SEC,
  MAX_LAUNCH_SPEED,
  PIECE_ANGULAR_DAMPING,
  PIECE_FRICTION,
  PIECE_LINEAR_DAMPING,
  PIECE_RESTITUTION,
  STRIKE_HEIGHT_RATIO,
  TIME_SCALE,
} from "./config";

export interface RuntimeTuningSettings {
  timeScale: number;
  maxLaunchSpeed: number;
  friction: number;
  restitution: number;
  linearDamping: number;
  angularDamping: number;
  baseWeightMultiplier: number;
  initialAimPitch: number;
  cameraKeyDegreesPerSecond: number;
  // 무게중심과 시각적 중심을 잇는 적용점 비율을 다음 미리보기와 발사에 즉시 제공한다.
  strikeHeightRatio: number;
}

export type TuningKey = keyof RuntimeTuningSettings;

interface TuningDefinition {
  label: string;
  min: number;
  max: number;
  step: number;
  // 백분율 입력을 내부 0~1 값으로 변환하기 위한 화면 배율이다.
  displayScale: number;
  suffix: string;
}

export interface TuningRuntime {
  // setter를 재생성 없이 모든 현존 바디와 콜라이더에 적용하기 위한 물리 연결이다.
  physicsRuntime: PhysicsRuntime;
  // 루프·발사·조준이 즉시 읽는 런타임 숫자의 단일 원본이다.
  settings: RuntimeTuningSettings;
  // T 키와 쿼리 문자열로 노출을 바꾸는 조절판 컨테이너다.
  panel: HTMLElement;
  // 같은 값을 보여 주는 슬라이더·출력·숫자 입력을 함께 갱신한다.
  controls: Map<TuningKey, Set<HTMLElement>>;
  // Rapier가 다음 step에서 setter를 반영한 뒤 한 번 검증하도록 예약한다.
  pendingPhysicsVerification: boolean;
  // 조절판이 턴 상태를 직접 알지 않고 기존 전체 깨우기 동작을 호출한다.
  wakeAllHandler: (() => void) | null;
}

// 물리 상수는 재현 가능한 초기화 원본으로 남기고 변경값은 런타임 객체에만 저장한다.
const DEFAULT_SETTINGS: RuntimeTuningSettings = {
  timeScale: TIME_SCALE,
  maxLaunchSpeed: MAX_LAUNCH_SPEED,
  friction: PIECE_FRICTION,
  restitution: PIECE_RESTITUTION,
  linearDamping: PIECE_LINEAR_DAMPING,
  angularDamping: PIECE_ANGULAR_DAMPING,
  baseWeightMultiplier: 0,
  initialAimPitch: CAM_INITIAL_AIM_PITCH_DEG,
  cameraKeyDegreesPerSecond: CAM_KEY_DEG_PER_SEC,
  strikeHeightRatio: STRIKE_HEIGHT_RATIO,
};

// 화면 범위와 내부 단위 변환을 한 표로 고정해 세 UI 표현이 어긋나지 않게 한다.
const DEFINITIONS: Record<TuningKey, TuningDefinition> = {
  timeScale: {
    label: "시간 배속",
    min: 0.5,
    max: 4,
    step: 0.001,
    displayScale: 1,
    suffix: "×",
  },
  maxLaunchSpeed: {
    label: "최대 발사 속도",
    min: 2,
    max: 25,
    step: 0.1,
    displayScale: 1,
    suffix: "",
  },
  friction: {
    label: "마찰",
    min: 0.05,
    max: 1.5,
    step: 0.01,
    displayScale: 1,
    suffix: "",
  },
  restitution: {
    label: "반발",
    min: 0,
    max: 0.6,
    step: 0.01,
    displayScale: 1,
    suffix: "",
  },
  linearDamping: {
    label: "선형 감쇠",
    min: 0,
    max: 4,
    step: 0.05,
    displayScale: 1,
    suffix: "",
  },
  angularDamping: {
    label: "회전 감쇠",
    min: 0,
    max: 8,
    step: 0.05,
    displayScale: 1,
    suffix: "",
  },
  baseWeightMultiplier: {
    label: "밑동 추 배수",
    min: 0,
    max: 3,
    step: 0.05,
    displayScale: 1,
    suffix: "×",
  },
  initialAimPitch: {
    label: "초기 조준 피치",
    min: 3,
    max: 85,
    step: 1,
    displayScale: 1,
    suffix: "°",
  },
  cameraKeyDegreesPerSecond: {
    label: "WASD 회전 속도",
    min: 15,
    max: 180,
    step: 1,
    displayScale: 1,
    suffix: "°/s",
  },
  strikeHeightRatio: {
    label: "초기 타격 토크: 0=없음, 1=시각 중심, 2=2배",
    min: 0,
    max: 2,
    step: 0.01,
    displayScale: 1,
    suffix: "×",
  },
};

/**
 * 설정 범위를 벗어난 직접 입력을 안전한 런타임 범위로 제한한다.
 */
function clampSetting(key: TuningKey, value: number): number {
  const definition = DEFINITIONS[key];
  return Math.min(Math.max(value, definition.min), definition.max);
}

/**
 * 현재 설정을 Rapier setter에 적용하되 잠든 바디는 의도적으로 깨우지 않는다.
 */
function applyPhysicsSetting(
  runtime: TuningRuntime,
  key: TuningKey,
): void {
  const { physicsRuntime, settings } = runtime;
  if (key === "friction") {
    physicsRuntime.boardCollider.setFriction(settings.friction);
    for (const binding of physicsRuntime.pieces.values()) {
      binding.collider.setFriction(settings.friction);
    }
  } else if (key === "restitution") {
    physicsRuntime.boardCollider.setRestitution(settings.restitution);
    for (const binding of physicsRuntime.pieces.values()) {
      binding.collider.setRestitution(settings.restitution);
    }
  } else if (key === "linearDamping") {
    for (const binding of physicsRuntime.pieces.values()) {
      binding.body.setLinearDamping(settings.linearDamping);
    }
  } else if (key === "angularDamping") {
    for (const binding of physicsRuntime.pieces.values()) {
      binding.body.setAngularDamping(settings.angularDamping);
    }
  } else if (key === "baseWeightMultiplier") {
    for (const binding of physicsRuntime.pieces.values()) {
      const additionalMass =
        binding.originalHullMass * settings.baseWeightMultiplier;
      binding.body.setAdditionalMassProperties(
        additionalMass,
        { x: 0, y: binding.localPieceHeight * 0.06, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0, w: 1 },
        false,
      );
    }
  } else {
    return;
  }
  runtime.pendingPhysicsVerification = true;
}

/**
 * 한 설정값을 갱신하고 연결된 모든 UI와 물리 setter에 반영한다.
 */
export function setTuningValue(
  runtime: TuningRuntime,
  key: TuningKey,
  value: number,
): void {
  if (!Number.isFinite(value)) {
    return;
  }
  const clamped = clampSetting(key, value);
  runtime.settings[key] = clamped;
  const definition = DEFINITIONS[key];
  for (const element of runtime.controls.get(key) ?? []) {
    if (element instanceof HTMLInputElement) {
      element.value = String(clamped * definition.displayScale);
    } else if (element instanceof HTMLOutputElement) {
      element.value =
        `${(clamped * definition.displayScale).toFixed(definition.step < 0.01 ? 3 : definition.step < 1 ? 2 : 0)}${definition.suffix}`;
    }
  }
  applyPhysicsSetting(runtime, key);
}

/**
 * 조준 HUD처럼 패널 밖의 UI도 같은 런타임 설정을 양방향으로 공유하게 한다.
 */
export function registerTuningControl(
  runtime: TuningRuntime,
  key: TuningKey,
  element: HTMLElement,
): void {
  let elements = runtime.controls.get(key);
  if (elements === undefined) {
    elements = new Set();
    runtime.controls.set(key, elements);
  }
  elements.add(element);
  const definition = DEFINITIONS[key];
  if (element instanceof HTMLInputElement) {
    element.value =
      String(runtime.settings[key] * definition.displayScale);
    element.addEventListener("input", () => {
      setTuningValue(
        runtime,
        key,
        Number(element.value) / definition.displayScale,
      );
    });
  } else if (element instanceof HTMLOutputElement) {
    setTuningValue(runtime, key, runtime.settings[key]);
  }
}

/**
 * 다음 fixed step에서 Rapier getter가 라이브 setter와 목표 합성 질량을 반영했는지 검증한다.
 */
export function verifyTuningAfterStep(runtime: TuningRuntime): void {
  if (!runtime.pendingPhysicsVerification) {
    return;
  }
  const tolerance = 1e-5;
  const settings = runtime.settings;
  const checkClose = (
    actual: number,
    expected: number,
    label: string,
  ): void => {
    if (
      !Number.isFinite(actual) ||
      Math.abs(actual - expected) >
        tolerance * Math.max(1, Math.abs(expected))
    ) {
      throw new Error(
        `${label} 적용 검증 실패: actual=${actual}, expected=${expected}`,
      );
    }
  };
  checkClose(
    runtime.physicsRuntime.boardCollider.friction(),
    settings.friction,
    "보드 마찰",
  );
  checkClose(
    runtime.physicsRuntime.boardCollider.restitution(),
    settings.restitution,
    "보드 반발",
  );
  for (const binding of runtime.physicsRuntime.pieces.values()) {
    checkClose(
      binding.collider.friction(),
      settings.friction,
      `${binding.instance.id} 마찰`,
    );
    checkClose(
      binding.collider.restitution(),
      settings.restitution,
      `${binding.instance.id} 반발`,
    );
    checkClose(
      binding.body.linearDamping(),
      settings.linearDamping,
      `${binding.instance.id} 선형 감쇠`,
    );
    checkClose(
      binding.body.angularDamping(),
      settings.angularDamping,
      `${binding.instance.id} 회전 감쇠`,
    );
    const multiplier = settings.baseWeightMultiplier;
    const expectedMass = binding.originalHullMass * (1 + multiplier);
    const weightY = binding.localPieceHeight * 0.06;
    const expectedCom = {
      x: binding.originalLocalCom.x / (1 + multiplier),
      y:
        (binding.originalLocalCom.y + multiplier * weightY) /
        (1 + multiplier),
      z: binding.originalLocalCom.z / (1 + multiplier),
    };
    const actualCom = binding.body.localCom();
    checkClose(
      binding.body.mass(),
      expectedMass,
      `${binding.instance.id} 합성 질량`,
    );
    checkClose(actualCom.x, expectedCom.x, `${binding.instance.id} COM x`);
    checkClose(actualCom.y, expectedCom.y, `${binding.instance.id} COM y`);
    checkClose(actualCom.z, expectedCom.z, `${binding.instance.id} COM z`);
  }
  runtime.pendingPhysicsVerification = false;
  console.info("[조절판] 다음 fixed step getter 검증을 통과했습니다.");
}

/**
 * 슬라이더·출력·직접 입력을 한 행에 묶어 동일한 설정값에 연결한다.
 */
function appendControl(
  runtime: TuningRuntime,
  parent: HTMLElement,
  key: TuningKey,
): void {
  const definition = DEFINITIONS[key];
  const row = document.createElement("label");
  row.className = "tuning-control";
  const label = document.createElement("span");
  label.textContent = definition.label;
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = String(definition.min * definition.displayScale);
  slider.max = String(definition.max * definition.displayScale);
  slider.step = String(definition.step * definition.displayScale);
  const output = document.createElement("output");
  const numeric = document.createElement("input");
  numeric.type = "number";
  numeric.min = slider.min;
  numeric.max = slider.max;
  numeric.step = slider.step;
  row.append(label, slider, output, numeric);
  parent.append(row);
  registerTuningControl(runtime, key, slider);
  registerTuningControl(runtime, key, output);
  registerTuningControl(runtime, key, numeric);
}

/**
 * 여덟 설정 그룹과 깨우기·초기화 동작을 가진 접이식 라이브 조절판을 만든다.
 */
export function createTuningRuntime(
  container: HTMLElement,
  physicsRuntime: PhysicsRuntime,
): TuningRuntime {
  const panel = document.createElement("aside");
  panel.className = "tuning-panel";
  panel.hidden =
    new URLSearchParams(window.location.search).get("tune") !== "1";
  panel.innerHTML = "<h2>손맛 조절판</h2>";
  container.append(panel);
  const runtime: TuningRuntime = {
    physicsRuntime,
    settings: { ...DEFAULT_SETTINGS },
    panel,
    controls: new Map(),
    pendingPhysicsVerification: false,
    wakeAllHandler: null,
  };
  const groups: Array<{
    title: string;
    keys: TuningKey[];
  }> = [
    { title: "시간", keys: ["timeScale"] },
    {
      title: "발사",
      keys: ["maxLaunchSpeed", "strikeHeightRatio"],
    },
    { title: "마찰", keys: ["friction"] },
    { title: "반발", keys: ["restitution"] },
    { title: "선형 감쇠", keys: ["linearDamping"] },
    { title: "회전 감쇠", keys: ["angularDamping"] },
    { title: "밑동 추", keys: ["baseWeightMultiplier"] },
    {
      title: "시점 조준",
      keys: ["initialAimPitch", "cameraKeyDegreesPerSecond"],
    },
  ];
  for (const group of groups) {
    const fieldset = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = group.title;
    fieldset.append(legend);
    for (const key of group.keys) {
      appendControl(runtime, fieldset, key);
    }
    panel.append(fieldset);
  }
  const note = document.createElement("p");
  note.className = "tuning-note";
  note.textContent =
    "질량과 물리 setter 값은 다음 fixed step에서 검증됩니다. 변경만으로 잠든 말은 깨어나지 않습니다.";
  const actions = document.createElement("div");
  actions.className = "tuning-actions";
  const wakeButton = document.createElement("button");
  wakeButton.type = "button";
  wakeButton.textContent = "값 적용 후 전체 깨우기";
  wakeButton.addEventListener("click", () => runtime.wakeAllHandler?.());
  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.textContent = "초기화";
  resetButton.addEventListener("click", () => {
    for (const key of Object.keys(DEFAULT_SETTINGS) as TuningKey[]) {
      setTuningValue(runtime, key, DEFAULT_SETTINGS[key]);
    }
  });
  actions.append(wakeButton, resetButton);
  panel.append(note, actions);
  window.addEventListener("keydown", (event) => {
    const target = event.target;
    if (
      event.code === "KeyT" &&
      !event.repeat &&
      !(target instanceof HTMLInputElement)
    ) {
      panel.hidden = !panel.hidden;
    }
  });
  return runtime;
}
