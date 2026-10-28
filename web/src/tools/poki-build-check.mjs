import { readdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const root = fileURLToPath(new URL('../../dist-poki/', import.meta.url));
const forbidden = [
  'supabase.co', 'supabase-js', 'realtime/v1', 'realtime-js',
  'googlesyndication', 'adsbygoogle', 'google-adsense', 'cafe.naver',
  'mailto:', 'metered', 'stun:', 'about.html', 'guide.html', 'tiers.html',
  'updates.html', 'privacy.html', '__runDeterminismProbe', '__onlineSelfTest',
  'tuning-panel', 'card-tuning-panel', 'debug-overlay', 'auth-tab-login', 'auth-tab-signup', 'signup-email-input',
];
// Exact library documentation/license URLs; this is not a general CDN allowlist.
const libraryUrls = new Set([
  'https://jcgt.org/published/0007/04/01/',
  'http://www.w3.org/1999/xhtml', 'http://www.w3.org/2000/svg',
]);
const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else files.push({ path, name: relative(root, path).replaceAll('\\', '/'), size: (await stat(path)).size });
  }
}
await walk(root);
const failures = [];
const urls = new Map();
for (const file of files) {
  if (/^assets\/(?:online(?:-selftest)?|net|metered-turn|web-ads|determinism-probe|replay)-[^/]+\.js$/u.test(file.name)) {
    failures.push(`${file.name}: forbidden module`);
  }
  if (!/\.(?:js|mjs|html|css|json|svg|txt|xml)$/iu.test(file.name)) continue;
  const source = await readFile(file.path, 'utf8');
  for (const marker of forbidden) {
    if (source.toLowerCase().includes(marker.toLowerCase())) failures.push(`${file.name}: forbidden ${marker}`);
  }
  // Asset provenance is plain text, not a network dependency.
  if (file.name === 'assets/chess-model-license.txt') continue;
  for (const match of source.matchAll(/https?:\/\/[^\s"'<>`\\)\]}]+/gu)) {
    const url = match[0].replace(/[.,;]+$/u, '');
    if (file.name === 'assets/chess-set.meta.json' && url === 'https://polyhaven.com/a/chess_set') continue;
    if (!urls.has(url)) urls.set(url, new Set());
    urls.get(url).add(file.name);
  }
}
for (const [url, sources] of [...urls].sort(([a], [b]) => a.localeCompare(b))) {
  const allowed = url === 'https://game-cdn.poki.com/scripts/v2/poki-sdk.js' || libraryUrls.has(url);
  console.log(`${allowed ? 'ALLOW' : 'DENY'} URL ${url} (${[...sources].join(', ')})`);
  if (!allowed) failures.push(`unknown URL: ${url}`);
}
const html = await readFile(join(root, 'index.html'), 'utf8');
const initialPaths = [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"?#]+\.js)"[^>]*>/gu)]
  .map((match) => match[1].replace(/^\.\//u, '').replace(/^\//u, ''));
const initialBytes = files.filter((file) => initialPaths.includes(file.name)).reduce((sum, file) => sum + file.size, 0);
console.log(`Total: ${files.length} files, ${files.reduce((sum, file) => sum + file.size, 0)} bytes`);
console.log(`Initial JS (HTML scripts/modulepreloads, excluding dynamic imports): ${initialBytes} bytes`);
for (const file of [...files].sort((a, b) => b.size - a.size).slice(0, 10)) console.log(`Largest: ${file.size} bytes ${file.name}`);
for (const failure of failures) console.error(`FAIL ${failure}`);
console.log(`${failures.length ? 'FAIL' : 'PASS'}: Poki artifact check (${failures.length} findings)`);
process.exitCode = failures.length ? 1 : 0;
