import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { resolve, relative } from 'node:path';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const files = ['chess-pieces.glb', 'chess-set.meta.json'];
const expected = Object.fromEntries(await Promise.all(files.map(async f => [f, sha(await readFile(`web/public/assets/${f}`))])));
const builds = ['web/dist', 'web/dist-staging', 'web/dist-poki', 'web/dist-crazygames', 'web/android/app/src/main/assets/public', 'qa/polyhaven-model-2026-10-28/final-zip'];
for (const root of builds) for (const file of files) assert.equal(sha(await readFile(`${root}/assets/${file}`)), expected[file], `${root}/${file}`);
async function walk(root) {
  const list = [];
  for (const e of await readdir(root, { withFileTypes: true })) {
    const path = resolve(root, e.name);
    if (e.isDirectory()) list.push(...await walk(path)); else list.push(path);
  }
  return list;
}
const source = resolve('web/dist-crazygames');
const unpacked = resolve('qa/polyhaven-model-2026-10-28/final-zip');
const sourceFiles = await walk(source);
assert.equal((await walk(unpacked)).length, sourceFiles.length);
for (const path of sourceFiles) assert.equal(sha(await readFile(path)), sha(await readFile(resolve(unpacked, relative(source, path)))));
for (const root of ['web/dist', 'web/dist-staging']) {
  const js = (await walk(root)).filter(f => f.endsWith('.js'));
  const all = (await Promise.all(js.map(f => readFile(f, 'utf8')))).join('\n');
  assert.ok(all.includes(expected['chess-set.meta.json']), `${root}: physics revision missing`);
  assert.ok(all.includes('chess-pieces.glb?v=' + expected['chess-pieces.glb'].slice(0, 12)), `${root}: cache revision missing`);
}
const evidence = { checkedAt: new Date().toISOString(), expected, builds, zipFilesEqualToBuild: sourceFiles.length };
await writeFile('qa/polyhaven-model-2026-10-28/artifact-results.json', JSON.stringify(evidence, null, 2));
console.log('PASS', JSON.stringify(evidence));
