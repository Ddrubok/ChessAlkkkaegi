import {
  SOUND_BGM_VOLUME,
  SOUND_HIT_GLOBAL_COOLDOWN_MS,
  SOUND_HIT_MIN_RELATIVE_SPEED,
  SOUND_HIT_PAIR_COOLDOWN_MS,
  SOUND_SFX_VOLUME,
} from "./config";
import type { PhysicsRuntime } from "./physics";

type SoundEffectId =
  | "button"
  | "hit"
  | "wood"
  | "rock"
  | "iron"
  | "power10"
  | "power50"
  | "power90";

type CollisionSoundEffectId =
  | "hit"
  | "wood"
  | "rock"
  | "iron";

interface PowerThresholdState {
  // 10%를 아래에서 위로 지날 때 다시 한 번 재생할 수 있는지 나타낸다.
  power10Armed: boolean;
  // 50%를 아래에서 위로 지날 때 다시 한 번 재생할 수 있는지 나타낸다.
  power50Armed: boolean;
  // 90%를 아래에서 위로 지날 때 다시 한 번 재생할 수 있는지 나타낸다.
  power90Armed: boolean;
}

interface PieceHitSoundState {
  // 직전 fixed step에서 실제 solver contact 중이던 말·표면 쌍 키다.
  touchingPairs: Set<string>;
  // 같은 쌍의 빠른 재접촉음을 제한하는 마지막 재생 실제 시각이다.
  lastPlayedAtByPair: Map<string, number>;
  // 여러 쌍의 동시 충돌음을 하나로 제한하는 마지막 전체 재생 실제 시각이다.
  lastGlobalPlayAt: number;
}

interface SoundRuntime {
  // 저지연 효과음을 디코딩하고 재생하는 브라우저 오디오 컨텍스트다.
  context: AudioContext;
  // 화면 전환과 무관하게 하나만 유지하는 반복 배경음 요소다.
  bgm: HTMLAudioElement;
  // 파일별 디코딩이 끝난 효과음 버퍼다.
  buffers: Map<SoundEffectId, AudioBuffer>;
  // 첫 사용자 입력 뒤 자동재생 잠금 해제를 중복 실행하지 않는 상태다.
  unlocked: boolean;
  // 같은 첫 입력에서 BGM과 버튼음을 순서대로 잇기 위해 진행 중인 잠금 해제 작업을 공유한다.
  unlockPromise: Promise<void> | null;
  // 개별 파일 로딩 실패를 한 번만 알리기 위한 경고 키 집합이다.
  warningKeys: Set<string>;
  // 한 드래그 안에서 위쪽 임계 통과만 재생하는 세기 상태다.
  powerThresholds: PowerThresholdState;
  // live fixed step에서만 갱신하는 말·말과 말·맵 충돌음 접촉·제한 상태다.
  pieceHits: PieceHitSoundState;
}

// GitHub Pages 하위 경로 배포에서도 깨지지 않도록 에셋 로더와 같은 BASE_URL 기준으로 주소를 만든다.
const SOUND_ASSET_BASE_URL = `${import.meta.env.BASE_URL}assets/sound/`;

const SOUND_EFFECT_URLS: Readonly<
  Record<SoundEffectId, string>
> = {
  button: `${SOUND_ASSET_BASE_URL}buttonclick_sound.mp3`,
  hit: `${SOUND_ASSET_BASE_URL}hit_sound.mp3`,
  wood: `${SOUND_ASSET_BASE_URL}wood_hit_sound.mp3`,
  rock: `${SOUND_ASSET_BASE_URL}rock_hit_sound.mp3`,
  iron: `${SOUND_ASSET_BASE_URL}iron_hit_sound.mp3`,
  power10: `${SOUND_ASSET_BASE_URL}power_10.mp3`,
  power50: `${SOUND_ASSET_BASE_URL}power_50.mp3`,
  power90: `${SOUND_ASSET_BASE_URL}power_90.mp3`,
};

// 모듈 하나가 메뉴와 대국 전체에서 같은 BGM·버퍼·제한 상태를 공유한다.
let soundRuntime: SoundRuntime | null = null;

/**
 * 효과음이나 자동재생 실패가 게임 진행을 막지 않도록 같은 경고는 한 번만 남긴다.
 */
function warnSoundOnce(
  runtime: SoundRuntime,
  key: string,
  message: string,
  error: unknown,
): void {
  if (runtime.warningKeys.has(key)) {
    return;
  }
  runtime.warningKeys.add(key);
  console.warn(
    `[사운드] ${message}`,
    error instanceof Error ? error.message : String(error),
  );
}

/**
 * 한 MP3를 가져와 현재 컨텍스트의 저지연 재생 버퍼로 디코딩한다.
 */
async function preloadSoundEffect(
  runtime: SoundRuntime,
  id: SoundEffectId,
  url: string,
): Promise<void> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    const encoded = await response.arrayBuffer();
    const decoded = await runtime.context.decodeAudioData(encoded);
    runtime.buffers.set(id, decoded);
  } catch (error: unknown) {
    warnSoundOnce(
      runtime,
      `preload:${id}`,
      `${id} 효과음을 불러오지 못했습니다.`,
      error,
    );
  }
}

/**
 * 준비된 효과음 버퍼를 독립 소스로 재생해 겹치는 UI 반응도 서로 끊지 않게 한다.
 */
function playSoundEffect(id: SoundEffectId): void {
  const runtime = soundRuntime;
  if (
    runtime === null ||
    !runtime.unlocked ||
    runtime.context.state !== "running"
  ) {
    return;
  }
  const buffer = runtime.buffers.get(id);
  if (buffer === undefined) {
    return;
  }
  try {
    const source = runtime.context.createBufferSource();
    const gain = runtime.context.createGain();
    source.buffer = buffer;
    gain.gain.value = SOUND_SFX_VOLUME;
    source.connect(gain);
    gain.connect(runtime.context.destination);
    source.start();
  } catch (error: unknown) {
    warnSoundOnce(
      runtime,
      `play:${id}`,
      `${id} 효과음을 재생하지 못했습니다.`,
      error,
    );
  }
}

/**
 * 최초 포인터·키 입력에서 Web Audio와 지속 BGM을 함께 시작한다.
 */
function unlockSound(runtime: SoundRuntime): Promise<void> {
  if (runtime.unlocked) {
    return Promise.resolve();
  }
  if (runtime.unlockPromise !== null) {
    return runtime.unlockPromise;
  }
  runtime.unlockPromise = (async () => {
    try {
      if (runtime.context.state !== "running") {
        await runtime.context.resume();
      }
      runtime.unlocked = runtime.context.state === "running";
    } catch (error: unknown) {
      warnSoundOnce(
        runtime,
        "unlock",
        "브라우저 오디오 잠금을 해제하지 못했습니다.",
        error,
      );
    }
    if (runtime.unlocked) {
      try {
        await runtime.bgm.play();
      } catch (error: unknown) {
        warnSoundOnce(
          runtime,
          "bgm",
          "배경 음악을 재생하지 못했습니다.",
          error,
        );
      }
    }
  })().finally(() => {
    runtime.unlockPromise = null;
  });
  return runtime.unlockPromise;
}

/**
 * 브라우저에서만 지속 BGM과 효과음 디코딩·버튼 위임을 한 번 초기화한다.
 */
export function initializeSound(): void {
  if (
    soundRuntime !== null ||
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    typeof window.AudioContext === "undefined"
  ) {
    return;
  }
  const context = new window.AudioContext();
  const bgm = new Audio(`${SOUND_ASSET_BASE_URL}bgm1.mp3`);
  bgm.loop = true;
  bgm.preload = "auto";
  bgm.volume = SOUND_BGM_VOLUME;
  const runtime: SoundRuntime = {
    context,
    bgm,
    buffers: new Map(),
    unlocked: false,
    unlockPromise: null,
    warningKeys: new Set(),
    powerThresholds: {
      power10Armed: true,
      power50Armed: true,
      power90Armed: true,
    },
    pieceHits: {
      touchingPairs: new Set(),
      lastPlayedAtByPair: new Map(),
      lastGlobalPlayAt: Number.NEGATIVE_INFINITY,
    },
  };
  soundRuntime = runtime;
  for (const [id, url] of Object.entries(
    SOUND_EFFECT_URLS,
  ) as Array<[SoundEffectId, string]>) {
    void preloadSoundEffect(runtime, id, url);
  }

  const unlockOnFirstGesture = (): void => {
    void unlockSound(runtime).then(() => {
      if (!runtime.unlocked) {
        return;
      }
      document.removeEventListener(
        "pointerdown",
        unlockOnFirstGesture,
        true,
      );
      document.removeEventListener(
        "keydown",
        unlockOnFirstGesture,
        true,
      );
    });
  };
  document.addEventListener(
    "pointerdown",
    unlockOnFirstGesture,
    true,
  );
  document.addEventListener("keydown", unlockOnFirstGesture, true);
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest("button") !== null
    ) {
      void unlockSound(runtime).then(() => {
        playSoundEffect("button");
      });
    }
  });
}

/**
 * 캔버스에서 유효한 말을 눌렀을 때 버튼과 같은 클릭 반응음을 한 번 재생한다.
 */
export function playPieceClickSound(): void {
  playSoundEffect("button");
}

/**
 * 새 로컬 드래그가 시작되거나 끝날 때 세 임계값을 모두 다시 무장한다.
 */
export function resetAimPowerSounds(): void {
  const thresholds = soundRuntime?.powerThresholds;
  if (thresholds === undefined) {
    return;
  }
  thresholds.power10Armed = true;
  thresholds.power50Armed = true;
  thresholds.power90Armed = true;
}

/**
 * 현재 세기가 10·50·90%를 위로 통과한 순간만 해당 효과음을 재생하고 하강 시 재무장한다.
 */
export function updateAimPowerSounds(normalizedPower: number): void {
  const thresholds = soundRuntime?.powerThresholds;
  if (
    thresholds === undefined ||
    !Number.isFinite(normalizedPower)
  ) {
    return;
  }
  const clampedPower = Math.min(Math.max(normalizedPower, 0), 1);
  const definitions = [
    ["power10Armed", 0.1, "power10"],
    ["power50Armed", 0.5, "power50"],
    ["power90Armed", 0.9, "power90"],
  ] as const;
  for (const [armedKey, threshold, soundId] of definitions) {
    if (clampedPower < threshold) {
      thresholds[armedKey] = true;
    } else if (thresholds[armedKey]) {
      thresholds[armedKey] = false;
      playSoundEffect(soundId);
    }
  }
}

/**
 * 새 보드의 사전 정착 접촉이 live 충돌로 이어지지 않도록 접촉 이력만 초기화한다.
 */
export function resetPieceHitSoundTracking(): void {
  const hitState = soundRuntime?.pieceHits;
  if (hitState === undefined) {
    return;
  }
  hitState.touchingPairs.clear();
  hitState.lastPlayedAtByPair.clear();
  hitState.lastGlobalPlayAt = Number.NEGATIVE_INFINITY;
}

/**
 * 두 콜라이더 사이에 실제 solver contact가 하나라도 있는지 상태를 바꾸지 않고 조회한다.
 */
function hasSolverContact(
  physicsRuntime: PhysicsRuntime,
  leftCollider: PhysicsRuntime["boardCollider"],
  rightCollider: PhysicsRuntime["boardCollider"],
): boolean {
  let touching = false;
  physicsRuntime.world.contactPair(
    leftCollider,
    rightCollider,
    (manifold) => {
      if (manifold.numSolverContacts() > 0) {
        touching = true;
      }
    },
  );
  return touching;
}

/**
 * live fixed step 직후 말·말과 말·맵 접촉을 읽기만 해 표면에 맞는 가장 강한 새 충돌음을 재생한다.
 */
export function scanLivePieceHitSounds(
  physicsRuntime: PhysicsRuntime,
  now: number,
): void {
  const runtime = soundRuntime;
  if (runtime === null || !Number.isFinite(now)) {
    return;
  }
  const pieces = [...physicsRuntime.pieces.values()].sort(
    (left, right) =>
      left.instance.id < right.instance.id
        ? -1
        : left.instance.id > right.instance.id
          ? 1
          : 0,
  );
  const currentTouchingPairs = new Set<string>();
  const candidateState: {
    // 중첩 접촉 등록 함수가 갱신해도 마지막 선택부에서 타입을 정확히 좁히는 공유 상자다.
    strongest:
      | {
        // 충돌 제한과 추적에 쓰는 결정적 말·표면 쌍 키다.
        pairKey: string;
        // 같은 step의 여러 접촉 중 실제로 재생할 가장 큰 상대 선속도다.
        relativeSpeed: number;
        // 말·말, 목재 벽, 석재 벽, 철제 장애물을 구분하는 효과음이다.
        soundId: CollisionSoundEffectId;
      }
      | null;
  } = { strongest: null };
  const considerContact = (
    pairKey: string,
    relativeSpeed: number,
    soundId: CollisionSoundEffectId,
  ): void => {
    currentTouchingPairs.add(pairKey);
    if (runtime.pieceHits.touchingPairs.has(pairKey)) {
      return;
    }
    const lastPairPlay =
      runtime.pieceHits.lastPlayedAtByPair.get(pairKey) ??
      Number.NEGATIVE_INFINITY;
    if (
      relativeSpeed < SOUND_HIT_MIN_RELATIVE_SPEED ||
      now - lastPairPlay < SOUND_HIT_PAIR_COOLDOWN_MS
    ) {
      return;
    }
    if (
      candidateState.strongest === null ||
      relativeSpeed > candidateState.strongest.relativeSpeed
    ) {
      candidateState.strongest = {
        pairKey,
        relativeSpeed,
        soundId,
      };
    }
  };

  for (let leftIndex = 0; leftIndex < pieces.length; leftIndex += 1) {
    const left = pieces[leftIndex];
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < pieces.length;
      rightIndex += 1
    ) {
      const right = pieces[rightIndex];
      if (
        !hasSolverContact(
          physicsRuntime,
          left.collider,
          right.collider,
        )
      ) {
        continue;
      }
      const leftVelocity = left.body.linvel();
      const rightVelocity = right.body.linvel();
      considerContact(
        `piece:${left.instance.id}|piece:${right.instance.id}`,
        Math.hypot(
          leftVelocity.x - rightVelocity.x,
          leftVelocity.y - rightVelocity.y,
          leftVelocity.z - rightVelocity.z,
        ),
        "hit",
      );
    }
  }

  const walls = [...physicsRuntime.breakableWalls.values()].sort(
    (left, right) =>
      left.definition.id < right.definition.id
        ? -1
        : left.definition.id > right.definition.id
          ? 1
          : 0,
  );
  for (const piece of pieces) {
    const velocity = piece.body.linvel();
    const speed = Math.hypot(
      velocity.x,
      velocity.y,
      velocity.z,
    );
    for (const wall of walls) {
      if (
        !hasSolverContact(
          physicsRuntime,
          piece.collider,
          wall.collider,
        )
      ) {
        continue;
      }
      considerContact(
        `piece:${piece.instance.id}|wall:${wall.definition.id}`,
        speed,
        wall.definition.variant === "breakable"
          ? "wood"
          : "rock",
      );
    }
  }

  const obstacles = [
    ...physicsRuntime.pinballObstacles.values(),
  ].sort((left, right) =>
    left.definition.id < right.definition.id
      ? -1
      : left.definition.id > right.definition.id
        ? 1
        : 0,
  );
  for (const piece of pieces) {
    const velocity = piece.body.linvel();
    const speed = Math.hypot(
      velocity.x,
      velocity.y,
      velocity.z,
    );
    for (const obstacle of obstacles) {
      if (
        !hasSolverContact(
          physicsRuntime,
          piece.collider,
          obstacle.collider,
        )
      ) {
        continue;
      }
      considerContact(
        `piece:${piece.instance.id}|obstacle:${obstacle.definition.id}`,
        speed,
        "iron",
      );
    }
  }

  runtime.pieceHits.touchingPairs = currentTouchingPairs;
  const strongestCandidate = candidateState.strongest;
  if (
    strongestCandidate === null ||
    now - runtime.pieceHits.lastGlobalPlayAt <
      SOUND_HIT_GLOBAL_COOLDOWN_MS
  ) {
    return;
  }
  runtime.pieceHits.lastGlobalPlayAt = now;
  runtime.pieceHits.lastPlayedAtByPair.set(
    strongestCandidate.pairKey,
    now,
  );
  playSoundEffect(strongestCandidate.soundId);
}
