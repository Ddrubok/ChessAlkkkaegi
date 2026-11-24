import assert from 'node:assert/strict';
import { createServer } from 'vite';
import './headless-browser-env.mjs';
const vite = await createServer({ configFile: false, envFile: false, logLevel: 'error', server: { middlewareMode: true, hmr: false } });
try {
  const { getTutorialInputMode, TutorialManager } = await vite.ssrLoadModule('/src/tutorial.ts');
  assert.deepEqual([1,2,3].map(s => getTutorialInputMode(s, 'basic')), ['classic','classic','classic']);
  assert.deepEqual([1,2,3,4,5].map(s => getTutorialInputMode(s, 'advanced')), ['classic','classic','billiards','billiards','billiards']);
  console.log('PASS tutorial input: basic pull/release, advanced pull/release then strike-point controls');
  const practice = new TutorialManager();
  practice.isActive = practice.powerPractice = true;
  assert.equal(practice.checkStepClear(1, [], false).cleared, false);
  for (const [power, displayed, expected] of [
    [.2949, 29, false], [.29804, 30, true], [.50222, 50, true], [.5051, 51, false],
  ]) {
    practice.recordPracticeShot(power);
    const { cleared, hint } = practice.checkStepClear(1, [], false);
    assert.equal(cleared, expected, `practice shot displayed as ${displayed}%`);
    if (!expected) assert.ok(hint.includes(String(displayed)));
  }
  console.log('PASS practice outcomes match displayed 29/30/50/51%');
} finally { await vite.close(); }
