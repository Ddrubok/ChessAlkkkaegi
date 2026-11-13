// Read-only projection study. No browser, app import, or app mutation.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(root, 'web/package.json'));
const { PerspectiveCamera, Vector3 } = require('three');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const scene = read('web/src/scene.ts'), config = read('web/src/config.ts'), control = read('web/src/power-controls.ts');
const number = (s, re, name) => { const m=s.match(re); if(!m) throw Error(`Missing ${name}`); return Number(m[1]); };
const pitch = number(config, /CAMERA_PITCH_DEG\s*=\s*([\d.]+)/, 'pitch');
const fov = number(scene, /new PerspectiveCamera\(\s*([\d.]+)/, 'fov');
const fitMargin = number(scene, /CAMERA_FIT_MARGIN\s*=\s*([\d.]+)/, 'fit margin');
const reserveFraction = number(control, /Math\.min\(canvasWidth, canvasHeight\)\)\s*\*\s*([\d.]+)/, 'reserve');
const budgetFraction = number(control, /computeViewportPullReserve\(canvasWidth, canvasHeight\)\s*\*\s*([\d.]+)\s*\/\s*1\.5/, 'budget');
const meta=JSON.parse(read('web/public/assets/chess-set.meta.json'));
const border=number(config, /BOARD_BORDER_CELLS\s*=\s*([\d.]+)/, 'border');
const h=(8+2*border)*meta.cellSize/2;
const rad=pitch*Math.PI/180, tangent=Math.tan(fov*Math.PI/360);
const dirs={front:[0,-1],diagonal:[Math.SQRT1_2,-Math.SQRT1_2]};
const boardCorners=[-h,h].flatMap(x=>[-h,h].map(z=>new Vector3(x,0,z)));
const pieceCenters=[1,2,4,6,7,8].flatMap(rank=>[0,3,7].map(file=>new Vector3((3.5-file)*meta.cellSize,0,(rank-4.5)*meta.cellSize)));
function project(view, distance, points){
  const [dx,dz]=dirs[view], cam=new PerspectiveCamera(fov,1,0.05,100);
  cam.position.set(dx*Math.cos(rad)*distance,Math.sin(rad)*distance,dz*Math.cos(rad)*distance);
  cam.lookAt(0,0,0); return points.map(p=>p.clone().project(cam));
}
function study(W,H,view,reserve){
  const [dx,dz]=dirs[view], right=[-dz,dx], ht=tangent*W/H*(1-2*reserve/W),vt=tangent*(1-2*reserve/H);
  let required=0;
  for(const p of boardCorners){const along=p.x*dx+p.z*dz, depth=-along*Math.cos(rad);
    required=Math.max(required,Math.abs(p.x*right[0]+p.z*right[1])/ht-depth,Math.abs(along*Math.sin(rad))/vt-depth);
  }
  const distance=required*fitMargin;
  // Camera aspect must match the CSS canvas when projecting.
  const camera=new PerspectiveCamera(fov,W/H,0.05,100);
  camera.position.set(dx*Math.cos(rad)*distance,Math.sin(rad)*distance,dz*Math.cos(rad)*distance);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  const toPx=p=>{let q=p.clone().project(camera);return [(q.x+1)*W/2,(1-q.y)*H/2]};
  const board=boardCorners.map(toPx), pieces=pieceCenters.map(toPx);
  const xs=board.map(p=>p[0]), ys=board.map(p=>p[1]);
  const pieceYs=pieces.map(p=>p[1]);
  const bbox={left:Math.min(...xs),right:Math.max(...xs),top:Math.min(...ys),bottom:Math.max(...ys)};
  bbox.width=bbox.right-bbox.left;bbox.height=bbox.bottom-bbox.top;
  const points=[...board,...pieces];
  const clearance=Math.min(...points.flatMap(([x,y])=>[x,W-x,y,H-y]));
  const boardClearance=Math.min(...board.flatMap(([x,y])=>[x,W-x,y,H-y]));
  return {distance,boardBBox:bbox,boardHeightFraction:bbox.height/H,boardAreaBBoxFraction:bbox.width*bbox.height/(W*H),sampledPieceYRange:[Math.min(...pieceYs),Math.max(...pieceYs)],sampledPieceVerticalReachUpperBound:(H-(Math.max(...pieceYs)-Math.min(...pieceYs)))/2,boardCornerClearance:boardClearance,sampledPieceCenterClearance:Math.min(...pieces.flatMap(([x,y])=>[x,W-x,y,H-y])),sampledMinClearance:clearance,safe150Distance:clearance,safeLinearD:clearance/1.5,safeQuadraticD:clearance/Math.sqrt(1.5)};
}
const sizes=[{viewport:[800,450],canvas:[800,248],kind:'base HUD 54+148'}, {viewport:[800,450],canvas:[800,238],kind:'short landscape banners 100+112'}, {viewport:[1366,768],canvas:[1366,566],kind:'base HUD 54+148'}, {viewport:[1920,1080],canvas:[1920,878],kind:'base HUD 54+148'}, ...[[800,450],[1366,768],[1920,1080]].map(x=>({viewport:x,canvas:x,kind:'full canvas hypothetical'}))];
const cases=[];
for(const size of sizes){const [W,H]=size.canvas;for(const view of Object.keys(dirs)) for(const reserveFractionCase of [0.18,0.16,0]){
 const reserve=Math.min(W,H)*reserveFractionCase;
 const s=study(W,H,view,reserve);
 cases.push({...size,view,reserveFraction:reserveFractionCase,reserve,existingD:Math.min(180,reserve*budgetFraction/1.5),...s,
 candidates:{linear180:{required150:270,reachable:s.safe150Distance>=270,r30:54},linear240:{required150:360,reachable:s.safe150Distance>=360,r30:72},quadratic180:{required150:180*Math.sqrt(1.5),reachable:s.safe150Distance>=180*Math.sqrt(1.5),r30:180*Math.sqrt(.3)},scaledQuadratic:{D:s.safeQuadraticD,required150:s.safe150Distance,r30:s.safeQuadraticD*Math.sqrt(.3)}}});
}}
const out={source:{pitch,fov,fitMargin,reserveFraction,budgetFraction,cellSize:meta.cellSize,border,boardHalfExtent:h},notes:['Geometry uses board corners at y=0 and sampled piece centers at ranks 1,2,4,6,7,8/files a,d,h. Piece hulls, red dots, HUD occlusion and live release are not measured.','Clearance is the minimum Euclidean distance to any canvas edge for board corners and sampled piece centers; all-direction guarantee for these samples requires pull <= clearance.'],cases};
fs.writeFileSync(path.join(root,'qa/darius-input-2026-11-13/geometry-study.json'),JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify(out.source));
for(const c of cases) console.log(`${c.viewport.join('x')} canvas ${c.canvas.join('x')} ${c.view} r${c.reserveFraction}: board ${(c.boardHeightFraction*100).toFixed(1)}% h, D ${c.existingD.toFixed(1)}, safe150 ${c.safe150Distance.toFixed(1)}, max linear D ${c.safeLinearD.toFixed(1)}, max quadratic D ${c.safeQuadraticD.toFixed(1)}`);
