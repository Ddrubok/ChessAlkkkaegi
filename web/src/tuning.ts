import type {
  PhysicsRuntime,
  PieceBodyBinding,
} from "./physics";
import {
  CAM_INITIAL_AIM_PITCH_DEG,
  CAM_KEY_DEG_PER_SEC,
  CARD_EFFECT_SCALE,
  ENEMY_STAGE_BUFF_SCALE,
  MAX_LAUNCH_SPEED,
  PIECE_ANGULAR_DAMPING,
  PIECE_FRICTION,
  PIECE_LINEAR_DAMPING,
  PIECE_RESTITUTION,
  STRIKE_HEIGHT_RATIO,
  TIME_SCALE,
} from "./config";
import type { GameMode } from "./game-mode";
import type { PawnTier } from "./stage";

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
  // 다음 보드 설정부터 흑 중량·힘·크기 단계값에 공통 적용할 배율이다.
  enemyStageBuffScale: number;
  // 다음 보드 설정부터 백 크기·중량·힘 카드 효과에 공통 적용할 배율이다.
  cardEffectScale: number;
}

export type TuningKey = keyof RuntimeTuningSettings;

type TuningAppliedValueKey =
  | "stage"
  | "enemyWeight"
  | "enemyForce"
  | "enemySize"
  | "enemyPawnTier"
  | "playerWeight"
  | "playerForce"
  | "playerSize";

export interface TuningAppliedValues {
  // 현재 보드가 실제로 사용하는 대전 모드다.
  gameMode: GameMode;
  // 스테이지 모드에서 현재 보드가 실제로 사용하는 단계다.
  stageNumber: number;
  // 현재 흑 말에 적용된 원래 hull 질량 대비 가산 비율이다.
  enemyWeightFraction: number;
  // 현재 흑 중량 비율을 만든 누적 단계 수다.
  enemyWeightSteps: number;
  // 현재 흑 AI 발사 속도에 적용된 가산 비율이다.
  enemyForceFraction: number;
  // 현재 흑 힘 비율을 만든 누적 단계 수다.
  enemyForceSteps: number;
  // 현재 흑 말의 일반 크기에 적용된 가산 비율이다.
  enemySizeFraction: number;
  // 현재 흑 일반 크기 비율을 만든 누적 단계 수다.
  enemySizeSteps: number;
  // 현재 흑 폰에 적용된 크기 치환 티어다.
  enemyPawnTier: PawnTier;
  // 말 종류별 카드·영구 강화가 합성된 현재 백 중량 가산 비율들이다.
  playerWeightFractions: readonly number[];
  // 말 종류별 카드·영구 강화가 합성된 현재 백 힘 가산 비율들이다.
  playerForceFractions: readonly number[];
  // 현재 백 일반 말에 적용된 크기 가산 비율이다.
  playerSizeFraction: number;
  // 현재 백 일반 크기가 PLAYER_MAX_SIZE_SCALE 상한에 닿았는지 나타낸다.
  playerSizeAtCap: boolean;
}

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
  // 실제 보드 적용값만 갱신하는 읽기 전용 출력 요소들이다.
  appliedValueElements: Map<TuningAppliedValueKey, HTMLElement>;
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
  enemyStageBuffScale: ENEMY_STAGE_BUFF_SCALE,
  cardEffectScale: CARD_EFFECT_SCALE,
};

/**
 * 게임과 헤드리스 도구가 같은 기본 조절값을 값 복사로 받도록 공개한다.
 */
export function createDefaultRuntimeTuningSettings(): RuntimeTuningSettings {
  return { ...DEFAULT_SETTINGS };
}

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
  enemyStageBuffScale: {
    label: "상대 강화 배율 · 다음 보드",
    min: 0,
    max: 3,
    step: 0.05,
    displayScale: 1,
    suffix: "×",
  },
  cardEffectScale: {
    label: "카드 효과 배율 · 다음 보드",
    min: 0,
    max: 3,
    step: 0.05,
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
 * 조절판 밑동 추와 스테이지·카드·영구 강화 추가 질량을 한 번에 적용한다.
 */
export function applyComposedWeightToBinding(
  binding: PieceBodyBinding,
  baseWeightMultiplier: number,
): void {
  if (
    !Number.isFinite(baseWeightMultiplier) ||
    baseWeightMultiplier < 0
  ) {
    throw new Error(
      `밑동 추 배수 ${baseWeightMultiplier}가 유한한 음이 아닌 수가 아닙니다.`,
    );
  }
  const additionalMass =
    binding.originalHullMass * baseWeightMultiplier +
    binding.upgradeAdditionalMass;
  binding.body.setAdditionalMassProperties(
    additionalMass,
    { x: 0, y: binding.localPieceHeight * 0.06, z: 0 },
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 0, w: 1 },
    false,
  );
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
      applyComposedWeightToBinding(
        binding,
        settings.baseWeightMultiplier,
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
 * 재생성된 말 바디에 현재 조절판의 물리값을 다시 적용해 화면 값과 실제 값을 보존한다.
 */
export function reapplyTuningPhysicsSettings(
  runtime: TuningRuntime,
): void {
  for (const key of [
    "friction",
    "restitution",
    "linearDamping",
    "angularDamping",
    "baseWeightMultiplier",
  ] as const) {
    applyPhysicsSetting(runtime, key);
  }
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
    const multiplier =
      settings.baseWeightMultiplier +
      binding.upgradeAdditionalMass / binding.originalHullMass;
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
 * 가산 비율을 불필요한 소수점 없이 읽기 쉬운 백분율로 바꾼다.
 */
function formatPercent(fraction: number): string {
  const percentage = (fraction * 100).toFixed(2);
  const trimmed = percentage
    .replace(/\.00$/, "")
    .replace(/(\.\d)0$/, "$1");
  return `+${trimmed}%`;
}

/**
 * 말 종류별 값이 다르면 최솟값과 최댓값을 모두 보여 숨은 종류별 차이를 드러낸다.
 */
function formatPercentRange(fractions: readonly number[]): string {
  if (fractions.length === 0) {
    return "+0%";
  }
  const minimum = Math.min(...fractions);
  const maximum = Math.max(...fractions);
  if (Math.abs(maximum - minimum) < 1e-9) {
    return formatPercent(minimum);
  }
  return `${formatPercent(minimum)}~${formatPercent(maximum)} (말 종류별)`;
}

/**
 * 실제 보드 설정이 성공한 시점의 성장값만 읽기 전용 그룹에 반영한다.
 */
export function updateTuningAppliedValues(
  runtime: TuningRuntime,
  values: TuningAppliedValues,
): void {
  const setText = (
    key: TuningAppliedValueKey,
    text: string,
  ): void => {
    const element = runtime.appliedValueElements.get(key);
    if (element === undefined) {
      throw new Error(`현재 적용값 출력 ${key}를 찾지 못했습니다.`);
    }
    element.textContent = text;
  };
  if (values.gameMode !== "stage") {
    for (const key of runtime.appliedValueElements.keys()) {
      setText(key, "해당 없음");
    }
    return;
  }
  const tierLabel: Record<PawnTier, string> = {
    none: "기본",
    rook: "룩",
    king: "킹",
  };
  setText("stage", String(values.stageNumber));
  setText(
    "enemyWeight",
    `${formatPercent(values.enemyWeightFraction)} (${values.enemyWeightSteps}단계)`,
  );
  setText(
    "enemyForce",
    `${formatPercent(values.enemyForceFraction)} (${values.enemyForceSteps}단계)`,
  );
  setText(
    "enemySize",
    `${formatPercent(values.enemySizeFraction)} (${values.enemySizeSteps}단계)`,
  );
  setText("enemyPawnTier", tierLabel[values.enemyPawnTier]);
  setText(
    "playerWeight",
    formatPercentRange(values.playerWeightFractions),
  );
  setText(
    "playerForce",
    formatPercentRange(values.playerForceFractions),
  );
  setText(
    "playerSize",
    `${formatPercent(values.playerSizeFraction)}${values.playerSizeAtCap ? " (상한 도달)" : ""}`,
  );
}

/**
 * 슬라이더와 섞이지 않는 실제 보드 적용값 행을 한 그룹으로 만든다.
 */
function appendAppliedValuesGroup(runtime: TuningRuntime): void {
  const fieldset = document.createElement("fieldset");
  const legend = document.createElement("legend");
  legend.textContent = "현재 적용값";
  const list = document.createElement("dl");
  list.className = "tuning-readout";
  const definitions: ReadonlyArray<{
    key: TuningAppliedValueKey;
    label: string;
  }> = [
    { key: "stage", label: "현재 스테이지" },
    { key: "enemyWeight", label: "흑 중량" },
    { key: "enemyForce", label: "흑 힘" },
    { key: "enemySize", label: "흑 크기" },
    { key: "enemyPawnTier", label: "흑 폰 크기 티어" },
    { key: "playerWeight", label: "백 중량" },
    { key: "playerForce", label: "백 힘" },
    { key: "playerSize", label: "백 크기" },
  ];
  for (const definition of definitions) {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const value = document.createElement("dd");
    term.textContent = definition.label;
    value.textContent = "해당 없음";
    row.append(term, value);
    list.append(row);
    runtime.appliedValueElements.set(definition.key, value);
  }
  fieldset.append(legend, list);
  runtime.panel.append(fieldset);
}

/**
 * 실제 적용값과 설정 그룹, 깨우기·초기화 동작을 가진 접이식 라이브 조절판을 만든다.
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
    settings: createDefaultRuntimeTuningSettings(),
    panel,
    controls: new Map(),
    appliedValueElements: new Map(),
    pendingPhysicsVerification: false,
    wakeAllHandler: null,
  };
  appendAppliedValuesGroup(runtime);
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
    {
      title: "성장 배율 · 다음 보드 설정부터 적용",
      keys: ["enemyStageBuffScale", "cardEffectScale"],
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
    "상대 강화·카드 효과 배율은 다음 스테이지, 다시 시작 또는 모드 전환 때 적용됩니다. 현재 적용값은 지금 보드의 값만 표시합니다. 그 밖의 질량과 물리 setter 값은 다음 fixed step에서 검증됩니다.";
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
