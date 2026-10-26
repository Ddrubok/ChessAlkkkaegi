import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
const adb = 'C:/Users/DooBokWie/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const serial = '10.8.4.105:41399';
const run = (...args) => execFileSync(adb, ['-s', serial, ...args], { encoding: 'utf8', timeout: 15000 }).trim();
const result = { checkedAt: new Date().toISOString(), serial, commands: {} };
for (const [key, args] of Object.entries({
  model: ['shell','getprop','ro.product.model'],
  thirdPartyPackages: ['shell','pm','list','packages','-3'],
  allRelevantPackages: ['shell','pm','list','packages','-u'],
  productionPackage: ['shell','dumpsys','package','com.chessalkkagi.app'],
  qaPackage: ['shell','dumpsys','package','com.chessalkkagi.app.publicqa'],
  foreground: ['shell','dumpsys','window'],
})) {
  const at = new Date().toISOString();
  try {
    const output = run(...args);
    result.commands[key] = { at, args, result: key === 'thirdPartyPackages' || key === 'allRelevantPackages' ? output.split(/\r?\n/).filter(x => /chess|alkk|publicqa/i.test(x)) : key === 'foreground' ? output.split(/\r?\n/).filter(x => /mCurrentFocus|mFocusedApp/.test(x)).slice(0,2) : output.slice(0,500) };
  } catch(e) { result.commands[key] = {at,args,error:String(e).slice(0,500)}; }
}
await writeFile(new URL('./android-observation.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
