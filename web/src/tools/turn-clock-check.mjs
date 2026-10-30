import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const vite = await createServer({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  configFile: false,
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false },
});
try {
  const { createTurnClock } = await vite.ssrLoadModule('/src/turn-clock.ts');
  const tick = createTurnClock();
  assert.equal(tick(0, '0:0:white', true), 0);
  assert.equal(tick(1000, '0:0:white', true), 1);
  assert.equal(tick(25000, '0:0:white', true), 24, 'RAF gap is not capped like physics');
  assert.equal(tick(26000, '0:0:white', false), 0, 'Settling does not count');
  assert.equal(tick(50000, '0:1:black', true), 0, 'New turn starts fresh');
  assert.equal(tick(52000, '0:1:black', true), 2);
  assert.equal(tick(60000, '0:1:black', false), 0, 'Pause does not count');
  assert.equal(tick(80000, '0:1:black', true), 0, 'Resume has no inherited time');
  assert.equal(tick(81000, '0:1:black', true), 1);
  assert.equal(tick(90000, '1:0:black', true), 0, 'New board on same side starts fresh');
  console.log('PASS: independent turn clock gap, settling, pause, turn and board reset');
} finally {
  await vite.close();
}
