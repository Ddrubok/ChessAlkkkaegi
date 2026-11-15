// Local QA only. Ordinary Vite/build commands do not load the experiment plugin.
import { createServer } from 'vite';
import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';
import { EXPERIMENT_PROFILES, experimentPlugin } from './strategy-experiment-profiles.mjs';
const root = fileURLToPath(new URL('../..', import.meta.url));
const args = process.argv.slice(2);
function value(flag, fallback) {
  const at = args.indexOf(flag);
  if (at < 0) return fallback;
  if (!args[at + 1] || args[at + 1].startsWith('--')) throw Error(flag + ' needs a value');
  return args[at + 1];
}
if (args.includes('--list')) { console.log(JSON.stringify(EXPERIMENT_PROFILES, null, 2)); process.exit(0); }
const ids = value('--profiles', 'baseline').split(',');
if (new Set(ids).size !== ids.length || ids.some(id => !EXPERIMENT_PROFILES.some(p => p.id === id))) throw Error('Unknown or duplicate trial profile');
const firstPort = Number(value('--port-base', '5190'));
if (!Number.isInteger(firstPort) || firstPort < 1024 || firstPort + ids.length > 65535) throw Error('Invalid port range');
const out = resolve(root, '../qa/strategy-experiments-2026-11-15');
await mkdir(out, { recursive: true });
const hashes = {};
async function hashDir(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, e.name);
    if (e.isDirectory()) await hashDir(path);
    else hashes[relative(root, path).replaceAll('\\', '/')] = createHash('sha256').update(await readFile(path)).digest('hex');
  }
}
await hashDir(resolve(root, 'src'));
hashes['balance.csv'] = createHash('sha256').update(await readFile(resolve(root, 'balance.csv'))).digest('hex');
const servers = [];
const manifest = { kind: 'developer-only-itch-trials', createdAt: new Date().toISOString(), pid: process.pid,
  sourceHashes: hashes, profiles: [], network: 'CSP connect-src self/data/blob; no login, remote storage or publication',
  storage: 'Each profile has its own localhost port/origin. Use fresh guest progress and equal cards/research.' };
try {
  for (const [index, id] of ids.entries()) {
    const server = await createServer({ root, mode: 'itch', logLevel: 'error',
      cacheDir: resolve(out, '.vite-' + id + '-' + process.pid),
      plugins: [experimentPlugin(id), { name: 'experiment-identity',
        enforce: 'pre',
        transform(code, file) {
          if (!file.replaceAll('\\','/').endsWith('/src/main.ts')) return null;
          const anchor = 'let gameLoopStarted = false;';
          if (!code.includes(anchor)) throw Error('Developer QA exposure anchor missing');
          // Assisted setup only; QA must distinguish it from ordinary player discovery.
          return code.replace(anchor, 'globalThis.__strategyQA = { startStage: async (stage) => { if (!Number.isInteger(stage) || stage < 1 || stage > 10 || progressStorage.owner !== null) throw new Error("Local guest stage 1..10 only"); await startModeAction("stage", stage, "basic", undefined, true); hideMainMenuAfterModeStart(menuRuntime); }, snapshot: () => ({stage:gameModeRuntime?.stageNumber,phase:turnRuntime.phase,lastPower:turnRuntime.lastLaunchPower,lastSpeed:turnRuntime.lastLaunchInitialSpeed,pieces:[...physicsRuntime.pieces.values()].map(b=>({id:b.instance.id,type:b.instance.type,side:b.instance.side,position:{...b.body.translation()}}))}) }; ' + anchor);
        },
        transformIndexHtml(html) { return html.replace(/<title>(.*?)<\/title>/s, '<title>[DEV ' + id + '] $1</title>'); },
        configureServer(vite) { vite.middlewares.use('/__experiment', (_req, res) => {
          res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(EXPERIMENT_PROFILES.find(p => p.id === id)));
        }); },
      }],
      server: { host: '127.0.0.1', port: firstPort + index, strictPort: true, open: false, hmr: false, ws: false,
        headers: { 'Content-Security-Policy': "connect-src 'self' data: blob:;" } },
    });
    await server.listen(); servers.push(server);
    manifest.profiles.push({ ...EXPERIMENT_PROFILES.find(p => p.id === id), url: 'http://127.0.0.1:' + (firstPort + index) + '/' });
  }
  await writeFile(resolve(out, 'serve-manifest.json'), JSON.stringify(manifest, null, 2));
  for (const p of manifest.profiles) console.log(p.id + ': ' + p.url);
} catch (error) {
  await Promise.allSettled(servers.map(server => server.close())); throw error;
}
async function close() { await Promise.allSettled(servers.map(server => server.close())); process.exit(0); }
process.on('SIGINT', close); process.on('SIGTERM', close);
