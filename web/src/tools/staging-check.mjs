import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { loadConfigFromFile } from 'vite';
const expected = 'https://eohasrpzjwtzexoogwdt.supabase.co';
const code = stripTypeScriptTypes(await readFile(new URL('../supabase-client.ts',import.meta.url),'utf8'));
for (const mode of ['staging','production']) {
  const storage = new Map([['ca_supabase_url','https://stored.example.com'],['ca_supabase_anon_key','stored-key']]);
  const ctx = vm.createContext({ localStorage: {
    getItem:k=>storage.get(k), setItem:(k,v)=>storage.set(k,v), removeItem:k=>storage.delete(k),
  }});
  const env = { MODE:mode, VITE_SUPABASE_URL:expected, VITE_SUPABASE_ANON_KEY:'sb_publishable_test' };
  const dep = new vm.SyntheticModule(['createClient'],function(){this.setExport('createClient',(url,key)=>({url,key}));},{context:ctx});
  const module = new vm.SourceTextModule(code,{context:ctx,initializeImportMeta:meta=>{meta.env=env;}});
  await module.link(()=>dep); await module.evaluate();
  const api = module.namespace;
  if(mode==='staging') {
    assert.equal(api.getSavedSupabaseConfig().url,expected);
    assert.equal(api.getSupabaseClient().url,expected);
    assert.throws(()=>api.saveSupabaseConfig({url:'https://stored.example.com',anonKey:'stored-key'}),/fixed/);
    api.saveSupabaseConfig({url:expected,anonKey:env.VITE_SUPABASE_ANON_KEY});
    api.clearSupabaseConfig();
    assert.equal(storage.get('ca_supabase_url'),'https://stored.example.com');
    env.VITE_SUPABASE_ANON_KEY='';
    assert.equal(api.getSavedSupabaseConfig(),null);
  } else {
    assert.equal(api.getSavedSupabaseConfig().url,'https://stored.example.com');
    api.saveSupabaseConfig({url:'https://custom.example.com',anonKey:'custom'});
    assert.equal(storage.get('ca_supabase_url'),'https://custom.example.com');
    api.clearSupabaseConfig();
    assert.equal(api.getSavedSupabaseConfig().url,expected);
  }
}
const path = fileURLToPath(new URL('../../vite.config.ts',import.meta.url));
const saved = {url:process.env.VITE_SUPABASE_URL,key:process.env.VITE_SUPABASE_ANON_KEY};
try {
  process.env.VITE_SUPABASE_URL=expected;
  process.env.VITE_SUPABASE_ANON_KEY='sb_publishable_test';
  const config = (await loadConfigFromFile({command:'build',mode:'staging'},path)).config;
  assert.equal(config.build.outDir,'dist-staging');
  assert.equal(config.server.port,5204);
  assert.equal(config.server.strictPort,true);
  process.env.VITE_SUPABASE_URL='https://production.example.com';
  await assert.rejects(loadConfigFromFile({command:'build',mode:'staging'},path,undefined,'silent'),/Staging requires/);
  const prod = (await loadConfigFromFile({command:'build',mode:'production'},path)).config;
  assert.equal(prod.build.outDir,undefined);
  assert.equal(prod.server,undefined);
} finally {
  for(const [key,value] of [['VITE_SUPABASE_URL',saved.url],['VITE_SUPABASE_ANON_KEY',saved.key]]) {
    if(value===undefined) delete process.env[key]; else process.env[key]=value;
  }
}
console.log('PASS staging isolation: fixed backend, no saved-config override, missing config denied, separate output/port, production behavior preserved');
