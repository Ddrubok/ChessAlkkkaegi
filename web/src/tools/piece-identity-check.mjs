import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
const vite=await createServer({root:fileURLToPath(new URL('../..',import.meta.url)),configFile:false,logLevel:'error',server:{middlewareMode:true,hmr:false}});
try{
  const {pieceIdentityCopy:copy}=await vite.ssrLoadModule('/src/piece-identity.ts');
  assert.match(copy('Rook','stage',false,false).condition,/150%/);
  assert.match(copy('Rook','stage',true,false).condition,/100%/);
  assert.match(copy('Queen','online',true,false).condition,/150%/);
  for(const mode of ['online','puzzle']){
    assert.match(copy('King',mode,false,false).condition,/특수기 없음/);
    assert.match(copy('Pawn',mode,false,false).condition,/승격 없음/);
  }
  assert.match(copy('Pawn','stage',false,false,false).condition,/승격 없음/);
  assert.match(copy('Pawn','stage',false,false,true).condition,/생존 시 승격/);
  assert.match(copy('King','stage',false,true).condition,/사용 완료/);
  assert.match(copy('Bishop','stage',true,false).detail,/회전/);
  assert.match(copy('Knight','stage',false,false).detail,/최소 도약/);
  console.log('piece identity: actual spin caps, mode/stage restrictions, spent ability and jump correction passed');
}finally{await vite.close();}
