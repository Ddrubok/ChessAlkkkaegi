import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const size = new URLSearchParams(location.search).get('size') || 'landscape';
document.body.className = size;
const width = innerWidth, height = innerHeight;
const canvas = document.querySelector('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(width, height);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.45;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#493a2f');
scene.fog = new THREE.Fog('#493a2f', 5.3, 11);
const camera = new THREE.PerspectiveCamera(size === 'portrait' ? 37 : size === 'square' ? 37 : 35, width / height, 0.1, 50);
const target = new THREE.Vector3(0, size === 'portrait' ? .52 : .72, 0);
camera.position.set(size === 'landscape' ? 2.2 : 1.65, size === 'portrait' ? 2.7 : 2.35, size === 'landscape' ? 6.2 : size === 'portrait' ? 6.65 : 6.1);
camera.lookAt(target);
scene.add(new THREE.AmbientLight(0xf3dfbd, 2.0));
const key = new THREE.DirectionalLight(0xffdfad, 4.5);
key.position.set(-2, 6, 4); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -5; key.shadow.camera.right = 5; key.shadow.camera.top = 5; key.shadow.camera.bottom = -5;
key.shadow.bias = -.0002; scene.add(key);
const rim = new THREE.DirectionalLight(0xd5e4f1, 3.1); rim.position.set(3, 3, -3); scene.add(rim);
const fill = new THREE.DirectionalLight(0xf7e8d1, 2.2); fill.position.set(3, 4, 5); scene.add(fill);
const hero = new THREE.SpotLight(0xdde8ff, 34, 9, .5, .8);
hero.position.set(2, 5, 3); hero.target.position.set(.57, 1.7, -.22); scene.add(hero, hero.target);

// Game palette: scene.ts board texture #4b3023 / #7b4d35 / #e3d2b2.
const boardCanvas = document.createElement('canvas'); boardCanvas.width = boardCanvas.height = 1024;
const ctx = boardCanvas.getContext('2d');
ctx.fillStyle = '#4b3023'; ctx.fillRect(0, 0, 1024, 1024);
for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
  ctx.fillStyle = (x + y) % 2 ? '#7b4d35' : '#e3d2b2';
  ctx.fillRect(32 + x * 120, 32 + y * 120, 120, 120);
}
const boardTexture = new THREE.CanvasTexture(boardCanvas); boardTexture.colorSpace = THREE.SRGBColorSpace;
boardTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
const board = new THREE.Mesh(new THREE.BoxGeometry(8.5, .16, 8.5), [
  new THREE.MeshStandardMaterial({ color: '#36251f', roughness: .84 }),
  new THREE.MeshStandardMaterial({ color: '#36251f', roughness: .84 }),
  new THREE.MeshStandardMaterial({ map: boardTexture, roughness: .72 }),
  new THREE.MeshStandardMaterial({ color: '#36251f', roughness: .84 }),
  new THREE.MeshStandardMaterial({ color: '#36251f', roughness: .84 }),
  new THREE.MeshStandardMaterial({ color: '#36251f', roughness: .84 })
]);
board.position.y = -.09; board.receiveShadow = true; scene.add(board);

try {
  const gltf = await new GLTFLoader().loadAsync('../../web/public/assets/chess-pieces.glb');
  const meshes = new Map();
  gltf.scene.traverse(o => { if (o.isMesh) meshes.set(o.name, o.geometry); });
  for (const name of ['King', 'Queen', 'Rook', 'Pawn']) if (!meshes.has(name)) throw Error(`Missing GLB mesh: ${name}`);
  const ivory = new THREE.MeshStandardMaterial({ color: 0xf1eadc, roughness: .52, metalness: .03 });
  const black = new THREE.MeshStandardMaterial({ color: 0x292b2f, roughness: .5, metalness: .08 });
  function piece(name, material, x, z, scale, tilt = 0) {
    const geo = meshes.get(name);
    geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo, material);
    mesh.scale.setScalar(scale);
    mesh.position.set(x, -geo.boundingBox.min.y * scale, z);
    mesh.rotation.z = tilt; mesh.rotation.y = x < 0 ? .32 : -.32;
    mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh);
    return mesh;
  }
  // A close, authored near-collision using the actual game meshes.
  piece('Queen', ivory, -.54, .17, 2.45, -.18);
  piece('King', black, .57, -.22, 2.62, .22);
  piece('Rook', black, size === 'portrait' ? 1.3 : 1.75, -1.05, 1.35, .1);
  piece('Pawn', ivory, -1.65, -.92, 1.45, -.16);
  renderer.render(scene, camera);
  document.documentElement.dataset.ready = 'true';
} catch (error) {
  document.documentElement.dataset.error = String(error);
  console.error(error);
}
