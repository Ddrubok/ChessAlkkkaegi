import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../web/node_modules/vite/dist/node/index.js';
import { chromium } from '../../.orca/ui-check/node_modules/playwright/index.mjs';

const root = new URL('../../', import.meta.url);
const web = new URL('../../web/', import.meta.url);
const qa = new URL('./', import.meta.url);
const publicAssets = new URL('../../web/public/assets/', import.meta.url);
const meta = JSON.parse(await readFile(new URL('chess-set.meta.json', publicAssets), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.match(meta.source.file, /polyhaven-chess/i, 'Refusing to render old chess.fbx');
const source = await readFile(new URL('../../assets-source/polyhaven-chess/chess_set.bin', import.meta.url));
assert.equal(hash(source), meta.source.sha256, 'Poly Haven source hash mismatch');
const glb = await readFile(new URL('chess-pieces.glb', publicAssets));
const glbHash = hash(glb);
assert.ok(glb.length > 100_000, 'GLB is unexpectedly small');

const pageHtml = `<!doctype html><html><meta charset="utf-8"><style>body{margin:0;background:#171410}#scene{width:960px;height:600px}</style><div id="scene"></div><script type="module">
import { loadChessAssets } from '/src/assets.ts';
import { deriveBoardHalfExtent } from '/src/config.ts';
import { PIECE_INSTANCES, getCellCenter } from '/src/layout.ts';
import { createPhysicsRuntime, preSettlePhysics } from '/src/physics.ts';
import { createSceneRuntime, synchronizePieceMeshes } from '/src/scene.ts';
const result = {};
try {
  const assets = await loadChessAssets();
  if (!assets.meta.source.file.includes('polyhaven-chess')) throw Error('Old model loaded in browser');
  const H = deriveBoardHalfExtent(assets.meta.cellSize);
  const host = document.querySelector('#scene');
  const render = (scene, width, height, camera) => {
    scene.renderer.setPixelRatio(1);
    scene.renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    scene.renderer.render(scene.scene, camera);
    const copy = document.createElement('canvas'); copy.width = width; copy.height = height;
    copy.getContext('2d').drawImage(scene.renderer.domElement, 0, 0, width, height);
    return copy.toDataURL('image/jpeg', .92);
  };
  const full = { gameMode: 'hotseat', stageNumber: 1 };
  const tutorial = createSceneRuntime(host, assets, PIECE_INSTANCES, H, full);
  const tutorialPhysics = await createPhysicsRuntime(assets.meta, PIECE_INSTANCES, H, full);
  tutorial.controls.enabled = false;
  preSettlePhysics(tutorialPhysics); synchronizePieceMeshes(tutorial, tutorialPhysics);
  tutorial.camera.zoom = 1.35;
  tutorial.camera.position.set(H * .8, H * 2.65, -H * 3.05);
  tutorial.camera.lookAt(0, 0, 0);
  result['hero-tutorial.jpg'] = render(tutorial, 960, 340, tutorial.camera);
  tutorialPhysics.world.free(); tutorial.controls.dispose(); tutorial.renderer.dispose(); tutorial.renderer.forceContextLoss(); tutorial.renderer.domElement.remove();
  const stageOptions = { gameMode: 'stage', stageNumber: 2 };
  const stage = createSceneRuntime(host, assets, PIECE_INSTANCES, H, stageOptions);
  const stagePhysics = await createPhysicsRuntime(assets.meta, PIECE_INSTANCES, H, stageOptions);
  stage.controls.enabled = false;
  preSettlePhysics(stagePhysics);
  for (const [id, square] of [['white-knight-b1', { file: 'd', rank: 4 }], ['black-pawn-e7', { file: 'e', rank: 5 }]]) {
    const body = stagePhysics.pieces.get(id)?.body;
    if (!body) throw Error('Stage action piece missing: ' + id);
    const center = getCellCenter(square, assets.meta.cellSize);
    body.setTranslation({ x: center.x, y: body.translation().y, z: center.z }, true);
  }
  preSettlePhysics(stagePhysics); synchronizePieceMeshes(stage, stagePhysics);
  stage.camera.zoom = 1.12;
  stage.camera.position.set(H * .5, H * 2.4, -H * 2.65);
  stage.camera.lookAt(0, 0, 0);
  result['hero-stage.jpg'] = render(stage, 567, 409, stage.camera);
  const knight = stage.pieceMeshes.get('white-knight-b1');
  if (!knight) throw Error('White knight missing from real stage scene');
  for (const mesh of stage.boardMeshes) mesh.visible = false;
  for (const mesh of stage.pieceMeshes.values()) mesh.visible = mesh === knight;
  knight.position.set(0, 0, 0);
  knight.rotation.set(0, 0, 0);
  stage.camera.zoom = 1.45;
  stage.camera.position.set(.95, .85, 1.2);
  stage.camera.lookAt(0, assets.meta.pieces.Knight.bounds.y * .5, 0);
  result['avatar-knight.jpg'] = render(stage, 160, 160, stage.camera);
  stagePhysics.world.free(); stage.controls.dispose(); stage.renderer.dispose(); stage.renderer.forceContextLoss(); stage.renderer.domElement.remove();
  window.__capture = { source: assets.meta.source, images: result };
} catch (error) { window.__capture = { error: String(error), stack: error?.stack }; console.error(error); }
</script></html>`;

const server = await createServer({ root: fileURLToPath(web), configFile: false, logLevel: 'warn',
  server: { host: '127.0.0.1', port: 5202, strictPort: true, hmr: false, ws: false },
  plugins: [{ name: 'image-refresh-page', configureServer(vite) { vite.middlewares.use((req, res, next) => {
    if (req.url !== '/image-refresh') return next();
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(pageHtml);
  }); } }],
});
await server.listen();
const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 });
  page.on('console', message => { if (message.type() === 'error') console.error('browser:', message.text()); });
  await page.goto('http://127.0.0.1:5202/image-refresh');
  await page.waitForFunction(() => Boolean(window.__capture), { timeout: 120_000 });
  const capture = await page.evaluate(() => window.__capture);
  if (capture.error) throw Error(`${capture.error}\n${capture.stack ?? ''}`);
  assert.equal(capture.source.sha256, meta.source.sha256, 'Browser source mismatch');
  await mkdir(qa, { recursive: true });
  for (const [name, dataUrl] of Object.entries(capture.images)) {
    assert.match(dataUrl, /^data:image\/jpeg;base64,/);
    const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
    assert.ok(bytes.length > 1000, `${name} is suspiciously empty`);
    await writeFile(new URL(`candidate-${name}`, qa), bytes);
    console.log(`candidate-${name}: ${bytes.length} bytes, sha256 ${hash(bytes)}`);
  }
  if (process.argv.includes('--publish')) {
    for (const name of Object.keys(capture.images)) await copyFile(new URL(`candidate-${name}`, qa), new URL(`lobby/${name}`, publicAssets));
    console.log('Published three lobby JPEGs');
  }
  console.log(`source ${meta.source.file} sha256 ${meta.source.sha256}; GLB sha256 ${glbHash}`);
} finally { await browser.close(); await server.close(); }
