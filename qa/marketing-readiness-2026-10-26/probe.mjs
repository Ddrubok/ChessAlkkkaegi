import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const targets = [
  ['dev', 'https://chessalkkagi-dev.pages.dev/'],
  ['public', 'https://ddrubok.github.io/ChessAlkkkaegi/'],
];
const stamp = new Date().toISOString();
const out = { checkedAt: stamp, targets: [] };
for (const [name, url] of targets) {
  const item = { name, url };
  try {
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
    const body = await response.text();
    item.entry = { status: response.status, finalUrl: response.url, contentType: response.headers.get('content-type'), etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified'), sha256: createHash('sha256').update(body).digest('hex'), bytes: Buffer.byteLength(body) };
    const refs = [...body.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g)].map(m => new URL(m[1], response.url).href);
    item.assets = [];
    for (const assetUrl of [...new Set(refs)].slice(0, 12)) {
      try {
        const r = await fetch(assetUrl, { signal: AbortSignal.timeout(20000) });
        const b = await r.arrayBuffer();
        const s = Buffer.from(b).toString('utf8');
        const hosts = [...new Set([...s.matchAll(/https:\/\/([a-z0-9-]+\.supabase\.co)/g)].map(x => x[1]))];
        item.assets.push({ url: assetUrl, status: r.status, bytes: b.byteLength, sha256: createHash('sha256').update(Buffer.from(b)).digest('hex'), supabaseHosts: hosts });
      } catch (e) { item.assets.push({url: assetUrl, error: String(e)}); }
    }
  } catch (e) { item.error = String(e); }
  out.targets.push(item);
}
const hosts = [...new Set(out.targets.flatMap(t => (t.assets || []).flatMap(a => a.supabaseHosts || [])))];
out.backends = [];
for (const host of hosts) {
  const url = `https://${host}/auth/v1/health`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    out.backends.push({ host, url, status: r.status, contentType: r.headers.get('content-type'), bodyExcerpt: (await r.text()).slice(0, 300) });
  } catch (e) { out.backends.push({ host, url, error: String(e) }); }
}
await writeFile(new URL('./probe.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
