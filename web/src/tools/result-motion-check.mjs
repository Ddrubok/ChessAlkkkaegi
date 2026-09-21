import assert from 'node:assert/strict';
import {createServer} from 'vite';
const vite=await createServer({configFile:false,logLevel:'error',server:{middlewareMode:true,hmr:false}});
try {
 const m=await vite.ssrLoadModule('/src/result-motion.ts');
 const policy=await vite.ssrLoadModule('/src/ui-motion.ts');
 let plays=0;
 const node=()=>({animate(){plays++;return {cancel(){},addEventListener(){}};}});
 const root={hidden:false,isConnected:true};const title=node();const row=node();
 const token=m.beginResultMotion(root,'match-1',title);
 m.beginResultMotion(root,'match-1',title);assert.equal(plays,1);
 m.highlightResultProgress(root,token,row,'q',0,1,true);
 m.highlightResultProgress(root,token,row,'q',0,1,true);assert.equal(plays,2);
 m.highlightResultProgress(root,token,row,'pending',0,1,false);assert.equal(plays,2);
 m.closeResultMotion(root);m.highlightResultProgress(root,token,row,'late',0,2,true);assert.equal(plays,2);
 const token2=m.beginResultMotion(root,'match-2',title,false);assert.equal(plays,2,'unknown side has no title animation');
 m.highlightResultProgress(root,token,row,'old-result',0,3,true);assert.equal(plays,2,'stale generation');
 policy.setMotionReduced(true);m.highlightResultProgress(root,token2,row,'q',0,1,true);assert.equal(plays,2);
 m.closeResultMotion(root);policy.setMotionReduced(false);
 console.log('PASS result identity, duplicate progress, pending/error, closed/stale token, unknown side, reduced motion');
} finally {await vite.close();}
