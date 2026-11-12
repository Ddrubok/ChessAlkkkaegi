import assert from 'node:assert/strict';
import { createServer } from 'vite';
import './headless-browser-env.mjs';
const vite = await createServer({ configFile: false, envFile: false, logLevel: 'error', server: { middlewareMode: true, hmr: false } });
try {
  const { getTutorialInputMode } = await vite.ssrLoadModule('/src/tutorial.ts');
  assert.deepEqual([1,2,3].map(s => getTutorialInputMode(s, 'basic')), ['classic','classic','classic']);
  assert.deepEqual([1,2,3,4,5].map(s => getTutorialInputMode(s, 'advanced')), ['classic','classic','billiards','billiards','billiards']);
  console.log('PASS tutorial input: basic pull/release, advanced pull/release then strike-point controls');
} finally { await vite.close(); }
