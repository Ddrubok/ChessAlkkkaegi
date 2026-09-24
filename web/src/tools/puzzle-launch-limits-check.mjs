import "./headless-browser-env.mjs";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// 앱 모듈은 확장자 없는 import를 쓰므로 Node로 직접 불러오지 않고 Vite로 불러온다.
const vite = await createServer({
  root: fileURLToPath(new URL("../..", import.meta.url)),
  configFile: false,
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
});
const { queueTurnLaunch } = await vite.ssrLoadModule("/src/turn.ts");

const PIECE_ID = "limits-check-piece";

function makeRuntime(type, gameMode = "puzzle") {
  const body = {
    worldCom: () => ({ x: 0, y: 0, z: 0 }),
    translation: () => ({ x: 0, y: 0, z: 0 }),
    isFixed: () => false,
    isSleeping: () => true,
    isDynamic: () => true,
  };
  const instance = {
    id: PIECE_ID,
    type,
    side: "white",
    color: "white",
    removed: false,
    isRemoved: false,
  };
  return {
    gameMode,
    currentSide: "white",
    physicsRuntime: { pieces: new Map([[PIECE_ID, { instance, body }]]) },
    pendingLaunch: null,
    phase: "ready",
    pendingTurnChange: false,
    restHoldSeconds: 0,
    settleSeconds: 0,
    forcedSettleCountedForCurrentSettle: false,
    pendingRemovalIds: new Set(),
    onLaunchAccepted: null,
  };
}

function request(power, applicationPoint = { x: 0, y: 0, z: 0 }) {
  return {
    pieceId: PIECE_ID,
    direction: { x: 0, y: 0, z: 1 },
    normalizedPower: power,
    applicationPoint,
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertRejected(runtime, result, label) {
  assert(!result.accepted, `${label}: expected rejection`);
  assert(runtime.pendingLaunch === null, `${label}: pendingLaunch mutated`);
  assert(runtime.phase === "ready", `${label}: phase mutated`);
}

const pawnRuntime = makeRuntime("Pawn");
assertRejected(
  pawnRuntime,
  queueTurnLaunch(pawnRuntime, request(1.27)),
  "puzzle Pawn power 1.27",
);

const rookCenterRuntime = makeRuntime("Rook");
const rookCenterResult = queueTurnLaunch(
  rookCenterRuntime,
  request(1.5),
);
assert(rookCenterResult.accepted, "puzzle Rook COM power 1.5: expected acceptance");
assert(rookCenterRuntime.pendingLaunch?.normalizedPower === 1.5, "Rook power changed");
assert(rookCenterRuntime.phase === "settling", "accepted Rook phase not settling");

const rookCustomRuntime = makeRuntime("Rook");
assertRejected(
  rookCustomRuntime,
  queueTurnLaunch(rookCustomRuntime, request(1.27, { x: 0.1, y: 0, z: 0 })),
  "puzzle Rook custom point power 1.27",
);

const rookOverRuntime = makeRuntime("Rook");
assertRejected(
  rookOverRuntime,
  queueTurnLaunch(rookOverRuntime, request(1.500001)),
  "puzzle Rook power above 1.5",
);

for (const gameMode of ["stage", "hotseat"]) {
  const runtime = makeRuntime("Pawn", gameMode);
  const result = queueTurnLaunch(runtime, request(1.27));
  assert(result.accepted, `${gameMode} Pawn power 1.27 unexpectedly rejected`);
  assert(runtime.pendingLaunch?.normalizedPower === 1.27, `${gameMode} power changed`);
}

console.log(
  JSON.stringify({
    status: "PASS",
    checks: [
      "puzzle Pawn 1.27 rejected without state mutation",
      "puzzle Rook COM 1.5 accepted",
      "puzzle Rook custom point 1.27 rejected without state mutation",
      "puzzle Rook >1.5 rejected without state mutation",
      "stage/hotseat Pawn handling unchanged",
    ],
  }),
);
await vite.close();
