import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const read=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
const before=await read('physics-before/result.json');
const after=await read('physics-final-02/result.json');
const repeat=await read('physics-repeat/result.json');
const render=await read('after-final-03/result.json');
const stable=r=>({stage:r.stage,layout:r.layout,request:r.request,hit:r.hit,sourceSurvived:r.sourceSurvived,
  targetSurvived:r.targetSurvived,forced:r.forced,settled:r.settled,steps:r.steps,initialVelocity:r.initialVelocity});
assert.deepEqual(after.results.map(stable),repeat.results.map(stable),'fixed-state repeat matches decisions, contacts, outcomes and settle steps');
assert.deepEqual(before.results.map(r=>[r.stage,r.layout]),after.results.map(r=>[r.stage,r.layout]));
assert.ok(after.summary.hits>before.summary.hits);
assert.ok(after.summary.selfOut<=before.summary.selfOut);
assert.ok(after.results.every(r=>r.worldUnchanged&&r.settled&&!r.forced));
assert.ok(!render.failure && render.pageErrors.length===0 && render.sourcesChangedDuringRun.length===0);
assert.ok(Object.values(render.lifecycle).every(Boolean));
const sensitivity=[];
for(let i=0;i<4;i++){const p=await read(`perturb-${i}/result.json`);sensitivity.push({change:p.perturbation,...p.summary});}
const result={before:before.summary,after:after.summary,fixedStateRepeat:'passed',lifecycle:render.lifecycle,
  sensitivity,scope:'Fixed fixtures only; no claim of human difficulty, native performance, full-game determinism or post-collision safety.'};
await writeFile(new URL('validation.json',import.meta.url),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
