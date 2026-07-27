import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Mesh, Scene, Vector3 } from "three";
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
 * 조건이 거짓이면 검증 이름과 실제 값을 포함해 즉시 중단한다.
 */
function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * 실제 JSON 직렬화와 같은 UTF-8 메시지 바이트 수를 센다.
 */
function measureMessageBytes(message) {
  return new TextEncoder().encode(JSON.stringify(message)).byteLength;
}

/**
 * 두 온라인 런타임 사이에서 동기적으로 메시지를 전달하고 전체 로그를 보존한다.
 */
function createFakeTransportPair() {
  const createEndpoint = (sender) => {
    const messageHandlers = new Set();
    const stateHandlers = new Set();
    const deferredMessages = [];
    return {
      sender,
      peer: null,
      log: [],
      dropKinds: new Set(),
      deferMessages: false,
      disconnectCause: null,
      // 실제 데이터 채널처럼 닫힌 뒤 전송을 즉시 거절하기 위한 연결 상태다.
      connected: true,
      send(payload) {
        if (!this.connected) {
          throw new Error(
            "P2P 데이터 채널이 아직 연결되지 않았습니다.",
          );
        }
        const cloned = JSON.parse(JSON.stringify(payload));
        this.log.push({ sender, payload: cloned });
        if (this.dropKinds.has(cloned.kind)) {
          return;
        }
        if (this.deferMessages) {
          deferredMessages.push(cloned);
          return;
        }
        this.deliver(cloned);
      },
      deliver(payload) {
        for (const handler of this.peer.messageHandlers) {
          handler(payload);
        }
      },
      flushDeferred() {
        for (const payload of deferredMessages.splice(0)) {
          this.deliver(payload);
        }
      },
      onMessage(handler) {
        messageHandlers.add(handler);
        return () => messageHandlers.delete(handler);
      },
      onStateChange(handler) {
        stateHandlers.add(handler);
        handler("connected");
        return () => stateHandlers.delete(handler);
      },
      close() {
        if (!this.connected) {
          return;
        }
        this.connected = false;
        this.disconnectCause = "graceful-close";
        for (const handler of stateHandlers) {
          handler("disconnected");
        }
        if (this.peer !== null) {
          this.peer.connected = false;
          this.peer.disconnectCause = "peer-connection-failed";
          for (const handler of this.peer.stateHandlers) {
            handler("disconnected");
          }
        }
      },
      messageHandlers,
      stateHandlers,
    };
  };
  const host = createEndpoint("host");
  const guest = createEndpoint("guest");
  host.peer = guest;
  guest.peer = host;
  return { host, guest };
}

/**
 * turn.ts가 요구하는 최소 씬 연결을 만들고 카메라 애니메이션은 생략한다.
 */
function createHeadlessSceneRuntime(physicsRuntime) {
  const scene = new Scene();
  const pieceMeshes = new Map();
  for (const binding of physicsRuntime.pieces.values()) {
    const mesh = new Mesh();
    mesh.name = binding.instance.id;
    scene.add(mesh);
    pieceMeshes.set(binding.instance.id, mesh);
  }
  return {
    scene,
    pieceMeshes,
    controls: { enabled: true },
  };
}

/**
 * 버프 없는 실제 32말 온라인 표준 월드 하나를 만든다.
 */
async function createMatchRuntime(modules, meta) {
  const physicsRuntime =
    await modules.physics.createPhysicsRuntime(
      meta,
      modules.layout.PIECE_INSTANCES,
      modules.config.deriveBoardHalfExtent(meta.cellSize),
      { gameMode: "online", stageNumber: 1 },
    );
  modules.physics.preSettlePhysics(physicsRuntime);
  const sceneRuntime =
    createHeadlessSceneRuntime(physicsRuntime);
  const turnRuntime = modules.turn.createTurnRuntime(
    physicsRuntime,
    sceneRuntime,
    modules.tuning.createDefaultRuntimeTuningSettings(),
  );
  modules.turn.setTurnGameMode(turnRuntime, "online");
  return { physicsRuntime, sceneRuntime, turnRuntime };
}

/**
 * 재대결도 최초 대국과 같은 물리 스폰·사전 정착 경로로 32말 표준 월드를 다시 만든다.
 */
function resetMatchRuntime(modules, meta, runtime) {
  modules.physics.resetPhysicsPieces(
    runtime.physicsRuntime,
    meta,
    modules.layout.PIECE_INSTANCES,
    { gameMode: "online", stageNumber: 1 },
  );
  modules.physics.preSettlePhysics(runtime.physicsRuntime);
  for (const mesh of runtime.sceneRuntime.pieceMeshes.values()) {
    runtime.sceneRuntime.scene.remove(mesh);
  }
  runtime.sceneRuntime.pieceMeshes.clear();
  for (const binding of runtime.physicsRuntime.pieces.values()) {
    const mesh = new Mesh();
    mesh.name = binding.instance.id;
    runtime.sceneRuntime.scene.add(mesh);
    runtime.sceneRuntime.pieceMeshes.set(binding.instance.id, mesh);
  }
  modules.turn.resetTurnRuntime(runtime.turnRuntime);
  modules.turn.setTurnGameMode(runtime.turnRuntime, "online");
}

/**
 * 현재 로컬 진영의 id 정렬 말 하나를 중앙 방향으로 약하게 발사할 요청을 만든다.
 */
function createScriptedRequest(runtime, turnIndex) {
  const candidates = [...runtime.physicsRuntime.pieces.values()]
    .filter(
      (binding) =>
        binding.instance.side === runtime.turnRuntime.currentSide,
    )
    .sort((left, right) =>
      left.instance.id < right.instance.id
        ? -1
        : left.instance.id > right.instance.id
          ? 1
          : 0,
    );
  const binding = candidates[turnIndex % candidates.length];
  if (binding === undefined) {
    throw new Error(`${turnIndex}번 온라인 턴 발사 말이 없습니다.`);
  }
  const translation = binding.body.translation();
  const direction = new Vector3(
    -translation.x,
    0,
    -translation.z,
  );
  if (direction.lengthSq() < 1e-12) {
    direction.set(
      0,
      0,
      binding.instance.side === "white" ? 1 : -1,
    );
  } else {
    direction.normalize();
  }
  return {
    pieceId: binding.instance.id,
    direction,
    normalizedPower: 0.08,
    applicationPoint: binding.body.worldCom(),
    speedMultiplier: 1,
  };
}

/**
 * 상대 headless 연출을 즉시 큐에 넣고 두 실제 월드를 같은 fixed step으로 정착시킨다.
 */
function settlePair(modules, host, guest, hostOnline, guestOnline) {
  hostOnline.update(performance.now());
  guestOnline.update(performance.now());
  const maximumSteps = Math.ceil(
    (modules.config.MAX_SETTLE_SECONDS * 2) /
      modules.config.FIXED_STEP,
  );
  let steps = 0;
  while (
    steps < maximumSteps &&
    (host.turnRuntime.phase !== "ready" ||
      guest.turnRuntime.phase !== "ready")
  ) {
    for (const runtime of [host, guest]) {
      modules.turn.applyPendingLaunchBeforeStep(
        runtime.turnRuntime,
      );
      runtime.physicsRuntime.world.step();
      modules.turn.updateTurnAfterStep(
        runtime.turnRuntime,
        modules.config.FIXED_STEP,
      );
    }
    steps += 1;
  }
  assertCondition(
    host.turnRuntime.phase === "ready" &&
      guest.turnRuntime.phase === "ready",
    `온라인 두 월드가 ${maximumSteps} step 안에 정착하지 못했습니다: host=${host.turnRuntime.phase}, guest=${guest.turnRuntime.phase}`,
  );
  return steps;
}

/**
 * 상대에게 입력이 도착하지 않은 실제 단절 직전처럼 한 월드만 기존 fixed-step 정착 경로로 진행한다.
 */
function settleSingle(modules, runtime) {
  const maximumSteps = Math.ceil(
    (modules.config.MAX_SETTLE_SECONDS * 2) /
      modules.config.FIXED_STEP,
  );
  let steps = 0;
  while (
    steps < maximumSteps &&
    runtime.turnRuntime.phase !== "ready"
  ) {
    modules.turn.applyPendingLaunchBeforeStep(
      runtime.turnRuntime,
    );
    runtime.physicsRuntime.world.step();
    modules.turn.updateTurnAfterStep(
      runtime.turnRuntime,
      modules.config.FIXED_STEP,
    );
    steps += 1;
  }
  assertCondition(
    runtime.turnRuntime.phase === "ready",
    `방장 단독 월드가 ${maximumSteps} step 안에 정착하지 못했습니다: ${runtime.turnRuntime.phase}`,
  );
  return steps;
}

/**
 * 재대결 상태 머신 한 사례가 사용할 두 표준 월드와 실제 온라인 런타임을 만든다.
 */
async function createRematchCheckPair(modules, meta, label) {
  const host = await createMatchRuntime(modules, meta);
  const guest = await createMatchRuntime(modules, meta);
  const transports = createFakeTransportPair();
  const counters = {
    hostPrepared: 0,
    guestPrepared: 0,
    hostStarted: 0,
    guestStarted: 0,
  };
  const hostOnline = modules.online.createOnlineRuntime(
    transports.host,
    host.turnRuntime,
    null,
    "white",
    {
      prepareRematch: async () => {
        counters.hostPrepared += 1;
        resetMatchRuntime(modules, meta, host);
      },
      onRematchStarted: () => {
        counters.hostStarted += 1;
      },
    },
    { matchId: `rematch-check-${label}` },
  );
  const guestOnline = modules.online.createOnlineRuntime(
    transports.guest,
    guest.turnRuntime,
    null,
    "black",
    {
      prepareRematch: async () => {
        counters.guestPrepared += 1;
        resetMatchRuntime(modules, meta, guest);
      },
      onRematchStarted: () => {
        counters.guestStarted += 1;
      },
    },
    { matchId: `rematch-check-${label}` },
  );
  hostOnline.startMatch();
  guestOnline.startMatch();
  await Promise.all([
    hostOnline.waitUntilReady(),
    guestOnline.waitUntilReady(),
  ]);
  hostOnline.resign("white");
  assertCondition(
    host.turnRuntime.phase === "match-over" &&
      guest.turnRuntime.phase === "match-over",
    `${label} 재대결 검증용 이전 결과가 양쪽에 남지 않았습니다.`,
  );
  return {
    host,
    guest,
    transports,
    counters,
    hostOnline,
    guestOnline,
  };
}

/**
 * 재대결 비동기 보드 준비와 ready 해시 교환이 모두 끝날 때까지 기다린다.
 */
async function flushRematchPair(pair) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await Promise.all([
      pair.hostOnline.flush(),
      pair.guestOnline.flush(),
    ]);
    if (pair.hostOnline.active && pair.guestOnline.active) {
      return;
    }
  }
}

/**
 * 두 재대결 월드를 정리해 다음 사례에 Rapier 자원이 남지 않게 한다.
 */
function closeRematchPair(pair) {
  pair.hostOnline.close();
  pair.guestOnline.close();
  pair.host.physicsRuntime.world.free();
  pair.guest.physicsRuntime.world.free();
}

try {
  const [
    config,
    layout,
    online,
    physics,
    stateHash,
    tuning,
    turn,
  ] = await Promise.all([
    vite.ssrLoadModule("/src/config.ts"),
    vite.ssrLoadModule("/src/layout.ts"),
    vite.ssrLoadModule("/src/online.ts"),
    vite.ssrLoadModule("/src/physics.ts"),
    vite.ssrLoadModule("/src/state-hash.ts"),
    vite.ssrLoadModule("/src/tuning.ts"),
    vite.ssrLoadModule("/src/turn.ts"),
  ]);
  const modules = {
    config,
    layout,
    online,
    physics,
    stateHash,
    tuning,
    turn,
  };
  const meta = JSON.parse(
    await readFile(
      new URL(
        "../../public/assets/chess-set.meta.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const host = await createMatchRuntime(modules, meta);
  const guest = await createMatchRuntime(modules, meta);
  const transports = createFakeTransportPair();
  const resignedEvents = [];
  const hostOnline = online.createOnlineRuntime(
    transports.host,
    host.turnRuntime,
    null,
    "white",
    {
      onResigned: (side) => resignedEvents.push(`host:${side}`),
    },
  );
  const guestOnline = online.createOnlineRuntime(
    transports.guest,
    guest.turnRuntime,
    null,
    "black",
    {
      onResigned: (side) => resignedEvents.push(`guest:${side}`),
    },
  );
  hostOnline.startMatch();
  guestOnline.startMatch();
  await Promise.all([
    hostOnline.waitUntilReady(),
    guestOnline.waitUntilReady(),
  ]);

  const blockedRequest = createScriptedRequest(guest, 0);
  const blocked = guestOnline.queueLocalLaunch(blockedRequest);
  assertCondition(
    !blocked.accepted &&
      guest.turnRuntime.pendingLaunch === null,
    `상대 백 턴에 흑 로컬 발사가 차단되지 않았습니다: ${JSON.stringify(blocked)}`,
  );
  console.log(
    `[통과 c] 턴 소유권: guest=black, current=white, accepted=${blocked.accepted}, reason=${blocked.reason}`,
  );

  const settleSteps = [];
  let recoveryTurn = null;
  let recoverySleeping = false;
  for (let turnIndex = 0; turnIndex < 10; turnIndex += 1) {
    const localRuntime =
      host.turnRuntime.currentSide === "white"
        ? host
        : guest;
    const localOnline =
      host.turnRuntime.currentSide === "white"
        ? hostOnline
        : guestOnline;
    const request = createScriptedRequest(
      localRuntime,
      turnIndex,
    );
    const queued = localOnline.queueLocalLaunch(request);
    assertCondition(
      queued.accepted,
      `${turnIndex}번 온라인 로컬 발사가 거절됐습니다: ${queued.reason}`,
    );
    settleSteps.push(
      settlePair(
        modules,
        host,
        guest,
        hostOnline,
        guestOnline,
      ),
    );
    await Promise.all([
      hostOnline.flush(),
      guestOnline.flush(),
    ]);

    if (turnIndex === 4) {
      const diverged =
        guest.physicsRuntime.pieces.get("white-rook-a1");
      assertCondition(
        diverged !== undefined,
        "의도적 발산 대상 white-rook-a1이 없습니다.",
      );
      const position = diverged.body.translation();
      diverged.body.setTranslation(
        {
          x: position.x + 0.03125,
          y: position.y,
          z: position.z,
        },
        false,
      );
      diverged.body.sleep();
    }

    const hostState =
      await stateHash.capturePhysicsStateHash(
        host.physicsRuntime,
      );
    const guestState =
      await stateHash.capturePhysicsStateHash(
        guest.physicsRuntime,
      );
    if (turnIndex === 4) {
      assertCondition(
        hostState.sha256 !== guestState.sha256,
        "의도적 발산이 다음 턴 전 상태 해시에 반영되지 않았습니다.",
      );
    } else {
      assertCondition(
        hostState.sha256 === guestState.sha256,
        `${turnIndex}번 턴 뒤 두 최종 상태 해시가 다릅니다: ${hostState.sha256} != ${guestState.sha256}`,
      );
    }
    if (
      guestOnline.lastEvent.includes("스냅샷 복구 완료")
    ) {
      recoveryTurn = turnIndex;
      recoverySleeping = [
        ...guest.physicsRuntime.pieces.values(),
      ].every((binding) => binding.body.isSleeping());
    }
  }

  const finalHost =
    await stateHash.capturePhysicsStateHash(
      host.physicsRuntime,
    );
  const finalGuest =
    await stateHash.capturePhysicsStateHash(
      guest.physicsRuntime,
    );
  assertCondition(
    finalHost.sha256 === finalGuest.sha256 &&
      hostOnline.nextTurnIndex === 10 &&
      guestOnline.nextTurnIndex === 10,
    `10턴 최종 동기화 실패: ${finalHost.sha256} != ${finalGuest.sha256}`,
  );
  assertCondition(
    recoveryTurn === 5 &&
      hostOnline.desyncCount === 1 &&
      guestOnline.desyncCount === 1 &&
      recoverySleeping,
    `스냅샷 복구 결과가 예상과 다릅니다: recoveryTurn=${recoveryTurn}, hostDesync=${hostOnline.desyncCount}, guestDesync=${guestOnline.desyncCount}`,
  );

  const combinedLog = [
    ...transports.host.log,
    ...transports.guest.log,
  ];
  const firstReady = combinedLog.find(
    (entry) => entry.payload.kind === "ready",
  )?.payload;
  const firstTurn = combinedLog.find(
    (entry) =>
      entry.payload.kind === "turn" &&
      entry.payload.turnIndex === 0,
  )?.payload;
  const firstHash = combinedLog.find(
    (entry) =>
      entry.payload.kind === "turnHash" &&
      entry.payload.turnIndex === 0,
  )?.payload;
  const recoverySnapshot = combinedLog.find(
    (entry) => entry.payload.kind === "stateSnapshot",
  )?.payload;
  const recoveryRequest = combinedLog.find(
    (entry) => entry.payload.kind === "stateRequest",
  )?.payload;
  assertCondition(
    firstReady !== undefined &&
    firstTurn !== undefined &&
      firstHash !== undefined &&
      recoveryRequest !== undefined &&
      recoverySnapshot !== undefined,
    "프로토콜 크기 측정 메시지를 찾지 못했습니다.",
  );
  console.log(
    `[통과 a] 두 실제 월드 10턴 최종 해시 일치: ${finalHost.sha256}, settleSteps=${settleSteps.join(",")}`,
  );
  console.log(
    `[통과 b] 의도적 발산→스냅샷 복구: recoveryTurn=${recoveryTurn}, host/guest desync=1/1, sleeping=${guest.physicsRuntime.pieces.size}/${guest.physicsRuntime.pieces.size}`,
  );
  console.log(
    `[프로토콜] ready=${measureMessageBytes(firstReady)} bytes ${JSON.stringify(firstReady)}`,
  );
  console.log(
    `[프로토콜] turn=${measureMessageBytes(firstTurn)} bytes ${JSON.stringify(firstTurn)}`,
  );
  console.log(
    `[프로토콜] turnHash=${measureMessageBytes(firstHash)} bytes ${JSON.stringify(firstHash)}`,
  );
  console.log(
    `[프로토콜] stateRequest=${measureMessageBytes(recoveryRequest)} bytes ${JSON.stringify(recoveryRequest)}`,
  );
  console.log(
    `[프로토콜] stateSnapshot=${measureMessageBytes(recoverySnapshot)} bytes, pieces=${recoverySnapshot.pieces.length}`,
  );

  transports.host.close();
  assertCondition(
    !hostOnline.active &&
      !guestOnline.active &&
      !hostOnline.queueLocalLaunch(
        createScriptedRequest(host, 10),
      ).accepted,
    "끊김 뒤 양쪽 입력이 차단되지 않았습니다.",
  );
  const resumedTransports = createFakeTransportPair();
  await Promise.all([
    hostOnline.replaceTransport(resumedTransports.host),
    guestOnline.replaceTransport(resumedTransports.guest),
  ]);
  const resumedHost =
    await stateHash.capturePhysicsStateHash(host.physicsRuntime);
  const resumedGuest =
    await stateHash.capturePhysicsStateHash(guest.physicsRuntime);
  assertCondition(
    hostOnline.active &&
      guestOnline.active &&
      resumedHost.sha256 === resumedGuest.sha256,
    "동일 턴 재연결 뒤 해시 또는 활성 상태가 복구되지 않았습니다.",
  );
  console.log(
    `[통과 d] 끊김 통합·동일 턴 재연결: active=true/true, hash=${resumedHost.sha256}`,
  );

  // 앞선 의도적 스냅샷 발산 시험의 솔버 이력이 섞이지 않은 새 두 월드에서 실제 꼬리 복구만 검증한다.
  const tailHost = await createMatchRuntime(modules, meta);
  const tailGuest = await createMatchRuntime(modules, meta);
  const tailInitialTransports = createFakeTransportPair();
  const tailHostOnline = online.createOnlineRuntime(
    tailInitialTransports.host,
    tailHost.turnRuntime,
    null,
    "white",
  );
  const tailGuestOnline = online.createOnlineRuntime(
    tailInitialTransports.guest,
    tailGuest.turnRuntime,
    null,
    "black",
  );
  tailHostOnline.startMatch();
  tailGuestOnline.startMatch();
  await Promise.all([
    tailHostOnline.waitUntilReady(),
    tailGuestOnline.waitUntilReady(),
  ]);
  for (let turnIndex = 0; turnIndex < 4; turnIndex += 1) {
    const localRuntime =
      tailHost.turnRuntime.currentSide === "white"
        ? tailHost
        : tailGuest;
    const localOnline =
      tailHost.turnRuntime.currentSide === "white"
        ? tailHostOnline
        : tailGuestOnline;
    const queued = localOnline.queueLocalLaunch(
      createScriptedRequest(localRuntime, turnIndex),
    );
    assertCondition(
      queued.accepted,
      `꼬리 복구 사전 ${turnIndex}번 발사가 거절됐습니다: ${queued.reason}`,
    );
    settlePair(
      modules,
      tailHost,
      tailGuest,
      tailHostOnline,
      tailGuestOnline,
    );
    await Promise.all([
      tailHostOnline.flush(),
      tailGuestOnline.flush(),
    ]);
  }

  // 방장 백 턴 입력과 해시만 유실시킨 채 방장 월드를 정상 정착시켜,
  // 좌표 강제 되감기 없이 참가자가 실제 물리 이력을 보존한 한 턴 뒤처짐을 만든다.
  tailInitialTransports.host.dropKinds.add("turn");
  tailInitialTransports.host.dropKinds.add("turnHash");
  const behindStartTurn = tailHostOnline.nextTurnIndex;
  assertCondition(
    behindStartTurn % 2 === 0 &&
      tailHost.turnRuntime.currentSide === "white",
    `실제 한 턴 뒤처짐은 방장 백 턴에서 시작해야 합니다: turn=${behindStartTurn}, side=${tailHost.turnRuntime.currentSide}`,
  );
  const hostOnlyLaunch = tailHostOnline.queueLocalLaunch(
    createScriptedRequest(tailHost, behindStartTurn),
  );
  assertCondition(
    hostOnlyLaunch.accepted,
    `방장 단독 발사가 거절됐습니다: ${hostOnlyLaunch.reason}`,
  );
  const hostOnlySteps = settleSingle(modules, tailHost);
  await tailHostOnline.flush();
  assertCondition(
    tailHostOnline.nextTurnIndex === behindStartTurn + 1 &&
      tailGuestOnline.nextTurnIndex === behindStartTurn,
    `실제 참가자 한 턴 뒤처짐 생성 실패: host=${tailHostOnline.nextTurnIndex}, guest=${tailGuestOnline.nextTurnIndex}`,
  );
  tailInitialTransports.host.close();
  const hostAheadTransports = createFakeTransportPair();
  await Promise.all([
    tailHostOnline.replaceTransport(hostAheadTransports.host),
    tailGuestOnline.replaceTransport(hostAheadTransports.guest),
  ]);
  const hostAheadHost =
    await stateHash.capturePhysicsStateHash(tailHost.physicsRuntime);
  const hostAheadGuest =
    await stateHash.capturePhysicsStateHash(tailGuest.physicsRuntime);
  assertCondition(
    tailGuestOnline.nextTurnIndex === behindStartTurn + 1 &&
      tailGuest.turnRuntime.currentSide === "black" &&
      hostAheadHost.sha256 === hostAheadGuest.sha256 &&
      tailGuestOnline.lastResumeReplayMatched === true,
    `방장 선행 실제 기록 재생이 실패했습니다: guestTurn=${tailGuestOnline.nextTurnIndex}, side=${tailGuest.turnRuntime.currentSide}, replayMatched=${tailGuestOnline.lastResumeReplayMatched}, event=${tailGuestOnline.lastEvent}`,
  );
  const tailDesyncBefore = Math.max(
    tailHostOnline.desyncCount,
    tailGuestOnline.desyncCount,
  );
  for (
    let turnIndex = behindStartTurn + 1;
    turnIndex < behindStartTurn + 5;
    turnIndex += 1
  ) {
    const localRuntime =
      tailHost.turnRuntime.currentSide === "white"
        ? tailHost
        : tailGuest;
    const localOnline =
      tailHost.turnRuntime.currentSide === "white"
        ? tailHostOnline
        : tailGuestOnline;
    const queued = localOnline.queueLocalLaunch(
      createScriptedRequest(localRuntime, turnIndex),
    );
    assertCondition(
      queued.accepted,
      `꼬리 복구 뒤 ${turnIndex}번 발사가 거절됐습니다: ${queued.reason}`,
    );
    settlePair(
      modules,
      tailHost,
      tailGuest,
      tailHostOnline,
      tailGuestOnline,
    );
    await Promise.all([
      tailHostOnline.flush(),
      tailGuestOnline.flush(),
    ]);
  }
  const tailPostHost =
    await stateHash.capturePhysicsStateHash(tailHost.physicsRuntime);
  const tailPostGuest =
    await stateHash.capturePhysicsStateHash(tailGuest.physicsRuntime);
  assertCondition(
    tailPostHost.sha256 === tailPostGuest.sha256 &&
      tailHostOnline.desyncCount === tailDesyncBefore &&
      tailGuestOnline.desyncCount === tailDesyncBefore,
    `실제 꼬리 재생 뒤 4수 동기화 실패: hostDesync=${tailHostOnline.desyncCount}, guestDesync=${tailGuestOnline.desyncCount}, comparison=${JSON.stringify(tailGuestOnline.lastHashComparison)}`,
  );
  console.log(
    `[통과 f] 실제 방장 단독 ${behindStartTurn}번 턴→꼬리 재생→후속 4수: replayMatched=true, hostOnlySteps=${hostOnlySteps}, hash=${tailPostHost.sha256}, desync=${tailHostOnline.desyncCount}/${tailGuestOnline.desyncCount}`,
  );

  hostAheadTransports.host.close();
  const guestAheadTarget = tailHostOnline.nextTurnIndex;
  tailGuestOnline.nextTurnIndex = guestAheadTarget + 1;
  const guestAheadTransports = createFakeTransportPair();
  await Promise.all([
    tailHostOnline.replaceTransport(guestAheadTransports.host),
    tailGuestOnline.replaceTransport(guestAheadTransports.guest),
  ]);
  const guestAheadHost =
    await stateHash.capturePhysicsStateHash(tailHost.physicsRuntime);
  const guestAheadGuest =
    await stateHash.capturePhysicsStateHash(tailGuest.physicsRuntime);
  assertCondition(
    tailGuestOnline.nextTurnIndex === guestAheadTarget &&
      tailGuest.turnRuntime.currentSide ===
        (guestAheadTarget % 2 === 0 ? "white" : "black") &&
      guestAheadHost.sha256 === guestAheadGuest.sha256 &&
      tailGuestOnline.lastEvent.includes("방장 상태로 재개"),
    `참가자 선행 되감기가 실패했습니다: guestTurn=${tailGuestOnline.nextTurnIndex}, side=${tailGuest.turnRuntime.currentSide}, event=${tailGuestOnline.lastEvent}`,
  );
  console.log(
    `[통과 g] 참가자 선행 턴 되감기: guest ${guestAheadTarget + 1}→host ${guestAheadTarget}`,
  );
  tailHostOnline.close();
  tailGuestOnline.close();
  tailHost.physicsRuntime.world.free();
  tailGuest.physicsRuntime.world.free();

  hostOnline.resign("white");
  hostOnline.update(performance.now() + 10_000);
  guestOnline.update(performance.now() + 10_000);
  assertCondition(
    resignedEvents.includes("host:white") &&
      resignedEvents.includes("guest:white") &&
      !hostOnline.active &&
      !guestOnline.active &&
      host.turnRuntime.phase === "match-over" &&
      guest.turnRuntime.phase === "match-over" &&
      !hostOnline.queueLocalLaunch(
        createScriptedRequest(host, 10),
      ).accepted,
    `백 기권 결과가 양쪽에 전달되지 않았습니다: ${resignedEvents.join(",")}`,
  );
  console.log(
    `[통과 e] 백 기권 양쪽 전달: ${resignedEvents.join(",")}`,
  );
  guestOnline.resign("black");
  assertCondition(
    resignedEvents.includes("host:black") &&
      resignedEvents.includes("guest:black"),
    `흑 기권 결과가 양쪽에 전달되지 않았습니다: ${resignedEvents.join(",")}`,
  );
  console.log("[통과 h] 흑 기권 양쪽 전달");

  hostOnline.close();
  guestOnline.close();

  // 실제 참가자 창 종료처럼 런타임·물리 월드를 폐기한 뒤 빈 새 게스트가 전체 기록을 받는 경로를 검증한다.
  const freshHost = await createMatchRuntime(modules, meta);
  const firstFreshGuest = await createMatchRuntime(modules, meta);
  const freshInitialTransports = createFakeTransportPair();
  const freshMatchId = "online-check-fresh-rejoin";
  const freshHostOnline = online.createOnlineRuntime(
    freshInitialTransports.host,
    freshHost.turnRuntime,
    null,
    "white",
    {},
    { matchId: freshMatchId },
  );
  const firstFreshGuestOnline = online.createOnlineRuntime(
    freshInitialTransports.guest,
    firstFreshGuest.turnRuntime,
    null,
    "black",
    {},
    { matchId: freshMatchId },
  );
  freshHostOnline.startMatch();
  firstFreshGuestOnline.startMatch();
  await Promise.all([
    freshHostOnline.waitUntilReady(),
    firstFreshGuestOnline.waitUntilReady(),
  ]);
  for (let turnIndex = 0; turnIndex < 6; turnIndex += 1) {
    const localRuntime =
      freshHost.turnRuntime.currentSide === "white"
        ? freshHost
        : firstFreshGuest;
    const localOnline =
      freshHost.turnRuntime.currentSide === "white"
        ? freshHostOnline
        : firstFreshGuestOnline;
    const queued = localOnline.queueLocalLaunch(
      createScriptedRequest(localRuntime, turnIndex),
    );
    assertCondition(
      queued.accepted,
      `새 참가자 검증 ${turnIndex}번 발사가 거절됐습니다: ${queued.reason}`,
    );
    settlePair(
      modules,
      freshHost,
      firstFreshGuest,
      freshHostOnline,
      firstFreshGuestOnline,
    );
    await Promise.all([
      freshHostOnline.flush(),
      firstFreshGuestOnline.flush(),
    ]);
  }
  firstFreshGuestOnline.close();
  firstFreshGuest.physicsRuntime.world.free();
  assertCondition(
    !freshHostOnline.active,
    "기존 참가자 런타임 폐기 뒤 방장이 끊김 상태가 되지 않았습니다.",
  );
  const recreatedGuest = await createMatchRuntime(modules, meta);
  const freshResumeTransports = createFakeTransportPair();
  const recreatedGuestOnline = online.createOnlineRuntime(
    freshResumeTransports.guest,
    recreatedGuest.turnRuntime,
    null,
    "black",
    {},
    { matchId: freshMatchId },
  );
  recreatedGuestOnline.startMatch({ rejoining: true });
  await Promise.all([
    freshHostOnline.replaceTransport(
      freshResumeTransports.host,
    ),
    recreatedGuestOnline.waitUntilReady(),
  ]);
  await Promise.all([
    freshHostOnline.flush(),
    recreatedGuestOnline.flush(),
  ]);
  const freshHostState =
    await stateHash.capturePhysicsStateHash(
      freshHost.physicsRuntime,
    );
  const recreatedGuestState =
    await stateHash.capturePhysicsStateHash(
      recreatedGuest.physicsRuntime,
    );
  assertCondition(
    freshHostOnline.nextTurnIndex === 6 &&
      recreatedGuestOnline.nextTurnIndex === 6 &&
      freshHost.turnRuntime.currentSide === "white" &&
      recreatedGuest.turnRuntime.currentSide === "white" &&
      freshHostState.sha256 === recreatedGuestState.sha256 &&
      recreatedGuestOnline.turnLog.length === 6 &&
      recreatedGuestOnline.lastResumeReplayMatched === true &&
      freshHostOnline.lastResumeTransferBytes > 0,
    `빈 새 참가자 전체 기록 복구 실패: hostTurn=${freshHostOnline.nextTurnIndex}, guestTurn=${recreatedGuestOnline.nextTurnIndex}, hostSide=${freshHost.turnRuntime.currentSide}, guestSide=${recreatedGuest.turnRuntime.currentSide}, turns=${recreatedGuestOnline.turnLog.length}, replayMatched=${recreatedGuestOnline.lastResumeReplayMatched}, bytes=${freshHostOnline.lastResumeTransferBytes}`,
  );
  console.log(
    `[통과 i] 6턴 뒤 참가자 완전 폐기→빈 새 참가자 전체 복구: hash=${freshHostState.sha256}, turns=${recreatedGuestOnline.turnLog.length}, bytes=${freshHostOnline.lastResumeTransferBytes}`,
  );

  const desyncBeforePostResumeTurns = Math.max(
    freshHostOnline.desyncCount,
    recreatedGuestOnline.desyncCount,
  );
  for (let turnIndex = 6; turnIndex < 10; turnIndex += 1) {
    const localRuntime =
      freshHost.turnRuntime.currentSide === "white"
        ? freshHost
        : recreatedGuest;
    const localOnline =
      freshHost.turnRuntime.currentSide === "white"
        ? freshHostOnline
        : recreatedGuestOnline;
    const queued = localOnline.queueLocalLaunch(
      createScriptedRequest(localRuntime, turnIndex),
    );
    assertCondition(
      queued.accepted,
      `새 참가자 후속 ${turnIndex}번 발사가 거절됐습니다: ${queued.reason}`,
    );
    settlePair(
      modules,
      freshHost,
      recreatedGuest,
      freshHostOnline,
      recreatedGuestOnline,
    );
    await Promise.all([
      freshHostOnline.flush(),
      recreatedGuestOnline.flush(),
    ]);
  }
  const postResumeHost =
    await stateHash.capturePhysicsStateHash(
      freshHost.physicsRuntime,
    );
  const postResumeGuest =
    await stateHash.capturePhysicsStateHash(
      recreatedGuest.physicsRuntime,
    );
  assertCondition(
    postResumeHost.sha256 === postResumeGuest.sha256 &&
      freshHostOnline.nextTurnIndex === 10 &&
      recreatedGuestOnline.nextTurnIndex === 10 &&
      freshHostOnline.desyncCount ===
        desyncBeforePostResumeTurns &&
      recreatedGuestOnline.desyncCount ===
        desyncBeforePostResumeTurns,
    `새 참가자 재개 뒤 4수의 원시 동기화가 유지되지 않았습니다: hostDesync=${freshHostOnline.desyncCount}, guestDesync=${recreatedGuestOnline.desyncCount}, comparison=${JSON.stringify(recreatedGuestOnline.lastHashComparison)}`,
  );
  console.log(
    `[통과 j] 새 참가자 재개 뒤 4수 원시 동기화: hash=${postResumeHost.sha256}, desync=${freshHostOnline.desyncCount}/${recreatedGuestOnline.desyncCount}`,
  );

  freshHostOnline.terminate();
  const terminatedLaunch = freshHostOnline.queueLocalLaunch(
    createScriptedRequest(freshHost, 10),
  );
  assertCondition(
    !freshHostOnline.active &&
      freshHost.turnRuntime.phase === "match-over" &&
      !terminatedLaunch.accepted &&
      terminatedLaunch.reason ===
        "온라인 대국이 이미 종료되었습니다.",
    `연결 단절 무효 종료 뒤 발사가 차단되지 않았습니다: ${JSON.stringify(terminatedLaunch)}`,
  );
  console.log(
    `[통과 k] 연결 단절 무효 종료: active=${freshHostOnline.active}, phase=${freshHost.turnRuntime.phase}, launchAccepted=${terminatedLaunch.accepted}`,
  );
  freshHostOnline.close();
  recreatedGuestOnline.close();
  freshHost.physicsRuntime.world.free();
  recreatedGuest.physicsRuntime.world.free();

  const acceptedRematch = await createRematchCheckPair(
    modules,
    meta,
    "accept",
  );
  const acceptedPreviousMatchId =
    acceptedRematch.hostOnline.matchId;
  acceptedRematch.hostOnline.offerRematch();
  assertCondition(
    acceptedRematch.guestOnline.getRematchStatus().phase ===
      "incoming",
    "재대결 요청이 참가자에게 incoming으로 도착하지 않았습니다.",
  );
  acceptedRematch.guestOnline.respondRematch(true);
  await flushRematchPair(acceptedRematch);
  const acceptedInitialHost =
    await stateHash.capturePhysicsStateHash(
      acceptedRematch.host.physicsRuntime,
    );
  const acceptedInitialGuest =
    await stateHash.capturePhysicsStateHash(
      acceptedRematch.guest.physicsRuntime,
    );
  const acceptedInitialLogLengths = [
    acceptedRematch.hostOnline.turnLog.length,
    acceptedRematch.guestOnline.turnLog.length,
  ];
  assertCondition(
    acceptedRematch.hostOnline.active &&
      acceptedRematch.guestOnline.active &&
      acceptedRematch.hostOnline.matchId !==
        acceptedPreviousMatchId &&
      acceptedRematch.hostOnline.matchId ===
        acceptedRematch.guestOnline.matchId &&
      acceptedRematch.hostOnline.nextTurnIndex === 0 &&
      acceptedRematch.guestOnline.nextTurnIndex === 0 &&
      acceptedInitialHost.sha256 ===
        acceptedInitialGuest.sha256 &&
      acceptedRematch.counters.hostPrepared === 1 &&
      acceptedRematch.counters.guestPrepared === 1 &&
      acceptedInitialLogLengths[0] === 0 &&
      acceptedInitialLogLengths[1] === 0 &&
      acceptedRematch.hostOnline.lastResumeReplayMatched === null &&
      acceptedRematch.guestOnline.lastResumeReplayMatched === null,
    `재대결 수락 뒤 턴 0 준비가 다릅니다: id=${acceptedRematch.hostOnline.matchId}/${acceptedRematch.guestOnline.matchId}, turn=${acceptedRematch.hostOnline.nextTurnIndex}/${acceptedRematch.guestOnline.nextTurnIndex}, prepared=${acceptedRematch.counters.hostPrepared}/${acceptedRematch.counters.guestPrepared}`,
  );
  for (let turnIndex = 0; turnIndex < 4; turnIndex += 1) {
    const localRuntime =
      acceptedRematch.host.turnRuntime.currentSide === "white"
        ? acceptedRematch.host
        : acceptedRematch.guest;
    const localOnline =
      acceptedRematch.host.turnRuntime.currentSide === "white"
        ? acceptedRematch.hostOnline
        : acceptedRematch.guestOnline;
    const queued = localOnline.queueLocalLaunch(
      createScriptedRequest(localRuntime, turnIndex),
    );
    assertCondition(
      queued.accepted,
      `재대결 뒤 ${turnIndex}번 발사가 거절됐습니다: ${queued.reason}`,
    );
    settlePair(
      modules,
      acceptedRematch.host,
      acceptedRematch.guest,
      acceptedRematch.hostOnline,
      acceptedRematch.guestOnline,
    );
    await Promise.all([
      acceptedRematch.hostOnline.flush(),
      acceptedRematch.guestOnline.flush(),
    ]);
  }
  const acceptedFinalHost =
    await stateHash.capturePhysicsStateHash(
      acceptedRematch.host.physicsRuntime,
    );
  const acceptedFinalGuest =
    await stateHash.capturePhysicsStateHash(
      acceptedRematch.guest.physicsRuntime,
    );
  assertCondition(
    acceptedFinalHost.sha256 === acceptedFinalGuest.sha256 &&
      acceptedRematch.hostOnline.desyncCount === 0 &&
      acceptedRematch.guestOnline.desyncCount === 0 &&
      acceptedRematch.hostOnline.nextTurnIndex === 4 &&
      acceptedRematch.guestOnline.nextTurnIndex === 4,
    `재대결 뒤 4수 동기화 실패: hash=${acceptedFinalHost.sha256}/${acceptedFinalGuest.sha256}, desync=${acceptedRematch.hostOnline.desyncCount}/${acceptedRematch.guestOnline.desyncCount}`,
  );
  console.log(
    `[통과 l] 재대결 요청→수락: matchId=${acceptedRematch.hostOnline.matchId}, active=${acceptedRematch.hostOnline.active}/${acceptedRematch.guestOnline.active}, turn=0→4, freshLog=${acceptedInitialLogLengths.join("/")}, initialHash=${acceptedInitialHost.sha256}, finalHash=${acceptedFinalHost.sha256}, desync=0/0`,
  );
  closeRematchPair(acceptedRematch);

  const declinedRematch = await createRematchCheckPair(
    modules,
    meta,
    "decline",
  );
  const declinedMatchId = declinedRematch.hostOnline.matchId;
  declinedRematch.hostOnline.offerRematch();
  declinedRematch.guestOnline.respondRematch(false);
  assertCondition(
    declinedRematch.hostOnline.matchId === declinedMatchId &&
      declinedRematch.guestOnline.matchId === declinedMatchId &&
      declinedRematch.host.turnRuntime.phase === "match-over" &&
      declinedRematch.guest.turnRuntime.phase === "match-over" &&
      declinedRematch.hostOnline.getRematchStatus().phase ===
        "declined" &&
      declinedRematch.counters.hostPrepared === 0 &&
      declinedRematch.counters.guestPrepared === 0,
    "재대결 거절 뒤 이전 결과나 매치 ID가 보존되지 않았습니다.",
  );
  declinedRematch.hostOnline.offerRematch();
  const secondOffer =
    declinedRematch.guestOnline.getRematchStatus();
  assertCondition(
    secondOffer.phase === "incoming" &&
      secondOffer.offerId === "white-2",
    `거절 뒤 두 번째 요청이 열리지 않았습니다: ${JSON.stringify(secondOffer)}`,
  );
  declinedRematch.hostOnline.cancelRematch();
  console.log(
    `[통과 m] 재대결 거절: matchId=${declinedMatchId} 유지, phase=match-over/match-over, 두 번째 offerId=white-2`,
  );
  closeRematchPair(declinedRematch);

  const simultaneousRematch = await createRematchCheckPair(
    modules,
    meta,
    "simultaneous",
  );
  simultaneousRematch.transports.host.deferMessages = true;
  simultaneousRematch.transports.guest.deferMessages = true;
  simultaneousRematch.hostOnline.offerRematch();
  simultaneousRematch.guestOnline.offerRematch();
  simultaneousRematch.transports.host.deferMessages = false;
  simultaneousRematch.transports.guest.deferMessages = false;
  simultaneousRematch.transports.host.flushDeferred();
  simultaneousRematch.transports.guest.flushDeferred();
  await flushRematchPair(simultaneousRematch);
  const simultaneousHostHash =
    await stateHash.capturePhysicsStateHash(
      simultaneousRematch.host.physicsRuntime,
    );
  const simultaneousGuestHash =
    await stateHash.capturePhysicsStateHash(
      simultaneousRematch.guest.physicsRuntime,
    );
  assertCondition(
    simultaneousRematch.hostOnline.matchId ===
      "rematch-white-1" &&
      simultaneousRematch.guestOnline.matchId ===
        "rematch-white-1" &&
      simultaneousRematch.hostOnline.nextTurnIndex === 0 &&
      simultaneousRematch.guestOnline.nextTurnIndex === 0 &&
      simultaneousHostHash.sha256 ===
        simultaneousGuestHash.sha256 &&
      simultaneousRematch.counters.hostPrepared === 1 &&
      simultaneousRematch.counters.guestPrepared === 1 &&
      simultaneousRematch.counters.hostStarted === 1 &&
      simultaneousRematch.counters.guestStarted === 1,
    `동시 재대결 요청이 하나의 방장 요청으로 합쳐지지 않았습니다: id=${simultaneousRematch.hostOnline.matchId}/${simultaneousRematch.guestOnline.matchId}, prepared=${simultaneousRematch.counters.hostPrepared}/${simultaneousRematch.counters.guestPrepared}, started=${simultaneousRematch.counters.hostStarted}/${simultaneousRematch.counters.guestStarted}`,
  );
  console.log(
    `[통과 n] 동시 재대결 요청: winnerOffer=white-1, matchId=rematch-white-1, reset=1/1, turn=0, hash=${simultaneousHostHash.sha256}`,
  );
  closeRematchPair(simultaneousRematch);

  const disconnectedRematch = await createRematchCheckPair(
    modules,
    meta,
    "disconnect",
  );
  const disconnectedMatchId =
    disconnectedRematch.hostOnline.matchId;
  disconnectedRematch.transports.host.close();
  disconnectedRematch.hostOnline.terminate();
  let disconnectReason = "";
  try {
    disconnectedRematch.hostOnline.offerRematch();
  } catch (error) {
    disconnectReason =
      error instanceof Error ? error.message : String(error);
  }
  assertCondition(
    disconnectReason ===
      "상대 연결이 끊겨 재대결을 요청할 수 없습니다." &&
      disconnectedRematch.hostOnline.matchId ===
        disconnectedMatchId &&
      disconnectedRematch.counters.hostPrepared === 0 &&
      disconnectedRematch.counters.guestPrepared === 0,
    `단절 종료 뒤 재대결이 명확히 거절되지 않았습니다: reason=${disconnectReason}, id=${disconnectedRematch.hostOnline.matchId}`,
  );
  console.log(
    `[통과 o] 연결 단절 종료 뒤 재대결 거절: reason="${disconnectReason}", newMatch=false`,
  );
  closeRematchPair(disconnectedRematch);
} finally {
  await vite.close();
}
