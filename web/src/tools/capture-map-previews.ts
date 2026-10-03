import { OrthographicCamera } from 'three';
import { loadChessAssets } from '../assets';
import { deriveBoardHalfExtent } from '../config';
import { PIECE_INSTANCES } from '../layout';
import { createPhysicsRuntime, preSettlePhysics, rebuildPhysicsBoard, resetPhysicsPieces } from '../physics';
import { createSceneRuntime, rebuildSceneBoard, resetScenePieces, synchronizePieceMeshes } from '../scene';
import { disposeHotseatMap, getHotseatMapDefinition, installHotseatMap } from '../maps/hotseat-map-runtime';
import { DEFAULT_HOTSEAT_MAP_ID, HOTSEAT_MAP_CATALOG } from '../maps/map-catalog';

const button = document.querySelector<HTMLButtonElement>('#capture')!;
const status = document.querySelector<HTMLElement>('#status')!;
const host = document.querySelector<HTMLElement>('#scene')!;
const options = { gameMode: 'hotseat' as const, stageNumber: 1 };

async function save(id: string, view: string, canvas: HTMLCanvasElement): Promise<void> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
    value => value ? resolve(value) : reject(new Error('WebP encoding failed')), 'image/webp', .9));
  const result = await fetch(`/capture-image/${id}/${view}`, { method: 'POST', headers: { 'Content-Type': 'image/webp' }, body: blob });
  if (!result.ok) throw new Error(`${id}/${view} save failed: ${result.status}`);
}

button.addEventListener('click', async () => {
  button.disabled = true;
  status.textContent = '게임 모델 불러오는 중…';
  try {
    const assets = await loadChessAssets();
    const baseH = deriveBoardHalfExtent(assets.meta.cellSize);
    const scene = createSceneRuntime(host, assets, PIECE_INSTANCES, baseH, options);
    const physics = await createPhysicsRuntime(assets.meta, PIECE_INSTANCES, baseH, options);
    scene.controls.enabled = false;
    scene.renderer.setPixelRatio(1);
    const thumb = document.createElement('canvas'); thumb.width = 240; thumb.height = 150;
    const thumbContext = thumb.getContext('2d')!;
    try {
      for (const [index, entry] of HOTSEAT_MAP_CATALOG.entries()) {
        status.textContent = `${index + 1} / ${HOTSEAT_MAP_CATALOG.length} · ${entry.id}`;
        disposeHotseatMap(physics, scene);
        const map = entry.id === DEFAULT_HOTSEAT_MAP_ID ? undefined : getHotseatMapDefinition(entry.id, assets.meta);
        if (entry.id !== DEFAULT_HOTSEAT_MAP_ID && !map) throw new Error(`Missing map: ${entry.id}`);
        const H = baseH * (map?.boardScale ?? 1);
        const instances = map?.spawns.map(spawn => spawn.instance) ?? PIECE_INSTANCES;
        rebuildPhysicsBoard(physics, assets.meta, H, options);
        rebuildSceneBoard(scene, assets, H, options);
        resetPhysicsPieces(physics, assets.meta, instances, options);
        resetScenePieces(scene, assets, instances, options);
        if (map) installHotseatMap(physics, scene, map, assets.meta);
        preSettlePhysics(physics);
        synchronizePieceMeshes(scene, physics);

        scene.renderer.setSize(960, 600, false);
        scene.camera.aspect = 960 / 600;
        scene.camera.zoom = 1.7;
        scene.camera.position.set(0, H * 2.7, -H * 3.3);
        scene.camera.lookAt(0, H * .03, 0);
        scene.camera.updateProjectionMatrix();
        scene.camera.updateMatrixWorld(true);
        scene.renderer.render(scene.scene, scene.camera);
        // Copy immediately; WebGL's default drawing buffer need not be preserved.
        thumbContext.drawImage(scene.renderer.domElement, 0, 0, thumb.width, thumb.height);
        const perspective = document.createElement('canvas'); perspective.width = 960; perspective.height = 600;
        perspective.getContext('2d')!.drawImage(scene.renderer.domElement, 0, 0);
        await save(entry.id, 'perspective', perspective);
        await save(entry.id, 'thumb', thumb);

        for (const piece of scene.pieceMeshes.values()) piece.visible = false;
        const plan = new OrthographicCamera(-H * 1.09, H * 1.09, H * 1.09, -H * 1.09, .01, H * 10);
        plan.position.set(0, H * 6, 0); plan.up.set(0, 0, 1); plan.lookAt(0, 0, 0); plan.updateMatrixWorld(true);
        scene.renderer.setSize(400, 400, false);
        scene.renderer.render(scene.scene, plan);
        const planCopy = document.createElement('canvas'); planCopy.width = planCopy.height = 400;
        planCopy.getContext('2d')!.drawImage(scene.renderer.domElement, 0, 0);
        await save(entry.id, 'plan', planCopy);
      }
      status.textContent = `${HOTSEAT_MAP_CATALOG.length}개 맵 · 42개 정적 이미지 저장 완료`;
    } finally {
      disposeHotseatMap(physics, scene);
      physics.world.free();
      scene.controls.dispose(); scene.renderer.dispose(); scene.renderer.forceContextLoss();
      scene.renderer.domElement.remove();
    }
  } catch (error) {
    console.error(error);
    status.textContent = `실패: ${String(error)}`;
  }
});
