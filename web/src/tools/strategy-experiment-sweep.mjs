// Developer-only fixed-fixture Rapier sweep; no match/win-rate inference.
import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Mesh, Scene, Vector3 } from 'three';
import { EXPERIMENT_PROFILES, experimentPlugin } from './strategy-experiment-profiles.mjs';

const webRoot = fileURLToPath(new URL('../..', import.meta.url));
const out = new URL('../../../qa/strategy-experiments-2026-11-15/physics/', import.meta.url);
const roles = ['Pawn', 'Knight', 'Bishop', 'Rook', 'Queen', 'King'];
// Positions are board cells (not metres); x/z are applied after genuine collider creation.
export const FIXTURES = Object.freeze([
  { id: 'center', shooter: [-1.2, 0], enemy: [1.2, 0] },
  { id: 'north-edge', shooter: [0, 2], enemy: [0, 3.15] },
  { id: 'south-edge', shooter: [0, -2], enemy: [0, -3.15] },
  { id: 'east-edge', shooter: [2, 0], enemy: [3.15, 0] },
  { id: 'west-edge', shooter: [-2, 0], enemy: [-3.15, 0] },
  { id: 'near', shooter: [-.75, 0], enemy: [.35, 0] },
  { id: 'far', shooter: [-3, -.25], enemy: [2.3, -.25] },
  { id: 'cluster', shooter: [-1.5, 0], enemy: [.3, 0], extraEnemies: [[1.15,.75],[1.8,-.75],[2.4,.35]] },
  { id: 'dispersed', shooter: [-2.2, -1.8], enemy: [.9, .7], extraEnemies: [[2.3,-1.4],[-.8,2.4],[2.7,2.1]] },
  { id: 'ally-block', shooter: [-2, 0], ally: [-.7, 0], enemy: [1.05, 0] },
  { id: 'wall', shooter: [-2, 0], enemy: [1.2, 0], stageNumber: 3 },
  { id: 'hole', shooter: [-2.6, 0], enemy: [2.6, 0], stageNumber: 5 },
  { id: 'prone', shooter: [-1.2, 0], enemy: [1.2, 0], prone: true },
]);
const args = process.argv.slice(2);
const value = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const chosen = String(value('--profiles', EXPERIMENT_PROFILES.map(p => p.id).join(','))).split(',');
for (const id of chosen) assert(EXPERIMENT_PROFILES.some(p => p.id === id), `unknown profile ${id}`);
const limit = Number(value('--fixture-limit', FIXTURES.length));
assert(Number.isInteger(limit) && limit >= 1 && limit <= FIXTURES.length, 'invalid fixture limit');
const fixtures = FIXTURES.slice(0, limit);
const maxSteps = Number(value('--max-steps', 1800));
assert(Number.isInteger(maxSteps) && maxSteps >= 1, 'invalid max steps');
const fixtureHash = createHash('sha256').update(JSON.stringify(FIXTURES)).digest('hex');
const meta = JSON.parse(await readFile(new URL('../../public/assets/chess-set.meta.json', import.meta.url), 'utf8'));
const glb = await readFile(new URL('../../public/assets/chess-pieces.glb', import.meta.url));
const parsed = await new Promise((resolve, reject) => new GLTFLoader().parse(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '', resolve, reject));
const geometries = new Map();
parsed.scene.traverse(o => { if (o.isMesh && roles.includes(o.name)) geometries.set(o.name, o.geometry); });
for (const role of roles) assert(geometries.has(role), `missing real GLB ${role}`);
const pose = b => ({ translation: { ...b.body.translation() }, rotation: { ...b.body.rotation() } });
const positions = p => Object.fromEntries([...p.pieces].map(([id, b]) => [id, pose(b)]));
const instances = role => [
  { id: 'shooter', type: role, side: 'white', startingSquare: { file: 'c', rank: 2 } },
  { id: 'enemy', type: 'Pawn', side: 'black', startingSquare: { file: 'f', rank: 7 } },
  { id: 'enemy-extra', type: 'Pawn', side: 'black', startingSquare: { file: 'g', rank: 7 } },
  { id: 'ally', type: 'Pawn', side: 'white', startingSquare: { file: 'b', rank: 2 } },
];

function setCell(binding, cell) {
  const old = binding.body.translation();
  binding.body.setTranslation({ x: cell[0] * meta.cellSize, y: old.y, z: cell[1] * meta.cellSize }, true);
  binding.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  binding.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
}
function sceneFor(p) {
  const scene = new Scene(), pieceMeshes = new Map();
  for (const [id, b] of p.pieces) {
    const mesh = new Mesh(geometries.get(b.instance.type));
    mesh.scale.setScalar(b.uniformScale);
    mesh.position.copy(b.body.translation());
    const q = b.body.rotation(); mesh.quaternion.set(q.x, q.y, q.z, q.w);
    mesh.updateMatrixWorld(true); scene.add(mesh); pieceMeshes.set(id, mesh);
  }
  return { scene, pieceMeshes, controls: { enabled: true } };
}
function contact(p) {
  const shooter = p.pieces.get('shooter');
  if (!shooter) return false;
  for (const b of p.pieces.values()) {
    if (b.instance.id === 'shooter') continue;
    let touching = false;
    p.world.contactPair(shooter.collider, b.collider, manifold => { if (manifold.numSolverContacts() > 0) touching = true; });
    if (touching) return b.instance.id;
  }
  for (const [id, wall] of p.breakableWalls) {
    let touching = false;
    p.world.contactPair(shooter.collider, wall.collider, manifold => { if (manifold.numSolverContacts() > 0) touching = true; });
    if (touching) return id;
  }
  return false;
}
async function one(mod, profile, fixture, role, power, repeat = 'main', degrees = 0, powerDelta = 0) {
  const list = instances(role).filter(i => (i.id !== 'ally' || fixture.ally) && i.id !== 'enemy-extra');
  for (const [index] of (fixture.extraEnemies ?? []).entries()) list.push({id:'enemy-extra-'+index,type:'Pawn',side:'black',startingSquare:{file:'g',rank:7}});
  const stageOptions = { gameMode: 'stage', stageNumber: fixture.stageNumber ?? 1,
    ...(fixture.prone ? { runCards: { sizeGrade: 0, weightGrade: 0, forceGrade: 0, giantPawn: false, proneStart: true, picksSoFar: 1 } } : {}) };
  const p = await mod.physics.createPhysicsRuntime(meta, list, mod.config.deriveBoardHalfExtent(meta.cellSize), stageOptions);
  try {
    for (const [id, cell] of [['shooter', fixture.shooter], ['enemy', fixture.enemy], ['enemy-extra', fixture.extraEnemy], ['ally', fixture.ally]]) {
      if (cell) setCell(p.pieces.get(id), cell);
    }
    for (const [index,cell] of (fixture.extraEnemies ?? []).entries()) setCell(p.pieces.get('enemy-extra-'+index),cell);
    mod.physics.preSettlePhysics(p);
    const start = positions(p), shooter = p.pieces.get('shooter');
    assert(shooter, 'missing shooter');
    const a = shooter.body.translation(), b = p.pieces.get('enemy').body.translation();
    const angle = Math.atan2(b.z - a.z, b.x - a.x) + degrees * Math.PI / 180;
    const direction = new Vector3(Math.cos(angle), 0, Math.sin(angle));
    const com = shooter.body.worldCom(), strike = new Vector3(com.x, com.y, com.z);
    const t = mod.turn.createTurnRuntime(p, sceneFor(p), { maxLaunchSpeed: mod.config.MAX_LAUNCH_SPEED, strikeHeightRatio: mod.config.STRIKE_HEIGHT_RATIO });
    mod.turn.setTurnGameMode(t, 'stage');
    const normalizedPower = power + powerDelta;
    const request = { pieceId: 'shooter', direction, normalizedPower, applicationPoint: strike, speedMultiplier: 1 };
    const accepted = mod.turn.queueTurnLaunch(t, request);
    assert(accepted.accepted, `${profile.id} ${fixture.id} ${role} ${power}: ${accepted.reason}`);
    assert(mod.turn.applyPendingLaunchBeforeStep(t), 'launch not applied');
    const initialSpeed = Math.hypot(...Object.values(shooter.body.linvel()));
    const mass = shooter.body.mass();
    const measuredSettings = {stage:stageOptions.stageNumber,boardHalfExtent:p.boardHalfExtent,step:mod.config.FIXED_STEP,friction:shooter.collider.friction(),restitution:shooter.collider.restitution(),linearDamping:shooter.body.linearDamping(),cards:stageOptions.runCards??null,enemyBuffs:'production stage spawn; same for every profile',AI:'not used; fixed shot',research:'none'};
    let firstContact = null, enemyContact = false, steps = 0;
    while (t.phase === 'settling' && steps < maxSteps) {
      p.world.step();
      steps++;
      if (!firstContact) {
        const id = contact(p);
        if (id) firstContact = { pieceId: id, seconds: steps * mod.config.FIXED_STEP };
      }
      for (const other of p.pieces.values()) if (p.pieces.has('shooter') && other.instance.side === 'black') {
        p.world.contactPair(shooter.collider, other.collider, manifold => { if (manifold.numSolverContacts() > 0) enemyContact = true; });
      }
      mod.turn.updateTurnAfterStep(t, mod.config.FIXED_STEP);
      if (t.phase === 'settling') mod.turn.applyPendingLaunchBeforeStep(t);
    }
    const end = positions(p), removed = Object.keys(start).filter(id => !end[id]);
    return { profileId: profile.id, fixtureId: fixture.id, role, power, repeat, degrees, powerDelta,
      shot: { direction: { ...direction }, normalizedPower, strike: { ...strike } }, start, end,
      firstContact, enemyContact, initialSpeed, mass, momentum: initialSpeed * mass,
      selfOut: removed.includes('shooter'), enemyOut: removed.filter(id => id.startsWith('enemy')).length,
      allyOut: removed.includes('ally'), enemyOutSelfSurvival: removed.some(id => id.startsWith('enemy')) && !removed.includes('shooter'),
      settleSeconds: steps * mod.config.FIXED_STEP, forced: t.forcedSettleCount > 0, unsettled: t.phase === 'settling',
      promotion: [...t.pendingPromotionPawns.keys()], promotionCompleted: false, phase: t.phase,
      settings: measuredSettings };
  } finally { p.world.free(); }
}

await mkdir(out, { recursive: true });
await writeFile(new URL('fixtures.json', out), JSON.stringify({ hash: fixtureHash, unit: 'board cells', fixtures: FIXTURES }, null, 2));
const all = [];
for (const id of chosen) {
  const profile = EXPERIMENT_PROFILES.find(p => p.id === id);
  const plugin = experimentPlugin(id);
  const vite = await createServer({ root: webRoot, configFile: false, mode: 'itch', logLevel: 'error', server: { middlewareMode: true, hmr: false }, plugins: [plugin] });
  try {
    const mod = {
      config: await vite.ssrLoadModule('/src/config.ts'),
      physics: await vite.ssrLoadModule('/src/physics.ts'),
      turn: await vite.ssrLoadModule('/src/turn.ts'),
    };
    assert(plugin.getExperimentStatus().transformed, `profile ${id} did not transform launch`);
    let count = 0;
    for (const fixture of fixtures) for (const role of roles) {
      for (const power of role === 'Rook' || role === 'Queen' ? [.3, .6, 1, 1.5] : [.3, .6, 1]) {
        all.push(await one(mod, profile, fixture, role, power)); count++;
      }
      if (id === 'baseline') for (const [repeat, degrees, powerDelta] of [['T05d+', 1, 0], ['T05d-', -1, 0], ['T05e+', 0, .01], ['T05e-', 0, -.01], ['T05-repeat', 0, 0]]) {
        all.push(await one(mod, profile, fixture, role, .6, repeat, degrees, powerDelta)); count++;
      }
      console.log(`${id} ${fixture.id} ${role}: ${count} trials`);
    }
  } finally { await vite.close(); }
}
const results = { fixtureHash, source: 'real GLB collider metadata + Rapier fixed timestep + production queueTurnLaunch/updateTurnAfterStep',
  profiles: chosen, powers: [0.3, 0.6, 1, 1.5], maxSteps, trials: all };
await writeFile(new URL('results.json', out), JSON.stringify(results));
const main = all.filter(r => r.repeat === 'main');
const lines = ['# SG-R02/03 물리 실험 관찰', '', `고정 배치 ${fixtures.length}개, ${all.length}회. ${fixtureHash}`, '', '| 프로필 | 본 시험 | 적 장외 | 자기 장외 | 적 장외+자기 생존 | 강제 정착 | 미정착 |', '|---|---:|---:|---:|---:|---:|---:|'];
for (const profile of chosen) {
  const rows = main.filter(r => r.profileId === profile);
  lines.push(`| ${profile} | ${rows.length} | ${rows.reduce((n,r)=>n+r.enemyOut,0)} | ${rows.filter(r=>r.selfOut).length} | ${rows.filter(r=>r.enemyOutSelfSurvival).length} | ${rows.filter(r=>r.forced).length} | ${rows.filter(r=>r.unsettled).length} |`);
}
lines.push('', '동일 배치의 한 발 결과이며 사람의 재미·승률·채택 근거가 아닙니다. E03 반발·감쇠는 연쇄 과다 재현 여부를 먼저 판단하도록 보류합니다. 공개 기본값은 유지합니다.');
await writeFile(new URL('RESULT-ko.md', out), lines.join('\n'));
console.log(`Wrote ${all.length} real Rapier trials to ${fileURLToPath(out)}`);
