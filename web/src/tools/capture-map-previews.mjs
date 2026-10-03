import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// Explicit development-only capture server. Never imported by the game/build.
const root = fileURLToPath(new URL('../..', import.meta.url));
const output = new URL('../assets/map-previews/', import.meta.url);
const catalog = await readFile(new URL('../maps/map-catalog.ts', import.meta.url), 'utf8');
const ids = new Set(['classic', ...[...catalog.matchAll(/id: "([^"]+)"/g)].map(match => match[1])]);
const port = 5201;
const origin = `http://127.0.0.1:${port}`;
await mkdir(output, { recursive: true });
const server = await createServer({ root, configFile: false, logLevel: 'warn',
  cacheDir: '../Docs/MapGimmicks_DevelopmentPlan/validation/map-capture-vite-cache',
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false, ws: false },
  plugins: [{ name: 'local-map-photo-writer', configureServer(vite) {
    vite.middlewares.use(async (req, res, next) => {
      if (req.url === '/capture' && req.method === 'GET') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(`<!doctype html><html lang="ko"><meta charset="utf-8"><title>맵 사진 생성</title>
          <style>body{background:#171410;color:#eee;font:16px system-ui;margin:24px}button{padding:12px 24px}canvas{max-width:100%;height:auto!important}#status{white-space:pre-wrap}</style>
          <h1>실제 게임 모델 · 맵 사진 생성</h1><p>각 맵을 정착시킨 뒤 두 시점만 촬영합니다. 게임용 실시간 루프는 실행하지 않습니다.</p>
          <button id="capture">14개 맵 사진 저장</button><p id="status" role="status">준비</p><div id="scene"></div>
          <script type="module" src="/src/tools/capture-map-previews.ts"></script></html>`);
        return;
      }
      const match = req.url?.match(/^\/capture-image\/([a-z0-9-]+)\/(perspective|thumb|plan)$/);
      if (!match) return next();
      if (req.method !== 'POST' || req.headers.origin !== origin || req.headers['content-type'] !== 'image/webp' || !ids.has(match[1])) {
        res.writeHead(403).end(); return;
      }
      try {
        const chunks = []; let length = 0;
        for await (const chunk of req) {
          length += chunk.length;
          if (length > 1024 * 1024) throw new Error('Capture exceeds 1 MiB');
          chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);
        if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') throw new Error('Expected WebP');
        await writeFile(new URL(`${match[1]}-${match[2]}.webp`, output), buffer);
        res.writeHead(200, { 'Content-Type': 'text/plain' }).end('saved');
      } catch (error) { console.error(error); res.writeHead(400).end('Capture failed'); }
    });
  } }],
});
await server.listen();
console.log(`Open ${origin}/capture and press the capture button. Output: ${fileURLToPath(output)}`);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); process.exit(0); });
