import { build } from '../../web/node_modules/vite/dist/node/index.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve('qa/marketing-crossplay-2026-10-26');
const assets = resolve(root, 'assets');
mkdirSync(assets, { recursive: true });
for (const key of ['VITE_MARKETING_ENABLED', 'VITE_WEB_ADS_MODE', 'VITE_AD_TEST_MODE', 'VITE_ADMOB_BANNER_ID', 'VITE_ADMOB_REWARDED_ID', 'VITE_ADMOB_INTERSTITIAL_ID', 'VITE_ADSENSE_CLIENT_ID', 'VITE_ADSENSE_SLOT_ID']) process.env[key] = key === 'VITE_WEB_ADS_MODE' ? 'off' : 'false';
const noAds = (code, id) => {
  if (!id.replaceAll('\\', '/').endsWith('/src/main.ts')) return;
  return code
    .replaceAll('await AdManager.init();', 'void 0;')
    .replaceAll('await AdManager.showBanner();', 'void 0;')
    .replace('  if (PLATFORM.id !== "poki") void 0;', '  window.__marketingQA = { menuRuntime, gameModeRuntime, turnRuntime, inputRuntime, physicsRuntime, sceneRuntime, marketingRuntime };');
};
await build({ root: resolve('web'), mode: 'staging', logLevel: 'warn', build: { outDir: resolve(assets, 'public') }, plugins: [{ name: 'marketing-qa-only', enforce: 'pre', transform: noAds }] });
const config = JSON.parse(readFileSync('web/capacitor.config.json', 'utf8'));
config.appId = 'com.chessalkkagi.app.marketingqa';
config.appName = 'Chess Marketing QA';
writeFileSync(resolve(assets, 'capacitor.config.json'), JSON.stringify(config));
const plugins = JSON.parse(readFileSync('web/android/app/src/main/assets/capacitor.plugins.json', 'utf8')).filter(x => x.pkg !== '@capacitor-community/admob');
writeFileSync(resolve(assets, 'capacitor.plugins.json'), JSON.stringify(plugins));
const manifest = readFileSync('web/android/app/src/main/AndroidManifest.xml', 'utf8')
  .replaceAll('android:label="@string/app_name"', 'android:label="Chess Marketing QA"')
  .replaceAll('android:label="@string/title_activity_main"', 'android:label="Chess Marketing QA"')
  .replace('android:name=".MainActivity"', 'android:name="com.chessalkkagi.app.MainActivity"')
  .replace('android:scheme="com.chessalkkagi.app"', 'android:scheme="com.chessalkkagi.app.marketingqa"')
  .replace(/\s*<!-- Google AdMob Mobile Ads SDK App ID -->[\s\S]*?<meta-data\s+android:name="com.google.android.gms.ads.APPLICATION_ID"[\s\S]*?\/>/, '')
  .replace('xmlns:android="http://schemas.android.com/apk/res/android"', 'xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools"')
  .replace('<application', '<application')
  .replace('        <activity', '        <provider android:name="com.google.android.gms.ads.MobileAdsInitProvider" tools:node="remove" />\n        <activity');
writeFileSync(resolve(root, 'AndroidManifest.xml'), manifest);
console.log('Isolated staging QA assets built; marketing analytics and ad calls disabled.');
