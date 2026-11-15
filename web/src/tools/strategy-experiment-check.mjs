import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { Vector3 } from 'three';
import { EXPERIMENT_PROFILES, experimentPlugin } from './strategy-experiment-profiles.mjs';

const base = new URL('../../../qa/strategy-experiments-2026-11-15/physics/', import.meta.url);
const { fixtures, hash } = JSON.parse(await readFile(new URL('fixtures.json', base), 'utf8'));
assert.equal(hash, createHash('sha256').update(JSON.stringify(fixtures)).digest('hex'));
const result = JSON.parse(await readFile(new URL('results.json', base), 'utf8'));
assert.equal(result.fixtureHash, hash);
assert.equal(fixtures.length, 13);
assert.equal(fixtures.find(f => f.id === 'wall').stageNumber, 3);
assert.equal(fixtures.find(f => f.id === 'hole').stageNumber, 5);
assert.deepEqual(result.profiles, EXPERIMENT_PROFILES.map(p => p.id));
const roles = ['Pawn', 'Knight', 'Bishop', 'Rook', 'Queen', 'King'];
for (const p of EXPERIMENT_PROFILES) for (const fixture of fixtures) for (const role of roles) {
  const rows = result.trials.filter(r => r.profileId === p.id && r.fixtureId === fixture.id && r.role === role && r.repeat === 'main');
  assert.deepEqual(rows.map(r => r.power), role === 'Rook' || role === 'Queen' ? [.3,.6,1,1.5] : [.3,.6,1], `coverage ${p.id}/${fixture.id}/${role}`);
  for (const r of rows) {
    assert(!r.unsettled, `unsettled ${p.id}/${fixture.id}/${role}/${r.power}`);
    assert(r.start.shooter && r.shot.strike && r.shot.direction && r.end, 'missing replay pose');
    assert(Number.isFinite(r.initialSpeed) && Number.isFinite(r.mass) && Number.isFinite(r.momentum));
    assert.equal(r.enemyOutSelfSurvival, r.enemyOut > 0 && !r.selfOut);
  }
}
const baseline = result.trials.filter(r => r.profileId === 'baseline');
for (const fixture of fixtures) for (const role of roles) {
  const rows = baseline.filter(r => r.fixtureId === fixture.id && r.role === role && r.power === .6);
  assert.deepEqual(rows.map(r => r.repeat), ['main','T05d+','T05d-','T05e+','T05e-','T05-repeat']);
  const same = rows[0], repeated = rows.at(-1);
  assert.equal(repeated.initialSpeed, same.initialSpeed, `identical repeat ${fixture.id}/${role}`);
  assert.deepEqual(repeated.end, same.end, `identical final pose ${fixture.id}/${role}`);
}
assert.throws(() => experimentPlugin('missing'), /Unknown/);
const source = await readFile(new URL('../launch.ts', import.meta.url), 'utf8');
for (const profile of EXPERIMENT_PROFILES) {
  const plugin = experimentPlugin(profile.id);
  assert.throws(() => plugin.configResolved({ mode: 'production' }), /explicit Vite mode itch/);
  plugin.configResolved({ mode: 'itch' });
  assert.equal(plugin.transform(source, '/src/turn.ts'), null);
  const transformed = plugin.transform(source, '/src/launch.ts').code;
  assert.equal(plugin.transform(source, '/src/launch.ts').code, transformed, 'SSR/client or reload repeats must keep the same variant');
  assert(transformed.includes('gameMode === "stage"'));
  assert.throws(() => experimentPlugin(profile.id).configResolved({ mode: 'online' }), /explicit/);
  const wrongAnchor = experimentPlugin(profile.id);
  wrongAnchor.configResolved({ mode: 'itch' });
  assert.throws(() => wrongAnchor.transform('no launch code', '/src/launch.ts'), /anchor missing/);
}
const root = fileURLToPath(new URL('../..', import.meta.url));
for (const profile of EXPERIMENT_PROFILES) {
  const plugin = experimentPlugin(profile.id);
  const vite = await createServer({ root, configFile: false, mode: 'itch', logLevel: 'error', server: { middlewareMode: true, hmr: false }, plugins: [plugin] });
  try {
    const { computeLaunchKinematics } = await vite.ssrLoadModule('/src/launch.ts');
    const config = await vite.ssrLoadModule('/src/config.ts');
    const holes = await vite.ssrLoadModule('/src/holes.ts');
    const walls = await vite.ssrLoadModule('/src/walls.ts');
    assert(holes.computeBoardHoleRectangles(1, 'stage', 5).length > 0);
    assert(walls.hasBreakableWalls('stage', 3));
    const direction = new Vector3(1,0,0);
    const shot = (gameMode, pieceType, normalizedPower, aim = direction) => computeLaunchKinematics({ gameMode, pieceType, normalizedPower, direction: aim, maxLaunchSpeed: 11 });
    for (const mode of ['online', 'hotseat', 'weekly', 'puzzle']) for (const role of roles) {
      const expected = mode === 'online' ? (role === 'Knight' ? 4.5 : 7) : 11;
      // Non-stage launch values retain their production effective-power rules.
      const out = shot(mode, role, 1);
      assert(Math.abs(out.targetSpeed - expected) < 1e-9, `${profile.id}/${mode}/${role}`);
    }
    assert(Math.abs(shot('stage','Pawn',1).targetSpeed - profile.groundSpeed * profile.pawnPower) < 1e-9);
    assert(Math.abs(shot('stage','Knight',1).targetSpeed - 11) < 1e-9);
    for (const power of [0,.3,.6,1]) {
      const knight=shot('stage','Knight',power);
      assert(Math.abs(knight.targetSpeed-config.computeKnightEffectivePower(power)*11)<1e-9);
      assert(Math.abs(knight.direction.y-Math.sin(config.KNIGHT_LAUNCH_ANGLE))<1e-9);
    }
    assert(Math.abs(config.getMaxLaunchSpeed('stage','Rook',22)-profile.groundSpeed*2)<1e-9,'local tuning remains proportional');
    const diagonal = new Vector3(1, 0, 1).normalize();
    assert(Math.abs(shot('stage','Bishop',1,diagonal).targetSpeed - (profile.groundSpeed * (profile.bishopDiagonalBonus ?? 1))) < 1e-9);
    assert(Math.abs(shot('stage','Bishop',1).targetSpeed - profile.groundSpeed) < 1e-9);
    assert(Math.abs(shot('online','Bishop',1,diagonal).targetSpeed - 7) < 1e-9);
    if (profile.bishopDiagonalBonus) for (const degrees of [32.99,33,45,57,57.01,135,225,315]) {
      const radians=degrees*Math.PI/180, direction=new Vector3(Math.cos(radians),0,Math.sin(radians));
      const bonus=degrees===32.99||degrees===57.01?1:1.1;
      assert(Math.abs(shot('stage','Bishop',1,direction).targetSpeed-11*bonus)<1e-8,'board diagonal boundary '+degrees);
    }
    for (const role of roles) {
      const full = shot('stage', role, 1).targetSpeed;
      assert(Math.abs(full - (role === 'Knight' ? 11 : profile.groundSpeed * (role === 'Pawn' ? profile.pawnPower : 1))) < 1e-9);
      if (role === 'Rook' || role === 'Queen') {
        const expected = profile.groundSpeed * (role === profile.overdriveType ? 1.25 : 1.5);
        assert(Math.abs(shot('stage', role, 1.5).targetSpeed - expected) < 1e-9);
      }
    }
    for (const trial of result.trials.filter(r => r.profileId === profile.id && r.repeat === 'main')) {
      const expected = shot('stage', trial.role, trial.power, trial.shot.direction).targetSpeed;
      assert(Math.abs(trial.initialSpeed - expected) < .005, `actual impulse differs from shared guide: ${profile.id}/${trial.fixtureId}/${trial.role}/${trial.power}`);
    }
    for (const trial of result.trials.filter(r=>r.profileId===profile.id&&r.repeat==='main'&&r.role==='Knight')) {
      const same=baseline.find(b=>b.fixtureId===trial.fixtureId&&b.role==='Knight'&&b.power===trial.power&&b.repeat==='main');
      assert.deepEqual(trial.end,same.end,'Knight full physical outcome unchanged in '+profile.id+'/'+trial.fixtureId);
    }
    assert(plugin.getExperimentStatus().transformed);
  } finally { await vite.close(); }
}
console.log(`PASS: ${result.trials.length} actual trials, ${fixtures.length} hashed fixtures, legal role powers, T05 repeats, stage-only source transforms and shared launch kinematics`);
