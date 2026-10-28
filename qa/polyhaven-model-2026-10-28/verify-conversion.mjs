// Run from repository root: node qa/polyhaven-model-2026-10-28/verify-conversion.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from '../../web/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const web = path.join(root, 'web');
const require = createRequire(path.join(web, 'package.json'));
const { Matrix4, Quaternion, Vector3 } = require('three');
const names = ['Pawn', 'Rook', 'Knight', 'Bishop', 'Queen', 'King'];
const source = JSON.parse(await readFile(path.join(root, 'assets-source/polyhaven-chess/chess_set_1k.gltf')));
const bin = await readFile(path.join(root, 'assets-source/polyhaven-chess/chess_set.bin'));
const meta = JSON.parse(await readFile(path.join(web, 'public/assets/chess-set.meta.json')));
const old = JSON.parse(execFileSync('git', ['show', 'df00d80946c671f93f7dde485f7bfa8679af895f:web/public/assets/chess-set.meta.json'], { cwd: root, encoding: 'utf8' }));
const glb = await readFile(path.join(web, 'public/assets/chess-pieces.glb'));
assert.equal(glb.readUInt32LE(0), 0x46546c67);
const jsonLength = glb.readUInt32LE(12);
const out = JSON.parse(glb.subarray(20, 20 + jsonLength).toString());
const chunkAt = 20 + jsonLength;
assert.equal(glb.readUInt32LE(chunkAt + 4), 0x004e4942);
const outBin = glb.subarray(chunkAt + 8);

function accessor(g, data, id) {
  const a = g.accessors[id], v = g.bufferViews[a.bufferView];
  const size = { SCALAR: 1, VEC2: 2, VEC3: 3 }[a.type];
  const bytes = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
  assert.ok(size && bytes && !a.sparse && !a.normalized);
  const d = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const stride = v.byteStride ?? size * bytes, offset = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const values = [];
  for (let i = 0; i < a.count; i++) for (let j = 0; j < size; j++) {
    const at = offset + i * stride + j * bytes;
    values.push(a.componentType === 5126 ? d.getFloat32(at, true) : bytes === 4 ? d.getUint32(at, true) : bytes === 2 ? d.getUint16(at, true) : d.getUint8(at));
  }
  return values;
}
function localMatrix(n) {
  return n.matrix ? new Matrix4().fromArray(n.matrix) : new Matrix4().compose(
    new Vector3(...(n.translation ?? [0, 0, 0])), new Quaternion(...(n.rotation ?? [0, 0, 0, 1])),
    new Vector3(...(n.scale ?? [1, 1, 1])));
}
const parents = new Map();
source.nodes.forEach((n, i) => (n.children ?? []).forEach(c => parents.set(c, i)));
function worldMatrix(id) {
  const m = localMatrix(source.nodes[id]);
  return parents.has(id) ? worldMatrix(parents.get(id)).multiply(m) : m;
}
function hullCount(points) {
  const p = [...new Map(points.map(v => [`${v[0]},${v[2]}`, [v[0], v[2]]])).values()].sort((a,b) => a[0]-b[0] || a[1]-b[1]);
  const cross = (a,b,c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const h=[];
  for (const v of p) { while(h.length>1 && cross(h.at(-2),h.at(-1),v)<=1e-10) h.pop(); h.push(v); }
  const lower=h.length;
  for(let i=p.length-2;i>=0;i--) { const v=p[i]; while(h.length>lower && cross(h.at(-2),h.at(-1),v)<=1e-10) h.pop(); h.push(v); }
  return h.length-1;
}
const geometry = {};
for (const name of names) {
  const sourceName = `piece_${name.toLowerCase()}_white${['Pawn','Rook','Knight','Bishop'].includes(name) ? '_01' : ''}`;
  const id = source.nodes.findIndex(n => n.name === sourceName && n.mesh !== undefined);
  assert.ok(id >= 0, `${name}: source node`);
  const node = source.nodes[id], m = worldMatrix(id), local = localMatrix(node);
  const origin = new Vector3().applyMatrix4(m), src = [], srcIndices = [];
  for (const primitive of source.meshes[node.mesh].primitives) {
    const pos = accessor(source, bin, primitive.attributes.POSITION), base = src.length;
    for (let i=0;i<pos.length;i+=3) src.push(new Vector3(...pos.slice(i,i+3)).applyMatrix4(m).sub(origin));
    srcIndices.push(...accessor(source,bin,primitive.indices).map(x=>x+base));
  }
  if (name === 'Knight') for (const p of src) p.set(p.z, p.y, -p.x);
  const low=[0,1,2].map(a=>Math.min(...src.map(v=>v.getComponent(a))));
  const high=[0,1,2].map(a=>Math.max(...src.map(v=>v.getComponent(a))));
  const scale=old.pieces[name].bounds.y/(high[1]-low[1]);
  const cx=(low[0]+high[0])/2, cz=(low[2]+high[2])/2;
  const preliminary=src.map(v=>[(v.x-cx)*scale,(v.y-low[1])*scale,(v.z-cz)*scale]);
  const h=old.pieces[name].bounds.y;
  const baseRadius=Math.max(...preliminary.filter(v=>v[1]<=h*.1).map(v=>Math.hypot(v[0],v[2])));
  const footprint=old.pieces[name].baseRadius/baseRadius;
  const expected=preliminary.map(v=>{const blend=Math.max(0,Math.min(1,(v[1]/h-.1)/.2));const f=footprint+(1-footprint)*blend;return [v[0]*f,v[1],v[2]*f];});
  const outNode=out.nodes.find(n=>n.name===name), primitive=out.meshes[outNode.mesh].primitives[0];
  const pos=accessor(out,outBin,primitive.attributes.POSITION), normals=accessor(out,outBin,primitive.attributes.NORMAL), indices=accessor(out,outBin,primitive.indices);
  assert.equal(pos.length,expected.length*3); assert.deepEqual(indices,srcIndices,`${name}: triangle indices`);
  let maxVertexError=0, badNormal=0, winding=0;
  for(let i=0;i<expected.length;i++) for(let a=0;a<3;a++) maxVertexError=Math.max(maxVertexError,Math.abs(pos[i*3+a]-expected[i][a]));
  for(let i=0;i<indices.length;i+=3){
    const a=indices[i],b=indices[i+1],c=indices[i+2];
    const va=new Vector3(...expected[a]), vb=new Vector3(...expected[b]), vc=new Vector3(...expected[c]);
    const face=vb.sub(va).cross(vc.sub(va));
    if(face.lengthSq()<1e-14) continue;
    const ns=new Vector3(...normals.slice(a*3,a*3+3)).add(new Vector3(...normals.slice(b*3,b*3+3))).add(new Vector3(...normals.slice(c*3,c*3+3)));
    if(face.dot(ns)<0) badNormal++;
    winding++;
  }
  const p=meta.pieces[name], base=p.colliderPoints.filter(v=>v[1]===0), actualHull=hullCount(base);
  const yMin=Math.min(...pos.filter((_,i)=>i%3===1));
  const highVertices=expected.filter(v=>v[1]>h*.7);
  const topCentroid=[0,2].map(axis=>highVertices.reduce((sum,v)=>sum+v[axis],0)/highVertices.length);
  const upperBoundsXZ=[0,2].map(axis=>[Math.min(...highVertices.map(v=>v[axis])),Math.max(...highVertices.map(v=>v[axis]))]);
  const flattenedSourceMaxY=Math.max(...preliminary.filter(v=>v[1]<=h*.1).map(v=>v[1]));
  assert.equal(p.baseHullPointCount, actualHull, `${name}: true support polygon count`);
  assert.ok(p.baseFlattenEps + 1e-6 >= flattenedSourceMaxY, `${name}: flatten-region metadata`);
  geometry[name]={sourceNode:id,parentChain:(()=>{const a=[];let j=id;while(parents.has(j)){j=parents.get(j);a.push(source.nodes[j].name??j);}return a;})(),localDeterminant:local.determinant(),worldDeterminant:m.determinant(),vertices:expected.length,triangles:winding,maxVertexError,badNormalTriangles:badNormal,visualMinY:yMin,basePoints:base.length,actualHullPoints:actualHull,declaredHullPoints:p.baseHullPointCount,flattenedSourceMaxY,baseFlattenEps:p.baseFlattenEps,topCentroidXZ:topCentroid,upperBoundsXZ,newBounds:p.bounds,oldBounds:old.pieces[name].bounds};
  assert.ok(maxVertexError<1e-6 && Math.abs(yMin)<1e-6 && badNormal===0,`${name}: converted geometry`);
  assert.ok(Math.abs(p.bounds.y-old.pieces[name].bounds.y)<1e-6 && Math.abs(p.baseRadius-old.pieces[name].baseRadius)<1e-6,`${name}: frozen physical reference`);
}

const vite=await createServer({root:web,configFile:false,logLevel:'error',server:{middlewareMode:true,hmr:false,ws:false}});
const physicsResults={};
try {
  const config=await vite.ssrLoadModule('/src/config.ts');
  const physics=await vite.ssrLoadModule('/src/physics.ts');
  const RAPIER=require('@dimforge/rapier3d-compat');
  await RAPIER.init();
  const half=config.deriveBoardHalfExtent(meta.cellSize);
  const makeInstance=(name,id,file='d')=>({id,type:name,side:'white',startingSquare:{file,rank:4}});
  for(const name of names){
    const oldWorld=new RAPIER.World({x:0,y:config.GRAVITY_Y,z:0});
    const oldBody=oldWorld.createRigidBody(RAPIER.RigidBodyDesc.dynamic());
    const oldVertices=new Float32Array(old.pieces[name].colliderPoints.flat());
    oldWorld.createCollider(RAPIER.ColliderDesc.convexHull(oldVertices).setDensity(config.PIECE_DENSITY*config.getPieceWeightMultiplier(name)),oldBody);
    const oldMass=oldBody.mass();oldWorld.free();
    const runtime=await physics.createPhysicsRuntime(meta,[makeInstance(name,`test-${name}`)],half,{gameMode:'online',stageNumber:1});
    try{
      const b=[...runtime.pieces.values()][0], initial=b.body.translation(), startRot=b.body.rotation();
      for(let i=0;i<720;i++) runtime.world.step();
      const end=b.body.translation(), rot=b.body.rotation();
      const upright=Math.abs(rot.x*startRot.x+rot.y*startRot.y+rot.z*startRot.z+rot.w*startRot.w);
      const rest={y:end.y,verticalDrift:end.y-initial.y,uprightDot:upright,sleeping:b.body.isSleeping(),mass:b.originalHullMass,com:b.originalLocalCom};
      b.body.setTranslation({x:half-.08,y:0,z:0},true);
      b.body.setRotation({x:0,y:0,z:0,w:1},true);
      b.body.setLinvel({x:1.4,y:0,z:0},true);b.body.setAngvel({x:0,y:0,z:0},true);
      for(let i=0;i<360;i++) runtime.world.step();
      const edge={x:b.body.translation().x,y:b.body.translation().y};
      assert.ok(rest.sleeping && rest.uprightDot>.999 && Math.abs(rest.verticalDrift)<.005,`${name}: rest stability`);
      assert.ok(Math.abs(rest.mass / oldMass - 1) < 1e-6, `${name}: original game mass preserved`);
      assert.ok(edge.x>half && edge.y<-1,`${name}: edge fall`);
      physicsResults[name]={rest,edge,oldMass,massRatio:rest.mass/oldMass};
    } finally {runtime.world.free();}
  }
  const pair=await physics.createPhysicsRuntime(meta,[makeInstance('Pawn','pair-pawn','d'),makeInstance('Knight','pair-knight','e')],half,{gameMode:'online',stageNumber:1});
  try {
    const p=pair.pieces.get('pair-pawn'), k=pair.pieces.get('pair-knight');
    p.body.setTranslation({x:-.6,y:0,z:0},true);k.body.setTranslation({x:.25,y:0,z:0},true);
    p.body.setLinvel({x:2.5,y:0,z:0},true);k.body.setLinvel({x:0,y:0,z:0},true);
    let contact=false;
    for(let i=0;i<180;i++){pair.world.step();pair.world.contactPair(p.collider,k.collider,()=>{contact=true;});}
    assert.ok(contact && k.body.translation().x>.25,'Pawn/Knight contact response');
    physicsResults.pair={contact,knightFinalX:k.body.translation().x,pawnFinalX:p.body.translation().x};
  } finally {pair.world.free();}
} finally {await vite.close();}
console.log(JSON.stringify({geometry,physics:physicsResults},null,2));
