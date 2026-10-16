import {createServer} from '../../web/node_modules/vite/dist/node/index.js';
const server=await createServer({root:'web',logLevel:'error',define:{'import.meta.env.VITE_SUPABASE_URL':'""','import.meta.env.VITE_SUPABASE_ANON_KEY':'""'},server:{host:'127.0.0.1',port:5227,strictPort:true,hmr:false},plugins:[{name:'first-play-observer',enforce:'pre',transform(code,id){
 if(id.replaceAll('\\','/').endsWith('/src/main.ts'))return code.replace('  if (PLATFORM.id !== "poki") await AdManager.init();','  window.__firstQA={tutorialManager,turnRuntime,inputRuntime,physicsRuntime,sceneRuntime,aiRuntime,gameModeRuntime,menuRuntime,metaRuntime,startModeAction,resetBoard,queueTurnLaunch};\n  if (PLATFORM.id !== "poki") await AdManager.init();');
 if(id.replaceAll('\\','/').endsWith('/src/input.ts'))return code.replace('  policy.onModeChanged(initialMode);','  window.__firstPick=(x,y)=>raycastNearestPiece(runtime,{clientX:x,clientY:y});\n  policy.onModeChanged(initialMode);');
}}]});
await server.listen();console.log('First-play QA server: http://127.0.0.1:5227');
