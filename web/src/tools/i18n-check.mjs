import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import './headless-browser-env.mjs';
const vite=await createServer({root:fileURLToPath(new URL('../..',import.meta.url)),configFile:false,logLevel:'error',server:{middlewareMode:true,hmr:false}});
try {
 const {LOCALES,I18nManager,SUPPORTED_LANGUAGES}=await vite.ssrLoadModule('/src/i18n.ts');
 const flatten=d=>Object.fromEntries(Object.entries(d).flatMap(([ns,values])=>Object.entries(values).map(([key,value])=>[`${ns}.${key}`,value])));
 const dictionaries=Object.fromEntries(Object.entries(LOCALES).map(([lang,d])=>[lang,flatten(d)]));
 const keys=[...new Set(Object.values(dictionaries).flatMap(Object.keys))];
 for(const file of readdirSync(new URL('..',import.meta.url)).filter(f=>f.endsWith('.ts'))){const source=readFileSync(new URL('../'+file,import.meta.url),'utf8');for(const match of source.matchAll(/I18nManager\.t\(["']([^"']+)["']/g))assert.ok(dictionaries.en[match[1]],file+': unknown translation '+match[1]);}
 const parameters=text=>[...text.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort();
 for(const {code} of SUPPORTED_LANGUAGES) {
  for(const key of keys) {const text=dictionaries[code][key];assert.ok(typeof text==='string'&&text.trim(),`${code}: missing ${key}`);assert.deepEqual(parameters(text),parameters(dictionaries.en[key]),`${code}: parameters for ${key}`);if(code!=='ko')assert.ok(!/[가-힣]/.test(text),`${code}: Korean in ${key}`);}
 }
 const {RUNTIME_LOCALES,getRuntimeText}=await vite.ssrLoadModule('/src/runtime-text.ts');
 const {AccountProgressStorage}=await vite.ssrLoadModule('/src/progress-storage.ts');
 const progress=new AccountProgressStorage();
 for(const {code} of SUPPORTED_LANGUAGES){I18nManager.setLanguage(code);for(const key of Object.keys(RUNTIME_LOCALES.en)){const value=RUNTIME_LOCALES[code][key];assert.ok(value,code+': missing runtime '+key);assert.deepEqual(parameters(value),parameters(RUNTIME_LOCALES.en[key]),code+': runtime parameters '+key);if(code!=='ko')assert.ok(!/[가-힣]/.test(value),code+': Korean runtime '+key);assert.equal(getRuntimeText(key),value);}assert.equal(progress.status,RUNTIME_LOCALES[code]['progress.guest_device_stored']);}
 const {UI_COPY,uiText}=await vite.ssrLoadModule('/src/ui-text.ts');
 const {PROMOTION_PIECE_OPTIONS}=await vite.ssrLoadModule('/src/promotion-modal.ts');
 for(const {code} of SUPPORTED_LANGUAGES){I18nManager.setLanguage(code);for(const key of Object.keys(UI_COPY)){assert.equal(UI_COPY[key].length,9);const value=uiText(key);assert.ok(value);assert.deepEqual(parameters(value),parameters(UI_COPY[key][1]),code+": UI parameters "+key);if(code!=='ko')assert.ok(!/[가-힣]/.test(value));}for(const option of PROMOTION_PIECE_OPTIONS){assert.ok(option.name&&option.description);if(code!=='ko')assert.ok(!/[가-힣]/.test(option.name+option.description));}}
 console.log(`PASS: ${keys.length} keys in all 9 locales, placeholders, UI text and promotion localization`);
}finally{await vite.close()}
