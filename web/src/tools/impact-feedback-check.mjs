import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'vite';
import {Scene, Mesh, PerspectiveCamera, Vector3} from 'three';
const vite=await createServer({configFile:false,logLevel:'error',server:{middlewareMode:true,hmr:false}});
try {
 const motion=await vite.ssrLoadModule('/src/ui-motion.ts');
 const {createImpactFeedback}=await vite.ssrLoadModule('/src/impact-feedback.ts');
 const camera=new PerspectiveCamera(45,16/9,.01,100);camera.position.set(3,4,5);camera.lookAt(0,0,0);camera.updateMatrixWorld();
 const before=camera.position.clone(), target=new Vector3();let rendered,throws=false;
 const scene={scene:new Scene(),camera,boardHalfExtent:2,controls:{target},renderer:{render(){rendered=camera.position.clone();if(throws)throw Error('render failed');}}};
 const fx=createImpactFeedback(scene);
 const hit={pairKey:'a|b',point:{x:0,y:.1,z:0},direction:{x:1,y:0,z:0},strength:1};
 fx.add([hit],100,false);fx.render(125,true);
 assert.ok(rendered.distanceTo(before)>0,'strong live hit has bounded render-only offset');
 assert.ok(rendered.distanceTo(before)<.02,'kick remains small');
 assert.deepEqual(camera.position,before);assert.deepEqual(target,new Vector3());
 throws=true;assert.throws(()=>fx.render(130,true),/render failed/);assert.deepEqual(camera.position,before);throws=false;
 fx.render(201,true);assert.deepEqual(rendered,before);assert.equal(scene.scene.children.filter(c=>c.visible).length,0);
 fx.add([hit],300,true);fx.render(310,false);assert.deepEqual(rendered,before);
 motion.setMotionReduced(true);fx.add([hit],400,false);fx.render(410,true);assert.deepEqual(rendered,before);
 assert.equal(scene.scene.children.filter(c=>c.visible).length,0);motion.setMotionReduced(false);
 fx.add([hit],500,false);fx.reset();fx.render(520,true);assert.deepEqual(rendered,before);

 const physics=await vite.ssrLoadModule('/src/physics.ts'),turn=await vite.ssrLoadModule('/src/turn.ts');
 const {PIECE_INSTANCES}=await vite.ssrLoadModule('/src/layout.ts');
 const {applyOnlineStateSnapshot}=await vite.ssrLoadModule('/src/online.ts');
 const meta=JSON.parse(await readFile(new URL('../../public/assets/chess-set.meta.json',import.meta.url),'utf8'));
 const p=await physics.createPhysicsRuntime(meta,PIECE_INSTANCES,meta.cellSize*4);
 try {
  const s={scene:new Scene(),controls:{enabled:true},pieceMeshes:new Map([...p.pieces.keys()].map(id=>[id,new Mesh()])),breakableWallMeshes:new Map()};
  const runtime=turn.createTurnRuntime(p,s,{maxLaunchSpeed:11,strikeHeightRatio:0});
  let live=0,removed=0;runtime.onPieceRemoved=()=>removed++;
  const one=[...p.pieces.values()][0];one.body.setTranslation({x:0,y:-100,z:0},true);
  turn.updateTurnAfterStep(runtime,1/120,()=>live++);turn.updateTurnAfterStep(runtime,1/120,()=>live++);
  assert.equal(live,1);assert.equal(removed,1,'a fallen body is removed exactly once');
  const two=[...p.pieces.values()][0];two.body.setTranslation({x:0,y:-100,z:0},true);
  turn.updateTurnAfterStep(runtime,1/120);assert.equal(live,1,'recovery/replay stepping has no live feedback callback');
  // Settled snapshot drops a body through the existing input cleanup callback only.
  const snap={kind:'stateSnapshot',turnIndex:0,pieces:[...p.pieces.values()].slice(1).map(b=>({id:b.instance.id,p:Object.values(b.body.translation()),q:Object.values(b.body.rotation())}))};
  const serial=runtime.feedbackResetSerial;applyOnlineStateSnapshot(runtime,snap);
  assert.equal(live,1);assert.equal(removed,3);assert.equal(runtime.feedbackResetSerial,serial+1);
  turn.resetTurnRuntime(runtime);assert.equal(runtime.feedbackResetSerial,serial+2);
 } finally {p.world.free();}
 console.log('PASS render-only camera restored (including render failure), aim/reduced/reset, single live ring-out, silent replay/snapshot and scene reset');
}finally{await vite.close();}
