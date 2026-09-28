import "./headless-browser-env.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// Headless DOM mock for tuning panel controls
class MockHTMLElement {
  children = [];
  className = "";
  hidden = false;
  textContent = "";
  innerHTML = "";
  style = {};
  dataset = {};
  classList = {
    _classes: new Set(),
    add(c) { this._classes.add(c); },
    remove(c) { this._classes.delete(c); },
    contains(c) { return this._classes.has(c); },
  };
  append(...nodes) {
    this.children.push(...nodes);
  }
  appendChild(node) {
    this.children.push(node);
    return node;
  }
  querySelector(selector) {
    for (const child of this.children) {
      if (child.dataset && selector === "[data-tuning-reset]" && "tuningReset" in child.dataset) {
        return child;
      }
      if (child.querySelector) {
        const found = child.querySelector(selector);
        if (found) return found;
      }
    }
    return null;
  }
  addEventListener() {}
  removeEventListener() {}
}

class MockHTMLInputElement extends MockHTMLElement {
  type = "";
  value = "";
  disabled = false;
  min = "";
  max = "";
  step = "";
}

class MockHTMLOutputElement extends MockHTMLElement {
  value = "";
}

class MockHTMLButtonElement extends MockHTMLElement {
  type = "button";
  disabled = false;
}

class MockHTMLParagraphElement extends MockHTMLElement {}

globalThis.HTMLElement = MockHTMLElement;
globalThis.HTMLInputElement = MockHTMLInputElement;
globalThis.HTMLOutputElement = MockHTMLOutputElement;
globalThis.HTMLButtonElement = MockHTMLButtonElement;
globalThis.HTMLParagraphElement = MockHTMLParagraphElement;

function createMockElement(tag) {
  switch (tag.toLowerCase()) {
    case "input":
      return new MockHTMLInputElement();
    case "output":
      return new MockHTMLOutputElement();
    case "button":
      return new MockHTMLButtonElement();
    case "p":
      return new MockHTMLParagraphElement();
    default:
      return new MockHTMLElement();
  }
}

globalThis.document = {
  ...globalThis.document,
  createElement: (tag) => createMockElement(tag),
};
globalThis.window.location = { search: "" };

const webRoot = fileURLToPath(new URL("../..", import.meta.url));
const vite = await createServer({
  root: webRoot,
  configFile: false,
  logLevel: "error",
  appType: "custom",
  server: { middlewareMode: true },
});

try {
  const [config, physics, tuning, layout] = await Promise.all([
    vite.ssrLoadModule("/src/config.ts"),
    vite.ssrLoadModule("/src/physics.ts"),
    vite.ssrLoadModule("/src/tuning.ts"),
    vite.ssrLoadModule("/src/layout.ts"),
  ]);

  const meta = JSON.parse(
    await readFile(
      new URL("../../public/assets/chess-set.meta.json", import.meta.url),
      "utf8",
    ),
  );

  const baseHalfExtent = config.deriveBoardHalfExtent(meta.cellSize);

  // 1. Config 상수 및 헬퍼 검증
  assert.equal(config.PIECE_FRICTION, 0.05, "기본 PIECE_FRICTION은 0.05 유지");
  assert.equal(config.CLASSIC_FRICTION, 0.2, "온라인 임시 CLASSIC_FRICTION은 0.2");
  assert.equal(config.getPieceFriction("online"), 0.2, "online 모드 friction은 0.2");
  assert.equal(config.getPieceFriction("hotseat"), 0.05, "hotseat 모드 friction은 0.05");
  assert.equal(config.getPieceFriction("stage"), 0.05, "stage 모드 friction은 0.05");
  assert.equal(config.getPieceFriction("weekly"), 0.05, "weekly 모드 friction은 0.05");
  assert.equal(config.getPieceFriction(), 0.05, "기본 friction은 0.05");

  console.log("PASS [1/5] config: PIECE_FRICTION=0.05, CLASSIC_FRICTION=0.2, getPieceFriction mode mapping");

  // 2. 실제 Rapier 온라인 물리 런타임 생성 검증 (보드 + 기물 콜라이더)
  const onlineRuntime = await physics.createPhysicsRuntime(
    meta,
    layout.PIECE_INSTANCES,
    baseHalfExtent,
    { gameMode: "online", stageNumber: 1 },
  );

  assert.ok(onlineRuntime.boardColliders.length > 0, "보드 콜라이더 존재");
  for (const [idx, collider] of onlineRuntime.boardColliders.entries()) {
    assert.ok(
      Math.abs(collider.friction() - 0.2) < 1e-5,
      `온라인 보드 콜라이더 ${idx} 마찰값은 0.2여야 함: ${collider.friction()}`,
    );
  }

  assert.equal(onlineRuntime.pieces.size, 32, "말 32개 생성");
  for (const [id, binding] of onlineRuntime.pieces.entries()) {
    assert.ok(
      Math.abs(binding.collider.friction() - 0.2) < 1e-5,
      `온라인 말 ${id} 마찰값은 0.2여야 함: ${binding.collider.friction()}`,
    );
  }

  console.log("PASS [2/5] online createPhysicsRuntime: board (0.2) & all 32 pieces (0.2)");

  // 3. 실제 Rapier 온라인 리셋 (resetPhysicsPieces) 검증
  physics.resetPhysicsPieces(
    onlineRuntime,
    meta,
    layout.PIECE_INSTANCES,
    { gameMode: "online", stageNumber: 1 },
  );

  assert.equal(onlineRuntime.pieces.size, 32, "리셋 후 말 32개 유지");
  for (const [id, binding] of onlineRuntime.pieces.entries()) {
    assert.ok(
      Math.abs(binding.collider.friction() - 0.2) < 1e-5,
      `리셋 후 온라인 말 ${id} 마찰값은 0.2여야 함: ${binding.collider.friction()}`,
    );
  }

  console.log("PASS [3/5] online resetPhysicsPieces: all 32 pieces recreated with friction 0.2");

  // 4. 타 모드 (hotseat, stage, weekly) 기존 기본값 (0.05) 보존 검증
  const hotseatRuntime = await physics.createPhysicsRuntime(
    meta,
    layout.PIECE_INSTANCES,
    baseHalfExtent,
    { gameMode: "hotseat", stageNumber: 1 },
  );
  for (const collider of hotseatRuntime.boardColliders) {
    assert.ok(Math.abs(collider.friction() - 0.05) < 1e-5, "hotseat 보드 마찰값 0.05");
  }
  for (const binding of hotseatRuntime.pieces.values()) {
    assert.ok(Math.abs(binding.collider.friction() - 0.05) < 1e-5, "hotseat 말 마찰값 0.05");
  }

  const stageRuntime = await physics.createPhysicsRuntime(
    meta,
    layout.PIECE_INSTANCES,
    baseHalfExtent,
    { gameMode: "stage", stageNumber: 1 },
  );
  for (const collider of stageRuntime.boardColliders) {
    assert.ok(Math.abs(collider.friction() - 0.05) < 1e-5, "stage 보드 마찰값 0.05");
  }
  for (const binding of stageRuntime.pieces.values()) {
    assert.ok(Math.abs(binding.collider.friction() - 0.05) < 1e-5, "stage 말 마찰값 0.05");
  }

  const weeklyRuntime = await physics.createPhysicsRuntime(
    meta,
    layout.PIECE_INSTANCES,
    baseHalfExtent,
    { gameMode: "weekly", stageNumber: 1 },
  );
  for (const collider of weeklyRuntime.boardColliders) {
    assert.ok(Math.abs(collider.friction() - 0.05) < 1e-5, "weekly 보드 마찰값 0.05");
  }
  for (const binding of weeklyRuntime.pieces.values()) {
    assert.ok(Math.abs(binding.collider.friction() - 0.05) < 1e-5, "weekly 말 마찰값 0.05");
  }

  physics.resetPhysicsPieces(
    weeklyRuntime,
    meta,
    layout.PIECE_INSTANCES,
    { gameMode: "weekly", stageNumber: 1 },
  );
  for (const binding of weeklyRuntime.pieces.values()) {
    assert.ok(Math.abs(binding.collider.friction() - 0.05) < 1e-5, "weekly 리셋 후 말 마찰값 0.05");
  }

  console.log("PASS [4/5] non-online modes preserved: hotseat/stage/weekly default 0.05 on create & reset");

  // 5. 손맛 조절판 모드 전환, 덮어쓰기 방지 및 로컬 설정 복원 검증
  const container = createMockElement("div");
  const tuningRuntime = tuning.createTuningRuntime(container, hotseatRuntime, null);

  assert.equal(tuningRuntime.onlineDefaultsActive, false, "초기 로컬 모드에서 onlineDefaultsActive는 false");
  assert.equal(tuningRuntime.settings.friction, 0.05, "초기 로컬 기본 마찰값 0.05");

  // 사용자가 로컬 설정을 0.35로 변경하여 저장했다고 가정
  tuning.setTuningValue(tuningRuntime, "friction", 0.35, true);
  assert.equal(tuningRuntime.localSettings.friction, 0.35, "로컬 설정 0.35 보존");
  assert.equal(tuningRuntime.settings.friction, 0.35, "현재 설정 0.35 적용");

  // online으로 전환
  tuning.setTuningGameMode(tuningRuntime, "online");
  assert.equal(tuningRuntime.onlineDefaultsActive, true, "온라인 전환 시 onlineDefaultsActive true");
  assert.equal(tuningRuntime.settings.friction, 0.2, "온라인 전환 시 friction 0.2 적용");
  for (const collider of hotseatRuntime.boardColliders) {
    assert.ok(Math.abs(collider.friction() - 0.2) < 1e-5, "보드 콜라이더 0.2 반영");
  }
  for (const binding of hotseatRuntime.pieces.values()) {
    assert.ok(Math.abs(binding.collider.friction() - 0.2) < 1e-5, "말 콜라이더 0.2 반영");
  }

  // reapplyTuningPhysicsSettings 또는 0.05 덮어쓰기 시도 차단 검증
  tuning.reapplyTuningPhysicsSettings(tuningRuntime);
  assert.equal(tuningRuntime.settings.friction, 0.2, "온라인에서 reapply 후에도 0.2 유지");
  for (const collider of hotseatRuntime.boardColliders) {
    assert.ok(Math.abs(collider.friction() - 0.2) < 1e-5, "reapply 후 보드 0.2 유지");
  }

  // online -> weekly 전환 (onlineDefaultsActive 공유하지만 weekly는 기본 0.05여야 함)
  // 앱에서는 설정을 먼저 전환하므로 이 순간 물리 월드는 아직 online이다.
  hotseatRuntime.gameMode = "online";
  tuning.setTuningGameMode(tuningRuntime, "weekly");
  assert.equal(tuningRuntime.onlineDefaultsActive, true, "weekly 모드에서도 onlineDefaultsActive true");
  assert.equal(tuningRuntime.settings.friction, 0.05, "weekly 모드 friction은 0.05로 복귀");
  for (const collider of hotseatRuntime.boardColliders) {
    assert.ok(Math.abs(collider.friction() - 0.05) < 1e-5, "weekly 보드 콜라이더 0.05 복귀");
  }
  for (const binding of hotseatRuntime.pieces.values()) {
    assert.ok(Math.abs(binding.collider.friction() - 0.05) < 1e-5, "weekly 말 콜라이더 0.05 복귀");
  }

  // weekly -> online 재전환
  hotseatRuntime.gameMode = "weekly";
  tuning.setTuningGameMode(tuningRuntime, "online");
  assert.equal(tuningRuntime.onlineDefaultsActive, true, "online 재전환 시 onlineDefaultsActive true");
  assert.equal(tuningRuntime.settings.friction, 0.2, "online 재전환 시 friction 0.2 적용");
  for (const collider of hotseatRuntime.boardColliders) {
    assert.ok(Math.abs(collider.friction() - 0.2) < 1e-5, "online 재전환 보드 0.2");
  }

  // online -> hotseat 로컬 복귀 시 사용자 저장 설정 (0.35) 복원 검증
  hotseatRuntime.gameMode = "online";
  tuning.setTuningGameMode(tuningRuntime, "hotseat");
  assert.equal(tuningRuntime.onlineDefaultsActive, false, "로컬 복귀 시 onlineDefaultsActive false");
  assert.equal(tuningRuntime.settings.friction, 0.35, "로컬 사용자 설정 0.35 복원");
  for (const collider of hotseatRuntime.boardColliders) {
    assert.ok(Math.abs(collider.friction() - 0.35) < 1e-5, "로컬 보드 0.35 복원");
  }
  for (const binding of hotseatRuntime.pieces.values()) {
    assert.ok(Math.abs(binding.collider.friction() - 0.35) < 1e-5, "로컬 말 0.35 복원");
  }

  console.log("PASS [5/5] tuning: online (0.2) ↔ weekly (0.05) ↔ online (0.2) transitions & local persistence restore (0.35)");

  // 같은 크기의 보드를 재사용하는 경로와 물리 기물만 리셋하는 경로도 모드를 따른다.
  physics.rebuildPhysicsBoard(onlineRuntime, meta, baseHalfExtent, { gameMode: "hotseat", stageNumber: 1 });
  assert.ok(onlineRuntime.boardColliders.every(c => Math.abs(c.friction() - 0.05) < 1e-6));
  physics.resetPhysicsPieces(onlineRuntime, meta, layout.PIECE_INSTANCES, { gameMode: "online", stageNumber: 1 });
  assert.ok(onlineRuntime.boardColliders.every(c => Math.abs(c.friction() - 0.2) < 1e-6));
  physics.preSettlePhysics(onlineRuntime);
  physics.resetPhysicsPieces(onlineRuntime, meta, layout.PIECE_INSTANCES, { gameMode: "weekly", stageNumber: 1 });
  assert.ok(onlineRuntime.boardColliders.every(c => Math.abs(c.friction() - 0.05) < 1e-6));

  for (const runtime of [onlineRuntime, hotseatRuntime, stageRuntime, weeklyRuntime]) runtime.world.free();

  console.log("\nALL CLASSIC FRICTION CHECKS PASSED!");
} finally {
  await vite.close();
}
