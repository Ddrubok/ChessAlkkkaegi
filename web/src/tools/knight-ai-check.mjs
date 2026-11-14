import assert from 'node:assert/strict';
import { Box3, Vector3 } from 'three';
import { createServer } from 'vite';

const vite = await createServer({ logLevel: 'error', server: { middlewareMode: true, hmr: false } });
try {
  const { planKnightShot } = await vite.ssrLoadModule('/src/knight-ai.ts');
  const body = (id, side, x, z) => ({id, side,
    bounds: new Box3(new Vector3(x-.14,0,z-.14),new Vector3(x+.14,.7,z+.14))});
  const source = body('black-custom-id','black',0,.9), target=body('white-custom-id','white',0,-.9);
  const base={source,targets:[target],bodies:[source,target],obstacles:[],holes:[],
    boardHalfExtent:2.3,boardTop:0,gameMode:'stage',maxLaunchSpeed:11,speedMultiplier:1,
    variationDegrees:0,maximumPower:1};
  const shot=planKnightShot(base);
  assert.ok(shot.predictedContact && shot.nominalLandingSafe, 'reachable target has a contact candidate with on-board nominal landing');
  assert.ok(shot.power<.35 && shot.power>0, 'Knight can use legal weak input below generic AI floor');
  assert.deepEqual(planKnightShot(base),shot,'same visible state gives same candidate');
  const interceptor=body('interceptor','white',0,-.2);
  interceptor.bounds.max.y=2;
  const intercepted=planKnightShot({...base,bodies:[source,interceptor,target]});
  assert.equal(intercepted.targetPieceId,interceptor.id,'reported target is the predicted first enemy contact');
  const saved=JSON.stringify([source,target]);
  for(let i=0;i<20;i++)planKnightShot({...base,variationDegrees:3.648});
  assert.equal(JSON.stringify([source,target]),saved,'candidate search does not mutate live bounds');
  const boosted=planKnightShot({...base,speedMultiplier:1.2});
  assert.ok(boosted.power<shot.power,'stage speed boost is considered before candidate selection');
  const obstructed=planKnightShot({...base,obstacles:[new Box3(new Vector3(-2,0,-.3),new Vector3(2,5,.3))]});
  assert.equal(obstructed.predictedContact,false,'solid tall wall blocks target; not a guaranteed hit');
  const hole=planKnightShot({...base,holes:[{id:'all',minX:-3,maxX:3,minZ:-3,maxZ:3}]});
  assert.equal(hole.nominalLandingSafe,false,'a hole cannot be called a safe landing');
  const edgeSource=body('edge','black',2.1,.9), edgeTarget=body('edge-target','white',2.1,-.9);
  const edge=planKnightShot({...base,source:edgeSource,targets:[edgeTarget],bodies:[edgeSource,edgeTarget]});
  assert.ok(edge.power<=1 && edge.power>0 && Number.isFinite(edge.direction.x),'edge fixture returns a legal shot');
  console.log('[PASS] Knight reachable flight, weak input, stage speed, deterministic read-only candidates, obstacle, hole and edge checks');
} finally {await vite.close();}
