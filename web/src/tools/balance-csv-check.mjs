import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const vite = await createServer({
  root: fileURLToPath(new URL('../..', import.meta.url)), configFile: false,
  logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false },
});
try {
  const { balanceConfig } = await vite.ssrLoadModule('/src/balance.ts');
  const config = await vite.ssrLoadModule('/src/config.ts');
  const { BALANCE_KEYS, parseAndValidateBalanceCsv: parse } = await vite.ssrLoadModule('/src/balance-csv.ts');
  const csv = (await readFile(new URL('../../balance.csv', import.meta.url), 'utf8')).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const replaceValue = (key, value) => csv.replace(new RegExp(`^${key},[^,]*,`, 'm'), `${key},${value},`);
  // Check the edited CSV, never require the original release's numeric values.
  assert.deepEqual(parse(csv), balanceConfig);
  assert.deepEqual(parse('\uFEFF' + csv.replace(/\n/g, '\r\n')), balanceConfig);
  for (const key of BALANCE_KEYS.filter(key => !key.endsWith('_MULTIPLIER') || key === 'BISHOP_SPIN_TORQUE_MULTIPLIER')) {
    assert.equal(config[key], balanceConfig[key], `Config must read CSV: ${key}`);
  }
  for (const piece of ['Pawn', 'Knight', 'Bishop', 'Rook', 'Queen', 'King']) {
    const power = balanceConfig[`${piece.toUpperCase()}_POWER_MULTIPLIER`];
    assert.equal(config.getPieceWeightMultiplier(piece), balanceConfig[`${piece.toUpperCase()}_WEIGHT_MULTIPLIER`]);
    assert.equal(config.getPiecePowerMultiplier(piece), power);
    assert.equal(config.getMaxLaunchSpeed('online', piece),
      balanceConfig[piece === 'Knight' ? 'CLASSIC_KNIGHT_MAX_LAUNCH_SPEED' : 'CLASSIC_MAX_LAUNCH_SPEED'] * power);
    assert.equal(config.getMaxLaunchSpeed('puzzle', piece, 20), 20 * power);
  }
  const quoted = csv.replace(/^PIECE_DENSITY,[^\n]*$/m,
    `PIECE_DENSITY,"${balanceConfig.PIECE_DENSITY}","밀도, 설명에 ""따옴표""\n다음 줄"`);
  assert.deepEqual(parse(quoted), balanceConfig);
  assert.equal(parse(replaceValue('PAWN_WEIGHT_MULTIPLIER', '1.25')).PAWN_WEIGHT_MULTIPLIER, 1.25);
  for (const value of ['', 'abc', 'NaN', 'Infinity', '0', '-1', '101', '"1"2', '1"2"']) {
    assert.throws(() => parse(replaceValue('PIECE_DENSITY', value)), `Reject invalid value: ${value}`);
  }
  assert.throws(() => parse(replaceValue('PIECE_RESTITUTION', '1.5')), /범위/);
  assert.throws(() => parse(csv.replace(/^PAWN_WEIGHT_MULTIPLIER,[^\n]*\n?/m, '')), /누락/);
  assert.throws(() => parse(csv + '\nUNKNOWN_KEY,1,설명'), /알 수 없는/);
  assert.throws(() => parse(csv + '\nPIECE_DENSITY,1,설명'), /중복/);
  assert.throws(() => parse(csv.replace('key,value,description', 'key,value')), /헤더/);
  assert.throws(() => parse(csv.replace('key,value,description', 'key,value,description,extra')), /헤더/);
  assert.throws(() => parse(csv + '\n"unterminated'), /따옴표/);
  assert.throws(() => parse(csv.replace(/^PIECE_DENSITY,[^\n]*$/m, 'PIECE_DENSITY,1,2,설명')), /열/);
  assert.throws(() => parse(''), /비어/);
  console.log(`PASS: ${BALANCE_KEYS.length} CSV values loaded; edited values, mode scaling, BOM/quoted CSV and invalid input checked.`);
} finally {
  await vite.close();
}
