import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {readFile} from 'node:fs/promises';
const vite=await createServer({configFile:false,logLevel:'error',server:{middlewareMode:true,hmr:false}});
try {
 const m=await vite.ssrLoadModule('/src/ui-motion.ts');
 for(const a of [false,true])for(const b of [false,true])assert.equal(m.resolveReducedMotion(a,b),a||b);
 assert.equal(m.isMotionReduced(),false,'SSR default');
 let plays=0,cancels=0,notifies=0,options;
 const element={animate:(_,o)=>{plays++;options=o;return {cancel(){cancels++;},addEventListener(){}};}};
 const unsub=m.subscribeMotion(()=>notifies++);
 m.playUiMotion(element,'panel'); assert.equal(options.duration,180);assert.notEqual(options.fill,'forwards');
 m.playUiMotion(element,'tab');assert.equal(cancels,1);assert.equal(options.duration,120);
 m.setMotionReduced(true);assert.equal(cancels,2);assert.equal(notifies,1);
 m.setMotionReduced(true);assert.equal(notifies,1);
 m.playUiMotion(element,'panel');assert.equal(plays,2);
 m.cancelUiMotion(element);unsub();m.setMotionReduced(false);assert.equal(notifies,1);
 m.playUiMotion({},'panel');
 const panel={...element,querySelectorAll:()=>[]};
 const lifecycle=m.createPanelMotion();const before=plays;
 lifecycle.refresh(panel,'daily');lifecycle.refresh(panel,'daily');lifecycle.refresh(panel,'weekly');lifecycle.refresh(panel,'weekly');
 assert.equal(plays-before,2,'initial and actual tab only');lifecycle.cancel();
 for(let i=0;i<20;i++){lifecycle.refresh(panel);lifecycle.cancel();}
 await import('./headless-browser-env.mjs');
 const {Vector3}=await import('three');
 const {startLaunchPulse,updateLaunchPulses}=await vite.ssrLoadModule('/src/aim.ts');
 const mesh={scale:new Vector3(2,2,2)},runtime={sceneRuntime:{pieceMeshes:new Map([['p',mesh]])},pulses:new Map()};
 startLaunchPulse(runtime,'p');const started=runtime.pulses.get('p').startedAt;
 updateLaunchPulses(runtime,started+60);assert.ok(Math.abs(mesh.scale.x-2.12)<1e-6);
 updateLaunchPulses(runtime,started+121);assert.equal(mesh.scale.x,2);assert.equal(runtime.pulses.size,0);
 startLaunchPulse(runtime,'p');updateLaunchPulses(runtime,runtime.pulses.get('p').startedAt+60);
 m.setMotionReduced(true);assert.equal(mesh.scale.x,2,'active pulse immediately restored');
 startLaunchPulse(runtime,'p');assert.equal(runtime.pulses.size,0,'reduced mode creates no pulse');
 m.setMotionReduced(false);
 const physics=await vite.ssrLoadModule('/src/physics.ts');
 const {PIECE_INSTANCES}=await vite.ssrLoadModule('/src/layout.ts');
 const meta=JSON.parse(await readFile(new URL('../../public/assets/chess-set.meta.json',import.meta.url),'utf8'));
 const states=[];
 for(const reduced of [false,true]) {
  m.setMotionReduced(reduced);
  const world=await physics.createPhysicsRuntime(meta,PIECE_INSTANCES,meta.cellSize*4);
  try {
   const binding=[...world.pieces.values()].find(p=>p.instance.type==='Pawn');
   binding.body.applyImpulse({x:.02,y:.001,z:.01},true);
   startLaunchPulse(runtime,'p');
   for(let i=0;i<120;i++){world.world.step();updateLaunchPulses(runtime,performance.now()+i*10);}
   states.push([...world.pieces.values()].map(p=>({id:p.instance.id,position:p.body.translation(),rotation:p.body.rotation(),velocity:p.body.linvel(),angular:p.body.angvel()})));
  } finally {world.world.free();}
 }
 assert.deepEqual(states[0],states[1],'motion setting must not change real Rapier body state');m.setMotionReduced(false);
 const savedStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');const savedMedia=globalThis.matchMedia;
 try {
  for(const scenario of ['malformed','denied','system']) {
   Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){if(scenario==='denied')throw Error('denied');return {getItem:()=>'{broken',setItem(){throw Error('quota');}};}});
   globalThis.matchMedia=()=>Object.assign(new EventTarget(),{matches:scenario==='system'});
   const isolated=await vite.ssrLoadModule(`/src/ui-motion.ts?test=${scenario}`);
   assert.equal(isolated.getMotionPreference(),false);assert.equal(isolated.isMotionReduced(),scenario==='system');
   isolated.setMotionReduced(true);assert.equal(isolated.isMotionReduced(),true,'storage failure still applies');
  }
 } finally {Object.defineProperty(globalThis,'localStorage',savedStorage);globalThis.matchMedia=savedMedia;}
 console.log('PASS identical Rapier input/state across motion modes; malformed/denied/quota storage and OS precedence');
 console.log('PASS motion OR policy, SSR, duplicate cancel, live reduction, timings, no API fallback');
} finally {await vite.close();}
