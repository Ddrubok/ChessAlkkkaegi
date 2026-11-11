import './headless-browser-env.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { Mesh, Quaternion, Scene, Vector3 } from 'three';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../..', import.meta.url));
const output = fileURLToPath(new URL('../../../qa/itch-feedback-2026-11-11/physics-results.json', import.meta.url));
const meta = JSON.parse(await readFile(new URL('../../public/assets/chess-set.meta.json', import.meta.url), 'utf8'));
const vite = await createServer({ root, configFile: false, logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, ws: false } });
const round = (n) => Number(n.toFixed(5));
const xyz = (v) => ({ x: round(v.x), y: round(v.y), z: round(v.z) });
const len = (v) => Math.hypot(v.x, v.y, v.z);
const horizontal = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

try {
  const physics = await vite.ssrLoadModule('/src/physics.ts');
  const turn = await vite.ssrLoadModule('/src/turn.ts');
  const config = await vite.ssrLoadModule('/src/config.ts');
  const stage = await vite.ssrLoadModule('/src/stage.ts');
  const walls = await vite.ssrLoadModule('/src/walls.ts');
  const { PIECE_INSTANCES } = await vite.ssrLoadModule('/src/layout.ts');
  const cards = await vite.ssrLoadModule('/src/cards.ts');
  const { finalCardValues } = await vite.ssrLoadModule('/src/feedback-card-preview.ts');
  const pawn = PIECE_INSTANCES.find((p) => p.type === 'Pawn' && p.side === 'white');
  if (!pawn) throw Error('No white Pawn fixture');

  async function runtimeFor(stageNumber) {
    const options = { gameMode: 'stage', stageNumber };
    const runtime = await physics.createPhysicsRuntime(meta, [pawn], config.deriveBoardHalfExtent(meta.cellSize), options);
    const binding = runtime.pieces.get(pawn.id);
    const scene = { scene: new Scene(), controls: { enabled: true }, pieceMeshes: new Map([[pawn.id, new Mesh()]]), breakableWallMeshes: new Map() };
    const turns = turn.createTurnRuntime(runtime, scene, { maxLaunchSpeed: config.MAX_LAUNCH_SPEED, strikeHeightRatio: 0 });
    turn.setTurnGameMode(turns, 'stage');
    return { runtime, binding, turns };
  }
  function pose(binding, runtime, angleDeg, x, z, lift = 0.002) {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), angleDeg * Math.PI / 180);
    const minY = Math.min(...meta.pieces.Pawn.colliderPoints.map(([px, py, pz]) => new Vector3(px, py, pz).multiplyScalar(binding.uniformScale).applyQuaternion(q).y));
    binding.body.setRotation(q, true);
    binding.body.setTranslation({ x, y: runtime.boardTop - minY + lift, z }, true);
    binding.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    binding.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    binding.body.enableCcd(false);
    // A 45-degree Pawn cannot rest statically; retain that transient pose for the launch.
    for (let i = 0; i < (angleDeg === 45 ? 0 : 90); i++) runtime.world.step();
    binding.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    binding.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
  function shoot(turns, binding, power, surface, direction = new Vector3(1, 0, 0)) {
    const com = binding.body.worldCom();
    const point = new Vector3(com.x, com.y, com.z);
    if (surface) {
      const origin = binding.body.translation(); const q = binding.body.rotation();
      const rotation = new Quaternion(q.x, q.y, q.z, q.w);
      const hull = meta.pieces.Pawn.colliderPoints.map(([x, y, z]) => new Vector3(x, y, z).multiplyScalar(binding.uniformScale).applyQuaternion(rotation).add(new Vector3(origin.x, origin.y, origin.z)));
      hull.sort((a, b) => b.y - a.y || Math.abs(a.z - com.z) - Math.abs(b.z - com.z));
      point.copy(hull[0]);
    }
    const before = binding.body.linvel();
    turns.pendingLaunch = { pieceId: binding.instance.id, direction, normalizedPower: power, applicationPoint: point, speedMultiplier: 1 };
    const oldInfo = console.info; console.info = () => {};
    let applied;
    try { applied = turn.applyPendingLaunchBeforeStep(turns); } finally { console.info = oldInfo; }
    if (!applied) throw Error('Actual launch rejected');
    const after = binding.body.linvel();
    return { target: round(config.getMaxLaunchSpeed('stage', 'Pawn', config.MAX_LAUNCH_SPEED) * power), deltaV: round(Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z)), initialAngular: round(len(binding.body.angvel())) };
  }
  const posture = [];
  for (const [label, angle] of [['upright', 0], ['tilted', 45], ['prone', 90]]) {
    for (const power of [0.25, 0.5, 1]) for (const surface of [false, true]) {
      const { runtime, binding, turns } = await runtimeFor(1);
      try {
        pose(binding, runtime, angle, -runtime.boardHalfExtent * 0.55, 0);
        const initial = binding.body.translation();
        const actualAngle = 2 * Math.acos(Math.min(1, Math.abs(binding.body.rotation().w))) * 180 / Math.PI;
        const launch = shoot(turns, binding, power, surface);
        const at = [];
        let quietAt = null;
        for (let step = 1; step <= 240; step++) {
          runtime.world.step();
          physics.scanBreakableWallContacts(runtime);
          physics.applyPendingBreakableWallDestructions(runtime);
          if (step === 60 || step === 120 || step === 240) at.push({ step, position: xyz(binding.body.translation()), speed: round(len(binding.body.linvel())), angular: round(len(binding.body.angvel())) });
          if (quietAt === null && len(binding.body.linvel()) < config.REST_LINEAR_EPS && len(binding.body.angvel()) < config.REST_ANGULAR_EPS) quietAt = step;
        }
        posture.push({ label, requestedAngleDeg: angle, settledAngleDeg: round(actualAngle), power, strike: surface ? 'upper hull vertex' : 'center of mass', initial: xyz(initial), ...launch, distance1s: round(horizontal(initial, at[1].position)), distance2s: round(horizontal(initial, at[2].position)), quietAtStep: quietAt, samples: at });
      } finally { runtime.world.free(); }
    }
  }

  const wallTests = [];
  for (const stageNumber of [3, 4, 5, 6, 7, 8]) {
    const { runtime, binding, turns } = await runtimeFor(stageNumber);
    try {
      const definitions = stageNumber <= 6 ? walls.computeBreakableWallSegments(runtime.boardHalfExtent, runtime.boardTop, meta.cellSize) : [...runtime.breakableWalls.values()].map((w) => w.definition);
      const geometryMatches = definitions.every((d) => {
        const w = runtime.breakableWalls.get(d.id);
        const t = w?.body.translation(); const h = w?.collider.halfExtents();
        return !!w && Math.abs(t.x - d.center.x) < 1e-6 && Math.abs(t.y - d.center.y) < 1e-6 && Math.abs(t.z - d.center.z) < 1e-6 && Math.abs(h.x - d.halfExtents.x) < 1e-6 && Math.abs(h.y - d.halfExtents.y) < 1e-6 && Math.abs(h.z - d.halfExtents.z) < 1e-6;
      });
      const target = definitions.find((d) => d.side === 'east' && d.sideIndex === 3) ?? definitions.find((d) => d.side === 'east');
      const contacts = [], destructions = [], rawContactSteps = [];
      for (let pass = 1; pass <= 2; pass++) {
        pose(binding, runtime, 0, target.center.x - 0.48, target.center.z);
        // A fresh approach uses the same production impulse path and contact scan.
        shoot(turns, binding, 0.5, false);
        for (let step = 1; step <= 120; step++) {
          runtime.world.step();
          const activeWall = runtime.breakableWalls.get(target.id);
          if (activeWall) runtime.world.contactPair(binding.collider, activeWall.collider, (manifold) => { if (manifold.numSolverContacts() > 0) rawContactSteps.push({ pass, step }); });
          const hits = physics.scanBreakableWallContacts(runtime).filter((h) => h.wallId === target.id);
          if (hits.length) contacts.push(...hits.map((h) => ({ pass, step, hitCount: h.hitCount })));
          const removed = physics.applyPendingBreakableWallDestructions(runtime);
          if (removed.includes(target.id)) destructions.push({ pass, step });
        }
        // Move away and take one physics step so a second approach is a new contact.
        binding.body.setTranslation({ x: 0, y: runtime.boardTop + 1, z: 0 }, true);
        runtime.world.step(); physics.scanBreakableWallContacts(runtime);
      }
      wallTests.push({ stageNumber, variant: target.variant, count: definitions.length, boardHalfExtent: round(runtime.boardHalfExtent), wallHeight: round(target.halfExtents.y * 2), wallThickness: round(Math.min(target.halfExtents.x, target.halfExtents.z) * 2), geometryMatches, targetId: target.id, targetHitCount: runtime.breakableWalls.get(target.id)?.hitCount ?? null, targetDestroyed: runtime.destroyedBreakableWallIds.has(target.id), rawContactSteps, contacts, destructions, otherDestroyed: [...runtime.destroyedBreakableWallIds].filter((id) => id !== target.id) });
    } finally { runtime.world.free(); }
  }
  const boundaryTrials = [];
  for (const kind of ['seam', 'elevated', 'level']) {
    const { runtime, binding, turns } = await runtimeFor(3);
    try {
      const east3 = runtime.breakableWalls.get('wall-east-3').definition;
      const east4 = runtime.breakableWalls.get('wall-east-4').definition;
      const z = kind === 'seam' ? (east3.center.z + east4.center.z) / 2 : east3.center.z;
      pose(binding, runtime, 0, east3.center.x - 0.48, z);
      const direction = kind === 'elevated' ? new Vector3(1, 0.7, 0).normalize() : new Vector3(1, 0, 0);
      const start = xyz(binding.body.translation());
      shoot(turns, binding, 0.5, false, direction);
      const contacts = [], samples = [];
      for (let step = 1; step <= 40; step++) {
        runtime.world.step();
        contacts.push(...physics.scanBreakableWallContacts(runtime).map((h) => ({ step, wall: h.wallId, hitCount: h.hitCount })));
        physics.applyPendingBreakableWallDestructions(runtime);
        if ([5, 8, 10, 20, 40].includes(step)) samples.push({ step, position: xyz(binding.body.translation()) });
      }
      boundaryTrials.push({ kind, start, direction: xyz(direction), seamOverlap: round(east3.center.z + east3.halfExtents.z - (east4.center.z - east4.halfExtents.z)), contacts, samples });
    } finally { runtime.world.free(); }
  }
  const blackPawn = PIECE_INSTANCES.find((p) => p.type === 'Pawn' && p.side === 'black');
  const difficulty = [4, 5, 6].map((n) => { const options = { gameMode: 'stage', stageNumber: n }; return { stage: n, buffs: stage.computeStageBuffs(n), enemySize: round(stage.computeEnemyStageSizeMultiplier(n)), enemyPawnScale: round(stage.computeStagePieceScale(blackPawn, meta, options)), enemyWeightFraction: round(stage.computeUpgradeWeightFraction(blackPawn, options)), enemyAiSpeed: round(stage.computeStageAiSpeedMultiplier(options)), boardHalfExtent: round(stage.computeStageBoardHalfExtent(meta.cellSize, 'stage', n)), breakableWalls: walls.hasBreakableWalls('stage', n) }; });
  assert.equal(posture.length, 18);
  for (const row of posture) assert.ok(Math.abs(row.deltaV - row.target) < 0.001);
  for (const row of wallTests) {
    assert.ok(row.geometryMatches);
    assert.ok(row.rawContactSteps.length > 0);
    if (row.variant === 'breakable') { assert.deepEqual(row.contacts.map((c) => c.hitCount), [1, 2]); assert.equal(row.targetDestroyed, true); }
    else { assert.equal(row.targetDestroyed, false); assert.equal(row.targetHitCount, 0); }
  }
  const cardPreviews = [];
  for (const id of ['size', 'weight', 'force']) for (const grade of [1, 2, 5]) {
    const beforeCards=cards.createRunCardState();
    for(let n=0;n<grade-1;n++) cards.applyCardPick(beforeCards,id);
    const afterCards=cards.cloneRunCardState(beforeCards);cards.applyCardPick(afterCards,id);
    const options={gameMode:'stage',stageNumber:2};
    const previous=await physics.createPhysicsRuntime(meta,[pawn],config.deriveBoardHalfExtent(meta.cellSize),{...options,runCards:beforeCards});
    const next=await physics.createPhysicsRuntime(meta,[pawn],config.deriveBoardHalfExtent(meta.cellSize),{...options,runCards:afterCards});
    try {
      const binding=next.pieces.get(pawn.id);binding.body.recomputeMassPropertiesFromColliders();
      const displayed=finalCardValues(id,beforeCards,afterCards,options,meta,previous.pieces.values(),config.MAX_LAUNCH_SPEED,false).find(row=>row.piece==='Pawn');
      assert.ok(displayed);
      let actual;
      if(id==='size') actual=binding.uniformScale;
      else if(id==='weight') actual=binding.body.mass();
      else {
        const scene={scene:new Scene(),controls:{enabled:true},pieceMeshes:new Map([[pawn.id,new Mesh()]]),breakableWallMeshes:new Map()};
        const turns=turn.createTurnRuntime(next,scene,{maxLaunchSpeed:config.MAX_LAUNCH_SPEED,strikeHeightRatio:0});turn.setTurnGameMode(turns,'stage');
        binding.body.setLinvel({x:0,y:0,z:0},true);
        turns.pendingLaunch={pieceId:pawn.id,direction:new Vector3(1,0,0),normalizedPower:1,applicationPoint:new Vector3().copy(binding.body.worldCom()),speedMultiplier:cards.computePlayerLaunchSpeedMultiplier('stage',afterCards,0)};
        assert.ok(turn.applyPendingLaunchBeforeStep(turns));actual=len(binding.body.linvel());
      }
      assert.ok(Math.abs(displayed.after-actual)<1e-5,`${id} grade ${grade}: preview ${displayed.after}, actual ${actual}`);
      cardPreviews.push({id,grade,displayed:round(displayed.after),actual:round(actual)});
    }finally{previous.world.free();next.world.free();}
  }
  const result = { generatedAt: new Date().toISOString(), source: 'live Vite-loaded project physics/turn/walls/stage modules and chess-set.meta.json; no UI import replacements', fixedStep: config.FIXED_STEP, timeScale: config.TIME_SCALE, wallClockFor1SimSecond: 1 / config.TIME_SCALE, posture, wallTests, boundaryTrials, difficulty, cardPreviews };
  await mkdir(fileURLToPath(new URL('../../../qa/itch-feedback-2026-11-11/', import.meta.url)), { recursive: true });
  await writeFile(output, JSON.stringify(result, null, 2));
  console.log(`Wrote ${output}; posture=${posture.length}, wall stages=${wallTests.length}`);
} finally { await vite.close(); }
