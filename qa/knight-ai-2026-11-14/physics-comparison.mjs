import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from '../../web/node_modules/vite/dist/node/index.js';
import { Mesh, MeshBasicMaterial, Scene, Quaternion, Vector3 } from '../../web/node_modules/three/build/three.module.js';
import { GLTFLoader } from '../../web/node_modules/three/examples/jsm/loaders/GLTFLoader.js';

const out = resolve(process.argv[2] ?? 'qa/knight-ai-2026-11-14/physics-before');
const perturbation = process.argv[3] ?? 'none';
await mkdir(out, { recursive: false });
const vite = await createServer({root:resolve('web'),logLevel:'error',appType:'custom',server:{middlewareMode:true,hmr:false,ws:false},cacheDir:resolve('.orca/knight-physics-vite')});
const results = [];
console.info = () => {}; // Keep the saved case measurements, rather than flooding the terminal with per-body diagnostics.
try {
  const [ai, config, physics, turn] = await Promise.all(['ai','config','physics','turn'].map(name=>vite.ssrLoadModule(`/src/${name}.ts`)));
  const meta = JSON.parse(await readFile('web/public/assets/chess-set.meta.json','utf8'));
  const bytes = await readFile('web/public/assets/chess-pieces.glb');
  const gltf = await new Promise((yes,no)=>new GLTFLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'',yes,no));
  const geometries=new Map();
  gltf.scene.traverse(o=>{if(o.isMesh)geometries.set(o.name,o.geometry);});
  const H=config.deriveBoardHalfExtent(meta.cellSize);
  const layouts = [
    {name:'close',source:[0,0,0],target:[0,0,-.6]},
    {name:'middle',source:[0,0,.9],target:[0,0,-.9]},
    {name:'far',source:[0,0,1.65],target:[0,0,-1.65]},
    {name:'east',source:[H-.3,0,.9],target:[H-.3,0,-.9]},
    {name:'west',source:[-H+.3,0,.9],target:[-H+.3,0,-.9]},
    {name:'north',source:[0,0,-H+.3],target:[0,0,-H+.9]},
    {name:'south',source:[0,0,H-.3],target:[0,0,H-.9]},
    {name:'tipped',source:[0,0,.9],target:[0,0,-.9],tip:Math.PI/4},
    {name:'lying',source:[0,0,.9],target:[0,0,-.9],tip:Math.PI/2},
    {name:'raised',source:[0,.4,.9],target:[0,0,-.9]},
    {name:'friendly-blocker',source:[0,0,.9],target:[0,0,-.9],blocker:true},
    {name:'corner',source:[H-.3,0,H-.3],target:[-H+.3,0,-H+.3]},
  ];
  for (const stage of [1,4,7,10]) for (const layout of layouts) {
    const instances=[{id:'black-knight-b8',type:'Knight',side:'black',startingSquare:{file:'b',rank:8}},
      {id:'white-pawn-d2',type:'Pawn',side:'white',startingSquare:{file:'d',rank:2}}];
    if(layout.blocker)instances.push({id:'black-pawn-d7',type:'Pawn',side:'black',startingSquare:{file:'d',rank:7}});
    const p=await physics.createPhysicsRuntime(meta,instances,H);
    const source=p.pieces.get(instances[0].id), target=p.pieces.get(instances[1].id);
    source.body.setTranslation({x:layout.source[0],y:layout.source[1],z:layout.source[2]},true);
    target.body.setTranslation({x:layout.target[0],y:layout.target[1],z:layout.target[2]},true);
    if(layout.tip)source.body.setRotation(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),layout.tip),true);
    if(layout.blocker)p.pieces.get('black-pawn-d7').body.setTranslation({x:0,y:0,z:.35},true);
    // Settle only standing layouts; tipped/raised are deliberately frozen pose fixtures.
    if(!layout.tip&&!layout.source[1])physics.preSettlePhysics(p);
    for(const b of p.pieces.values()){b.body.setLinvel({x:0,y:0,z:0},true);b.body.setAngvel({x:0,y:0,z:0},true);b.body.sleep();}
    const scene=new Scene(), pieceMeshes=new Map();
    for(const b of p.pieces.values()){
      const m=new Mesh(geometries.get(b.instance.type),new MeshBasicMaterial());
      m.position.copy(b.body.translation());m.quaternion.copy(b.body.rotation());m.updateMatrixWorld(true);
      scene.add(m);pieceMeshes.set(b.instance.id,m);
    }
    const s={scene,pieceMeshes,controls:{enabled:true}};
    const t=turn.createTurnRuntime(p,s,{maxLaunchSpeed:config.MAX_LAUNCH_SPEED,strikeHeightRatio:config.STRIKE_HEIGHT_RATIO});
    turn.setTurnGameMode(t,'stage');t.currentSide='black';t.phase='ready';
    const a=ai.createAiRuntime(p,s,t,meta.cellSize,()=> 'stage',()=>stage);
    const before=p.world.takeSnapshot();
    const start=performance.now();ai.updateAiRuntime(a,0);ai.updateAiRuntime(a,800);const decisionMs=performance.now()-start;
    const pending=t.pendingLaunch;
    if(!pending)throw new Error(`no pending shot ${layout.name}/${stage}`);
    if(perturbation.startsWith('angle'))pending.direction.applyAxisAngle(new Vector3(0,1,0), (perturbation.endsWith('+')?1:-1)*Math.PI/180);
    if(perturbation.startsWith('power'))pending.normalizedPower=Math.max(0,Math.min(1,pending.normalizedPower+(perturbation.endsWith('+')?.01:-.01)));
    const request={pieceId:pending.pieceId,power:pending.normalizedPower,direction:pending.direction.toArray(),speedMultiplier:pending.speedMultiplier};
    const worldUnchanged=Buffer.compare(Buffer.from(before),Buffer.from(p.world.takeSnapshot()))===0;
    let hit=false,steps=0;
    turn.applyPendingLaunchBeforeStep(t);
    const initialVelocity={...p.pieces.get(request.pieceId).body.linvel()};
    while(t.phase!=='ready'&&t.phase!=='match-over'&&steps<2400){
      p.world.step();
      if(p.pieces.has(source.instance.id)&&p.pieces.has(target.instance.id))p.world.contactPair(source.collider,target.collider,(_,flipped)=>{hit=true;});
      turn.updateTurnAfterStep(t,config.FIXED_STEP);steps++;
    }
    results.push({stage,layout:layout.name,request,worldUnchanged,decisionMs,hit,
      sourceSurvived:p.pieces.has(source.instance.id),targetSurvived:p.pieces.has(target.instance.id),
      forced:t.forcedSettleCount>0,settled:t.phase==='ready'||t.phase==='match-over',steps,initialVelocity});
    p.world.free();
  }
  const summary={cases:results.length,hits:results.filter(r=>r.hit).length,selfOut:results.filter(r=>!r.sourceSurvived).length,
    targetOut:results.filter(r=>!r.targetSurvived).length,forced:results.filter(r=>r.forced).length,
    p95DecisionMs:results.map(r=>r.decisionMs).sort((a,b)=>a-b)[Math.floor(results.length*.95)],
    worldUnchanged:results.every(r=>r.worldUnchanged)};
  const sources={};for(const name of ['ai.ts','launch.ts','knight-ai.ts'])try{sources[name]=createHash('sha256').update(await readFile(`web/src/${name}`)).digest('hex');}catch{}
  await writeFile(resolve(out,'result.json'),JSON.stringify({scope:'Fixed physical fixtures, no human players. No terrain gimmicks; stage affects AI bias/speed only. Tipped/raised snapshots are intentionally frozen.',perturbation,sources,summary,results},null,2));
  console.log(JSON.stringify(summary));
} finally { await vite.close(); }
