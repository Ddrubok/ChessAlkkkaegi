import { readdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative, posix } from 'node:path';

const root = fileURLToPath(new URL('../../dist-crazygames/', import.meta.url));
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
const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
if (totalBytes > 20_000_000) failures.push(`package exceeds 20 MB: ${totalBytes} bytes`);
if (files.length > 1500) failures.push(`package exceeds 1500 files: ${files.length}`);
const names = new Set(files.map((file) => file.name));
for (const file of files) {
  if (/\.(?:map|ts|tsx|test\.[^.]+|spec\.[^.]+)$/iu.test(file.name) || /(?:^|\/)(?:test|tests|debug|__tests__)(?:\/|$)/iu.test(file.name)) {
    failures.push(`${file.name}: debug, test, or source asset`);
  }
  if (!/\.(?:js|mjs|html|css|json|svg|txt|xml)$/iu.test(file.name)) continue;
  const source = await readFile(file.path, 'utf8');
  // API signatures and endpoints, not translated UI strings that may mention a service.
  const forbidden = [
    /supabase\.co|supabase-js|realtime\/v1|sb_publishable_|VITE_SUPABASE|createClient\(/iu,
    /poki-sdk|PokiSDK|game-cdn\.poki\.com|Poki commercial break/iu,
    /crazygames-sdk|CrazyGames\.SDK|sdk\.crazygames\.com/iu,
    /googlesyndication|adsbygoogle|google-adsense|admob|doubleclick|VITE_ADSENSE|VITE_METERED/iu,
    /stuns?:|metered\.ca|RTCPeerConnection/iu,
    /__runDeterminismProbe|__onlineSelfTest|__cgQA|__pokiSmoke|__marketingQA|tuning-panel|card-tuning-panel|debug-overlay/iu,
  ];
  for (const pattern of forbidden) if (pattern.test(source)) failures.push(`${file.name}: forbidden ${pattern}`);
  // Plain-text licence URLs are attribution, never fetched by the game.
  if (file.name === 'THIRD_PARTY_NOTICES.txt' || file.name === 'assets/chess-model-license.txt') continue;
  for (const match of source.matchAll(/https?:\/\/[^\s"'<>`\\)\]}]+/gu)) {
    const url = match[0].replace(/[.,;]+$/u, '');
    if (file.name === 'assets/chess-set.meta.json' && url === 'https://polyhaven.com/a/chess_set') continue;
    if (!new Set(['https://jcgt.org/published/0007/04/01/', 'http://www.w3.org/1999/xhtml', 'http://www.w3.org/2000/svg']).has(url)) {
      failures.push(`${file.name}: remote URL ${url}`);
    }
  }
}

const html = await readFile(join(root, 'index.html'), 'utf8');
if (!/<html lang="en">/u.test(html)) failures.push('index.html: English boot language missing');
if (!/Chess Alkkagi/u.test(html) || !/Loading…/u.test(html)) failures.push('index.html: English boot copy missing');
if (/<nav\b|google-adsense|about\.html|guide\.html|tiers\.html|updates\.html|boot-language\.js/iu.test(html)) failures.push('index.html: promotional boot content');
for (const match of html.matchAll(/<(?:script|link|img)\b[^>]*(?:src|href)="([^"#?]+)"/gu)) {
  const path = match[1];
  if (/^(?:https?:)?\/\//iu.test(path) || path.startsWith('/')) failures.push(`index.html: non-relative path ${path}`);
  else if (!names.has(posix.normalize(path.replace(/^\.\//u, '')))) failures.push(`index.html: missing local file ${path}`);
}
for (const file of files.filter((item) => item.name.endsWith('.css'))) {
  const css = await readFile(file.path, 'utf8');
  for (const match of css.matchAll(/url\(["']?(\/[^)'"\s]+)/gu)) failures.push(`${file.name}: root-relative CSS asset ${match[1]}`);
}
console.log(`CrazyGames package: ${files.length} files, ${totalBytes} bytes`);
for (const failure of failures) console.error(`FAIL ${failure}`);
console.log(`${failures.length ? 'FAIL' : 'PASS'}: CrazyGames artifact check (${failures.length} findings)`);
process.exitCode = failures.length ? 1 : 0;
