// Developer-only PRD B probe. Fixed layouts are teaching candidates, not shipped stages.
import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Mesh, Scene, Vector3 } from 'three';

const root = fileURLToPath(new URL('../..', import.meta.url));
const output = new URL('../../../qa/game-core-loop-2026-11-19/roles/', import.meta.url);
const meta = JSON.parse(await readFile(new URL('../../public/assets/chess-set.meta.json', import.meta.url), 'utf8'));
const glb = await readFile(new URL('../../public/assets/chess-pieces.glb', import.meta.url));
const model = await new Promise((resolve, reject) => new GLTFLoader().parse(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '', resolve, reject));
const geometries = new Map();
model.scene.traverse(object => { if (object.isMesh) geometries.set(object.name, object.geometry); });
const fixtures = [
  { id: 'near-pawn-rook', stage: 2, shooter: [-1.25, 0], alternate: [-2.7, -2.4], enemy: [0.45, 0], roles: ['Pawn', 'Rook'], powers: [.2, .5, 1] },
  { id: 'far-pawn-rook', stage: 2, shooter: [-2.6, 0], alternate: [-2.7, -2.4], enemy: [1.9, 0], roles: ['Pawn', 'Rook'], powers: [.2, .5, 1, 1.5] },
  { id: 'screen-pawn-knight', stage: 3, shooter: [-3.2, 0], alternate: [-2.7, -2.4], blocker: [-1.8, 0], enemy: [2.5, 0], roles: ['Pawn', 'Knight'], powers: [.2, .35, .5, 1] },
];
const vite = await createServer({ root, configFile: false, mode: 'itch', define: { __ITCH_BUILD__: 'true' }, logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false } });
try {
  const physics = await vite.ssrLoadModule('/src/physics.ts');
  const turn = await vite.ssrLoadModule('/src/turn.ts');
  const config = await vite.ssrLoadModule('/src/config.ts');
  const aim = await vite.ssrLoadModule('/src/aim.ts');
  const stage = await vite.ssrLoadModule('/src/stage.ts');
  const layout = await vite.ssrLoadModule('/src/layout.ts');
  const rows = [];
  for (const [number, expected] of [[1, 'Pawn'], [2, 'Rook'], [3, 'Knight']]) {
    const white = stage.getCrazyGamesOpeningStageInstances(number).filter(piece => piece.side === 'white');
    assert(white.some(piece => piece.type === expected));
    assert.equal(white.filter(piece => piece.type === 'Pawn').length, 3);
  }
  function setCell(binding, cell) {
    const old = binding.body.translation();
    binding.body.setTranslation({ x: cell[0] * meta.cellSize, y: old.y, z: cell[1] * meta.cellSize }, true);
    binding.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    binding.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
  for (const fixture of fixtures) for (const role of fixture.roles) for (const power of fixture.powers) {
    if (power > aim.getAimMaxPower({ isRook: role === 'Rook', hasCustomSpin: false })) continue;
    const otherRole = fixture.roles.find(candidate => candidate !== role);
    const instances = [
      { id: 'shooter', type: role, side: 'white', startingSquare: { file: 'c', rank: 2 } },
      { id: 'alternate', type: otherRole, side: 'white', startingSquare: { file: 'b', rank: 2 } },
      { id: 'enemy', type: 'Pawn', side: 'black', startingSquare: { file: 'f', rank: 7 } },
      ...(fixture.blocker ? [{ id: 'blocker', type: 'Pawn', side: 'white', startingSquare: { file: 'd', rank: 3 } }] : []),
    ];
    const p = await physics.createPhysicsRuntime(meta, instances, stage.computeStageBoardHalfExtent(meta.cellSize, 'stage', fixture.stage), { gameMode: 'stage', stageNumber: fixture.stage });
    try {
      for (const [id, cell] of [['shooter', fixture.shooter], ['alternate', fixture.alternate], ['enemy', fixture.enemy], ['blocker', fixture.blocker]]) if (cell) setCell(p.pieces.get(id), cell);
      physics.preSettlePhysics(p);
      const scene = new Scene(), pieceMeshes = new Map();
      for (const [id, binding] of p.pieces) {
        const mesh = new Mesh(geometries.get(binding.instance.type));
        mesh.scale.setScalar(binding.uniformScale);
        scene.add(mesh); pieceMeshes.set(id, mesh);
      }
      const t = turn.createTurnRuntime(p, { scene, pieceMeshes, controls: { enabled: true } }, { maxLaunchSpeed: config.MAX_LAUNCH_SPEED, strikeHeightRatio: config.STRIKE_HEIGHT_RATIO });
      turn.setTurnGameMode(t, 'stage');
      assert(turn.canSelectTurnPiece(t, 'shooter') && turn.canSelectTurnPiece(t, 'alternate'), 'both roles must be legal choices');
      const a = p.pieces.get('shooter').body.worldCom();
      const b = p.pieces.get('enemy').body.worldCom();
      const direction = new Vector3(b.x - a.x, 0, b.z - a.z).normalize();
      const request = turn.queueTurnLaunch(t, { pieceId: 'shooter', direction, normalizedPower: power, applicationPoint: new Vector3(a.x, a.y, a.z), speedMultiplier: 1 });
      assert(request.accepted, request.reason);
      assert(turn.applyPendingLaunchBeforeStep(t));
      const speed = t.lastLaunchInitialSpeed;
      let enemyContact = false, blockerContact = false, closestEnemyCells = Infinity, maxHeightCells = 0, steps = 0;
      while (t.phase === 'settling' && steps < 1800) {
        p.world.step(); steps++;
        const shooter = p.pieces.get('shooter');
        if (shooter) {
          const pos = shooter.body.translation();
          maxHeightCells = Math.max(maxHeightCells, (pos.y - p.boardTop) / meta.cellSize);
          const enemy = p.pieces.get('enemy');
          if (enemy) {
            const target = enemy.body.translation();
            closestEnemyCells = Math.min(closestEnemyCells, Math.hypot(target.x-pos.x, target.z-pos.z) / meta.cellSize);
            p.world.contactPair(shooter.collider, enemy.collider, manifold => { if (manifold.numSolverContacts() > 0) enemyContact = true; });
          }
          const blocker = p.pieces.get('blocker');
          if (blocker) p.world.contactPair(shooter.collider, blocker.collider, manifold => { if (manifold.numSolverContacts() > 0) blockerContact = true; });
        }
        turn.updateTurnAfterStep(t, config.FIXED_STEP);
        if (t.phase === 'settling') turn.applyPendingLaunchBeforeStep(t);
      }
      assert.notEqual(t.phase, 'settling', 'shot must settle');
      rows.push({ fixture: fixture.id, role, power, speed, enemyContact, blockerContact, closestEnemyCells: Number(closestEnemyCells.toFixed(3)), maxHeightCells: Number(maxHeightCells.toFixed(3)), selfOut: !p.pieces.has('shooter'), enemyOut: !p.pieces.has('enemy'), steps, forced: t.forcedSettleCount > 0 });
    } finally { p.world.free(); }
  }
  const row = (fixture, role, power) => rows.find(r => r.fixture === fixture && r.role === role && r.power === power);
  assert.equal(row('near-pawn-rook', 'Pawn', .2).enemyContact, true);
  assert.equal(row('near-pawn-rook', 'Pawn', .2).selfOut, false);
  assert.equal(row('near-pawn-rook', 'Rook', .2).enemyOut, true);
  assert.equal(row('near-pawn-rook', 'Rook', .2).selfOut, false);
  assert.equal(row('near-pawn-rook', 'Rook', 1).selfOut, true);
  assert.equal(row('far-pawn-rook', 'Rook', 1.5).enemyContact, true);
  assert.equal(row('far-pawn-rook', 'Rook', 1.5).selfOut, true);
  assert.equal(row('screen-pawn-knight', 'Pawn', .2).blockerContact, true);
  assert.equal(row('screen-pawn-knight', 'Pawn', .2).enemyContact, false);
  assert.equal(row('screen-pawn-knight', 'Knight', .2).blockerContact, false);
  assert.equal(row('screen-pawn-knight', 'Knight', .2).enemyContact, true);
  assert.equal(row('screen-pawn-knight', 'Knight', .2).selfOut, false);
  // These shots use the exact production opening selection, mirrored spawn IDs,
  // board, buffs, walls, and turn launch path. No piece is moved or retyped.
  const shippedRows = [], shippedLayouts = [];
  for (const stageNumber of [2, 3]) {
    const options = { gameMode: 'stage', stageNumber };
    const expected = stage.selectStageSpawnInstances(layout.PIECE_INSTANCES, options);
    assert.deepEqual(expected, stage.getCrazyGamesOpeningStageInstances(stageNumber));
    const white = expected.filter(piece => piece.side === 'white');
    const black = expected.filter(piece => piece.side === 'black');
    assert.equal(white.length, 4);
    assert.equal(black.length, 4);
    assert.equal(white.filter(piece => piece.type === 'Pawn').length, 3);
    assert.equal(white.filter(piece => piece.type === (stageNumber === 2 ? 'Rook' : 'Knight')).length, 1);
    for (const piece of white) {
      const mirror = black.find(candidate => candidate.type === piece.type && candidate.startingSquare.file === piece.startingSquare.file);
      assert(mirror);
      assert.equal(mirror.startingSquare.rank, 9 - piece.startingSquare.rank);
    }
    for (const shooter of white) for (const target of black) for (const power of (shooter.type === 'Rook' ? [.2, .35, .5, 1, 1.5] : [.2, .35, .5, 1])) {
      const p = await physics.createPhysicsRuntime(meta, layout.PIECE_INSTANCES, stage.computeStageBoardHalfExtent(meta.cellSize, 'stage', stageNumber), options);
      try {
        assert.deepEqual([...p.pieces.keys()].sort(), expected.map(piece => piece.id).sort());
        if (shooter.id === white[0].id && target.id === black[0].id && power === .2) {
          const spawns = expected.map(piece => {
            const binding = p.pieces.get(piece.id);
            const actual = binding.body.translation();
            const pose = stage.computeStageSpawnPose(piece, meta, options);
            assert(Math.hypot(actual.x - pose.translation.x, actual.z - pose.translation.z) < 1e-5, piece.id);
            return { id: piece.id, type: piece.type, side: piece.side, square: `${piece.startingSquare.file}${piece.startingSquare.rank}`, xCells: Number((actual.x / meta.cellSize).toFixed(3)), zCells: Number((actual.z / meta.cellSize).toFixed(3)) };
          });
          shippedLayouts.push({ stage: stageNumber, boardHalfExtentCells: p.boardHalfExtent / meta.cellSize, walls: [...p.breakableWalls.keys()], spawns });
        }
        physics.preSettlePhysics(p);
        const scene = new Scene(), pieceMeshes = new Map();
        for (const [id, binding] of p.pieces) {
          const mesh = new Mesh(geometries.get(binding.instance.type));
          mesh.scale.setScalar(binding.uniformScale);
          scene.add(mesh); pieceMeshes.set(id, mesh);
        }
        const t = turn.createTurnRuntime(p, { scene, pieceMeshes, controls: { enabled: true } }, { maxLaunchSpeed: config.MAX_LAUNCH_SPEED, strikeHeightRatio: config.STRIKE_HEIGHT_RATIO });
        turn.setTurnGameMode(t, 'stage');
        assert(white.every(piece => turn.canSelectTurnPiece(t, piece.id)));
        const a = p.pieces.get(shooter.id).body.worldCom();
        const b = p.pieces.get(target.id).body.worldCom();
        const direction = new Vector3(b.x - a.x, 0, b.z - a.z).normalize();
        const request = turn.queueTurnLaunch(t, { pieceId: shooter.id, direction, normalizedPower: power, applicationPoint: new Vector3(a.x, a.y, a.z), speedMultiplier: 1 });
        assert(request.accepted, request.reason);
        assert(turn.applyPendingLaunchBeforeStep(t));
        const contacts = new Set(), allyContacts = new Set(), wallContacts = new Set();
        let closestTargetCells = Infinity, maxHeightCells = 0, steps = 0;
        while (t.phase === 'settling' && steps < 1800) {
          p.world.step(); steps++;
          const shot = p.pieces.get(shooter.id);
          if (shot) {
            const pos = shot.body.translation();
            maxHeightCells = Math.max(maxHeightCells, (pos.y - p.boardTop) / meta.cellSize);
            const enemy = p.pieces.get(target.id);
            if (enemy) {
              const ep = enemy.body.translation();
              closestTargetCells = Math.min(closestTargetCells, Math.hypot(ep.x - pos.x, ep.z - pos.z) / meta.cellSize);
            }
            for (const [id, other] of p.pieces) if (id !== shooter.id) {
              p.world.contactPair(shot.collider, other.collider, manifold => {
                if (manifold.numSolverContacts() > 0) (other.instance.side === 'white' ? allyContacts : contacts).add(id);
              });
            }
            for (const [id, wall] of p.breakableWalls) p.world.contactPair(shot.collider, wall.collider, manifold => {
              if (manifold.numSolverContacts() > 0) wallContacts.add(id);
            });
          }
          turn.updateTurnAfterStep(t, config.FIXED_STEP);
          if (t.phase === 'settling') turn.applyPendingLaunchBeforeStep(t);
        }
        assert.notEqual(t.phase, 'settling', 'shipped shot must settle');
        shippedRows.push({ stage: stageNumber, shooter: shooter.id, role: shooter.type, aimedAt: target.id, power, speed: t.lastLaunchInitialSpeed, targetContact: contacts.has(target.id), enemyContacts: [...contacts], allyContacts: [...allyContacts], wallContacts: [...wallContacts], closestTargetCells: Number(closestTargetCells.toFixed(3)), maxHeightCells: Number(maxHeightCells.toFixed(3)), selfOut: !p.pieces.has(shooter.id), enemyOutIds: black.filter(piece => !p.pieces.has(piece.id)).map(piece => piece.id), steps, forced: t.forcedSettleCount > 0 });
      } finally { p.world.free(); }
    }
  }
  assert.equal(shippedRows.length, 132);
  assert(shippedRows.some(result => result.stage === 2 && result.role === 'Pawn' && result.power < 1 && result.targetContact));
  assert(shippedRows.some(result => result.stage === 2 && result.role === 'Rook' && result.power < 1 && result.targetContact));
  assert(shippedRows.some(result => result.stage === 3 && result.role === 'Pawn' && result.power < 1 && result.targetContact));
  assert(shippedRows.some(result => result.stage === 3 && result.role === 'Knight' && result.power < 1 && result.targetContact));
  const shipped = (stageNumber, shooter, aimedAt, power) => shippedRows.find(result => result.stage === stageNumber && result.shooter === shooter && result.aimedAt === aimedAt && result.power === power);
  assert(shipped(2, 'white-rook-e1', 'black-rook-e8', .2).targetContact);
  assert(shipped(2, 'white-rook-e1', 'black-rook-e8', .2).enemyOutIds.includes('black-rook-e8'));
  assert.equal(shipped(2, 'white-rook-e1', 'black-rook-e8', .2).selfOut, false);
  assert.equal(shipped(2, 'white-rook-e1', 'black-rook-e8', 1.5).selfOut, true);
  assert(shipped(3, 'white-knight-e1', 'black-pawn-f7', .35).targetContact);
  assert(shipped(3, 'white-knight-e1', 'black-pawn-f7', .35).enemyOutIds.includes('black-pawn-f7'));
  assert.equal(shipped(3, 'white-knight-e1', 'black-pawn-f7', .35).selfOut, false);
  assert(shipped(3, 'white-knight-e1', 'black-pawn-f7', .35).wallContacts.length > 0);
  for (const pawn of ['white-pawn-c3', 'white-pawn-d2', 'white-pawn-f2']) {
    assert(shipped(3, pawn, 'black-pawn-f7', .35).targetContact);
    assert.equal(shipped(3, pawn, 'black-pawn-f7', .35).enemyOutIds.includes('black-pawn-f7'), false);
  }
  assert.equal(shipped(3, 'white-knight-e1', 'black-pawn-f7', .5).targetContact, false);
  assert.equal(shipped(3, 'white-knight-e1', 'black-pawn-f7', .5).selfOut, true);
  await mkdir(output, { recursive: true });
  await writeFile(new URL('fixed-shot-results.json', output), JSON.stringify({ scope: 'Controlled fixture, current stage rules, real GLB colliders and Rapier fixed steps; no AI or human learning claim', fixtures, rows }, null, 2) + '\n');
  await writeFile(new URL('shipped-stage-shot-results.json', output), JSON.stringify({ scope: 'Actual solo stage 2 and 3 mirrored spawns; center aims at each black piece; no cards, research, repositioning, or custom spin', layouts: shippedLayouts, rows: shippedRows }, null, 2) + '\n');
  console.log(`Fixed fixture shots: ${rows.length}; shipped stage shots: ${shippedRows.length}`);
} finally { await vite.close(); }
