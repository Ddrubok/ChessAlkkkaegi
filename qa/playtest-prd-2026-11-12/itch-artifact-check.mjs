import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, join, posix } from 'node:path';

const root = resolve('dist-itch');
const qa = resolve('../qa/playtest-prd-2026-11-12/builds');
const files = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else {
      const bytes = await readFile(path);
      files.push({ path: relative(root, path).replaceAll('\\', '/'), size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
  }
}
await walk(root);
files.sort((a, b) => a.path.localeCompare(b.path));
const names = new Set(files.map(f => f.path));
const errors = [];
const html = await readFile(join(root, 'index.html'), 'utf8');
if (!/<html lang="en">/u.test(html) || !/<title>Chess Alkkagi<\/title>/u.test(html) || !/<h1>Chess Alkkagi<\/h1>/u.test(html)) errors.push('English title or boot copy missing');
if (/<nav\b|google-adsense|boot-language\.js|about\.html|guide\.html|tiers\.html|updates\.html/iu.test(html)) errors.push('promotional boot or legacy page in index');
for (const match of html.matchAll(/<(?:script|link|img)\b[^>]*(?:src|href)="([^"#?]+)"/gu)) {
  const path = match[1];
  if (/^(?:https?:)?\/\//iu.test(path) || path.startsWith('/')) errors.push(`nonrelative index path: ${path}`);
  else if (!names.has(posix.normalize(path.replace(/^\.\//u, '')))) errors.push(`missing index asset: ${path}`);
}
for (const file of files) {
  if (/\.(?:map|ts|tsx)$/iu.test(file.path) || /(?:^|\/)(?:test|tests|debug|__tests__)(?:\/|$)/iu.test(file.path)) errors.push(`source or test file: ${file.path}`);
  if (!/\.(?:js|mjs|html|css|json)$/iu.test(file.path)) continue;
  const source = await readFile(join(root, file.path), 'utf8');
  for (const pattern of [
    /sdk\.crazygames\.com|CrazyGames ID|CrazyGames\.SDK|crazygames-auth|ca_cg_opening|PokiSDK|game-cdn\.poki\.com/iu,
    /sb_secret_[A-Za-z0-9_-]{10,}|SUPABASE_SERVICE_ROLE_KEY|eohasrpzjwtzexoogwdt\.supabase\.co/iu,
    /googlesyndication|adsbygoogle|google-adsense|admob|doubleclick|google-analytics|googletagmanager|VITE_ADSENSE/iu,
    /__runDeterminismProbe|__onlineSelfTest|__cgQA|__pokiSmoke|__marketingQA|tuning-panel|card-tuning-panel|debug-overlay/iu,
  ]) if (pattern.test(source)) errors.push(`${file.path}: forbidden ${pattern}`);
  if (file.path.endsWith('.css')) for (const match of source.matchAll(/url\(["']?(\/[^)'"\s]+)/gu)) errors.push(`${file.path}: root asset ${match[1]}`);
  if (file.path.endsWith('.js')) {
    for (const match of source.matchAll(/https?:\/\/[^\s"'<>`\\)\]}]+/gu)) {
      const url = match[0].replace(/[.,;]+$/u, '');
      const productionTurn = /^https:\/\/chessalkkagi\.metered\.live\/api\/v1\/turn\/credentials\?apiKey=[0-9a-f]{40}$/u.test(url)
        || (url.startsWith('https://${') && /https:\/\/\$\{[^}]+\}\.metered\.live\/api\/v1\/turn\/credentials\?apiKey=\$\{[^}]+\}/u.test(source));
      if (!productionTurn && !new Set(['https://jcgt.org/published/0007/04/01/', 'http://www.w3.org/1999/xhtml', 'http://www.w3.org/2000/svg', 'https://ddurubok.itch.io/chess-alkkagi', 'https://yoajmckkrpgvcljrffww.supabase.co', 'https://yoajmckkrpgvcljrffww.supabase.co/functions/v1/itch-auth', 'https://itch.io', 'http://localhost:9999', 'https://github.com/orgs/supabase/discussions/45715', 'https://github.com/supabase/supabase-js/blob/master/packages/core/realtime-js/migrations/httpsend-server-version.md']).has(url)) errors.push(`${file.path}: remote URL ${url.replace(/apiKey=[^&]+/u, 'apiKey=[redacted]')}`);
    }
  }
}
const runtime = (await Promise.all(files.filter(f => f.path.endsWith('.js')).map(f => readFile(join(root, f.path), 'utf8')))).join('\n');
if (!runtime.includes('ca_itch_opening_v2') || !runtime.includes('Stage') || !runtime.includes('Card bonus')) errors.push('solo checkpoint, stages or cards absent');
if (!runtime.includes('RTCPeerConnection') || !runtime.includes('yoajmckkrpgvcljrffww.supabase.co') || !runtime.includes('ddurubok.itch.io/chess-alkkagi') || !runtime.includes('.metered.live/api/v1/turn/credentials') || !runtime.includes('chessalkkagi')) errors.push('guest online transport, TURN or public invite target absent');
if (!runtime.includes('Sign in with an existing email account') || !runtime.includes('signInWithPassword') || !runtime.includes('ca_account_progress_v4:')) errors.push('email account or cloud progress absent');
if (!runtime.includes('Sign in with itch.io') || !runtime.includes('Link itch.io to this account') || !runtime.includes('itch-auth') || !runtime.includes('codeChallenge') || !runtime.includes('codeVerifier') || !runtime.includes('setSession')) errors.push('itch.io PKCE bridge, account buttons or session handoff absent');
if (runtime.includes('Continue with Google')) errors.push('Google OAuth UI must stay unavailable in itch iframe');
if (!names.has('privacy.html')) errors.push('privacy page missing');
const manifest = { root: 'web/dist-itch', files: files.map(({ path, size, sha256 }) => ({ path, size, sha256 })), totalBytes: files.reduce((n, f) => n + f.size, 0) };
await mkdir(qa, { recursive: true });
await writeFile(join(qa, 'build-manifest.json'), JSON.stringify(manifest, null, 2));
await writeFile(join(qa, 'build-verification.json'), JSON.stringify({ pass: errors.length === 0, errors, fileCount: files.length, totalBytes: manifest.totalBytes }, null, 2));
console.log(`${errors.length ? 'FAIL' : 'PASS'}: itch artifact (${files.length} files, ${manifest.totalBytes} bytes)`);
for (const error of errors) console.error(error);
if (errors.length) process.exitCode = 1;
