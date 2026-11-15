import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { Scene, Mesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
const root=fileURLToPath(new URL('../..',import.meta.url));
const vite=await createServer({root,configFile:false,mode:'itch',logLevel:'error',server:{middlewareMode:true,hmr:false,ws:false}});
const rows=[];
try{
  const physics=await vite.ssrLoadModule('/src/physics.ts'), turn=await vite.ssrLoadModule('/src/turn.ts');
  const config=await vite.ssrLoadModule('/src/config.ts'), aim=await vite.ssrLoadModule('/src/aim.ts');
  const meta=JSON.parse(await readFile(new URL('../../public/assets/chess-set.meta.json',import.meta.url),'utf8'));
  const glb=await readFile(new URL('../../public/assets/chess-pieces.glb',import.meta.url));
  const model=await new Promise((ok,no)=>new GLTFLoader().parse(glb.buffer.slice(glb.byteOffset,glb.byteOffset+glb.byteLength),'',ok,no));
  const geometries=new Map();model.scene.traverse(o=>{if(o.isMesh)geometries.set(o.name,o.geometry)});
  async function setup(type='King',ally=true){
    const list=[{id:'own',type,side:'white',startingSquare:{file:'c',rank:2}},
      {id:'enemy',type:'Pawn',side:'black',startingSquare:{file:'f',rank:7}}];
    if(ally)list.push({id:'ally',type:'Pawn',side:'white',startingSquare:{file:'f',rank:2}});
    const p=await physics.createPhysicsRuntime(meta,list,config.deriveBoardHalfExtent(meta.cellSize),{gameMode:'stage',stageNumber:10});
    physics.preSettlePhysics(p);
    const scene=new Scene(),pieceMeshes=new Map();
    for(const [id,b]of p.pieces){const mesh=new Mesh(geometries.get(b.instance.type));mesh.scale.setScalar(b.uniformScale);scene.add(mesh);pieceMeshes.set(id,mesh)}
    const t=turn.createTurnRuntime(p,{scene,pieceMeshes,controls:{enabled:true}},{maxLaunchSpeed:config.MAX_LAUNCH_SPEED,strikeHeightRatio:config.STRIKE_HEIGHT_RATIO});
    turn.setTurnGameMode(t,'stage');return {p,t};
  }
  function fire(p,t,spin=0){
    const b=p.pieces.get('own'),com=b.body.worldCom();
    const accepted=turn.queueTurnLaunch(t,{pieceId:'own',direction:new Vector3(1,0,0),normalizedPower:.6,
      applicationPoint:new Vector3(com.x,com.y,com.z+spin),speedMultiplier:1});
    assert(accepted.accepted,accepted.reason);assert(turn.applyPendingLaunchBeforeStep(t));
    return {mass:b.body.mass(),speed:t.lastLaunchInitialSpeed,angular:Math.hypot(...Object.values(b.body.angvel()))};
  }
  {
    const {p,t}=await setup();try{
      const before={...p.pieces.get('own').body.translation()},other={...p.pieces.get('ally').body.translation()};
      assert(turn.executeKingSwap(t,'own','ally'));
      const after=p.pieces.get('own').body.translation();
      assert(Math.hypot(after.x-other.x,after.y-other.y,after.z-other.z)<1e-6);
      assert(!turn.executeKingDefense(t,'own'));assert.equal(t.currentSide,'white');assert.equal(t.phase,'ready');
      rows.push({check:'king-swap-once',before,after:{...after},turnConsumed:false});
    }finally{p.world.free()}
  }
  {
    const {p,t}=await setup('King',false);try{
      assert(turn.executeKingDefense(t,'own'));assert(p.pieces.get('own').body.isFixed());
      assert(!turn.executeKingDefense(t,'own'));assert(!turn.executeKingSwap(t,'own','enemy'));
      assert(turn.canSelectTurnPiece(t,'own'));
      const launch=fire(p,t);assert(p.pieces.get('own').body.isDynamic());
      rows.push({check:'king-only-defense-then-legal-shot',...launch});
    }finally{p.world.free()}
  }
  const mass=[];
  for(const multiplier of [1,1.25]){
    const {p,t}=await setup('Pawn',false);try{
      const b=p.pieces.get('own');if(multiplier!==1){b.body.setAdditionalMass(b.body.mass()*(multiplier-1),true);b.body.recomputeMassPropertiesFromColliders()}
      mass.push({multiplier,...fire(p,t)});
    }finally{p.world.free()}
  }
  assert(Math.abs(mass[0].speed-mass[1].speed)<1e-6);assert(Math.abs(mass[1].mass/mass[0].mass-1.25)<1e-5);
  rows.push({check:'mass-only-does-not-reduce-launch-speed',samples:mass.map(r=>({...r,momentum:r.mass*r.speed}))});
  for(const type of ['Bishop','Queen']){
    const samples=[];
    for(const spin of [0,.1]){const {p,t}=await setup(type,false);try{samples.push({spin,...fire(p,t,spin)})}finally{p.world.free()}}
    assert(samples[1].angular>samples[0].angular);rows.push({check:type+'-off-center-spin',samples});
  }
  assert.equal(aim.getAimMaxPower({isRook:true,hasCustomSpin:false}),1.5);
  assert.equal(aim.getAimMaxPower({isRook:true,hasCustomSpin:true}),1);
  assert.equal(aim.getAimMaxPower({isRook:true,isBishop:true,hasCustomSpin:true}),1.5);
  rows.push({check:'rook-center-vs-spin-queen-spin-limits',rookCenter:1.5,rookSpin:1,queenSpin:1.5});
  await writeFile(new URL('../../../qa/strategy-experiments-2026-11-15/physics/role-check.json',import.meta.url),JSON.stringify({scope:'real local Rapier ability/impulse probes, no human claim',rows},null,2));
  console.log('PASS: King swap/defense/only-piece launch, mass-only momentum, Bishop/Queen spin and role power limits');
}finally{await vite.close()}
