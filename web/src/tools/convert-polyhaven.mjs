// Rebuild with: node web/src/tools/convert-polyhaven.mjs
// Check without writing: node web/src/tools/convert-polyhaven.mjs --check
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Matrix4, Quaternion, Vector3 } from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const sourceDir = path.join(root, 'assets-source/polyhaven-chess');
const outputDir = path.join(root, 'web/public/assets');
const names = ['Pawn', 'Rook', 'Knight', 'Bishop', 'Queen', 'King'];
// Frozen pre-replacement physical dimensions; never read these targets from the generated metadata.
const reference = {
  Pawn: { height: 0.520376, baseRadius: 0.133609 },
  Rook: { height: 0.589391, baseRadius: 0.149686 },
  Knight: { height: 0.739591, baseRadius: 0.175946 },
  Bishop: { height: 0.784872, baseRadius: 0.186174 },
  Queen: { height: 0.823122, baseRadius: 0.145615 },
  King: { height: 1, baseRadius: 0.164295 },
};
// Scalar gameplay calibration measured once at density=1 from the previous set.
// No old vertices/hulls are retained; new geometry still determines COM and inertia.
const referenceVolumes = {
  Pawn: 0.02285224199295044, Rook: 0.03689487650990486,
  Knight: 0.0556468740105629, Bishop: 0.04622941091656685,
  Queen: 0.06716735661029816, King: 0.08559558540582657,
};
const sourceNames = Object.fromEntries(names.map(name => [name, `piece_${name.toLowerCase()}_white${['Pawn', 'Rook', 'Knight', 'Bishop'].includes(name) ? '_01' : ''}`]));
const sha256 = data => createHash('sha256').update(data).digest('hex');
const round = number => Number(number.toFixed(6));
const check = process.argv.includes('--check');

const sourceJson = await readFile(path.join(sourceDir, 'chess_set_1k.gltf'));
const sourceBin = await readFile(path.join(sourceDir, 'chess_set.bin'));
if (sha256(sourceJson) !== '3e21ecd0c2ffb703dfdb3f3ea7a379c1dbd4ec513ba2cb8e6cb1e5f276d7eb91' ||
    sha256(sourceBin) !== 'c73476fd032a2cb4a9c256f70573eed260708132fdc42fec161c6216711560b3') {
  throw new Error('Poly Haven source hash mismatch');
}
const gltf = JSON.parse(sourceJson);
if (gltf.buffers?.[0]?.byteLength !== sourceBin.length || gltf.buffers?.[0]?.uri !== 'chess_set.bin') throw new Error('Source buffer mismatch');

const component = { 5121: [Uint8Array, 1], 5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4] };
const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function accessor(index) {
  const a = gltf.accessors[index], view = gltf.bufferViews[a.bufferView];
  if (a.sparse || a.normalized || a.bufferView === undefined || view.buffer !== 0) throw new Error(`Unsupported accessor ${index}`);
  const [ArrayType, bytes] = component[a.componentType] ?? [];
  const count = width[a.type];
  if (!ArrayType || !count) throw new Error(`Unsupported accessor ${index}`);
  const stride = view.byteStride ?? bytes * count;
  const offset = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const values = new Array(a.count * count);
  const data = new DataView(sourceBin.buffer, sourceBin.byteOffset, sourceBin.byteLength);
  for (let i = 0; i < a.count; i++) for (let j = 0; j < count; j++) {
    const at = offset + i * stride + j * bytes;
    values[i * count + j] = a.componentType === 5126 ? data.getFloat32(at, true) : bytes === 4 ? data.getUint32(at, true) : bytes === 2 ? data.getUint16(at, true) : data.getUint8(at);
  }
  return values;
}

function nodeMatrix(node) {
  if (node.matrix) return new Matrix4().fromArray(node.matrix);
  return new Matrix4().compose(new Vector3(...(node.translation ?? [0, 0, 0])), new Quaternion(...(node.rotation ?? [0, 0, 0, 1])), new Vector3(...(node.scale ?? [1, 1, 1])));
}

function sampleCollider(vertices, bounds) {
  const points = [];
  const height = bounds.max[1] - bounds.min[1];
  // A flat support ring, then radial extrema in seven height bands.
  for (let band = -1; band < 7; band++) {
    const bins = Array(48).fill(null);
    for (const vertex of vertices) {
      const y = vertex[1] - bounds.min[1];
      if (band === -1 ? y > height * 0.10 : Math.min(6, Math.floor(y / height * 7)) !== band) continue;
      const angle = (Math.atan2(vertex[2], vertex[0]) + Math.PI * 2) % (Math.PI * 2);
      const bin = Math.floor(angle / (Math.PI * 2) * 48);
      const radius = Math.hypot(vertex[0], vertex[2]);
      if (!bins[bin] || radius > bins[bin].radius) bins[bin] = { vertex, radius };
    }
    for (const item of bins) if (item) points.push([item.vertex[0], band === -1 ? 0 : item.vertex[1] - bounds.min[1], item.vertex[2]].map(round));
  }
  for (let axis = 0; axis < 3; axis++) for (const direction of [-1, 1]) {
    const vertex = vertices.reduce((best, current) => direction * current[axis] > direction * best[axis] ? current : best);
    points.push([vertex[0], vertex[1] - bounds.min[1], vertex[2]].map(round));
  }
  const unique = [...new Map(points.map(point => [point.join(','), point])).values()];
  if (unique.length < 4 || unique.length > 400) throw new Error(`Collider point count ${unique.length}`);
  return unique;
}

function baseHullSize(points) {
  const sorted = [...new Map(points.map(p => [`${p[0]},${p[2]}`, [p[0], p[2]]])).values()]
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (a, b, c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const hull = [];
  for (const p of sorted) {
    while (hull.length > 1 && cross(hull.at(-2), hull.at(-1), p) <= 1e-10) hull.pop();
    hull.push(p);
  }
  const lower = hull.length;
  for (let i = sorted.length - 2; i >= 0; i--) {
    while (hull.length > lower && cross(hull.at(-2), hull.at(-1), sorted[i]) <= 1e-10) hull.pop();
    hull.push(sorted[i]);
  }
  return hull.length - 1;
}

await RAPIER.init();
const measurementWorld = new RAPIER.World({ x: 0, y: 0, z: 0 });

const pieces = {};
const buffers = [];
const bufferViews = [];
const accessors = [];
const meshes = [];
const nodes = [];
let byteLength = 0;
function addArray(values, ArrayType, type, target, extrema) {
  const data = Buffer.from(new ArrayType(values).buffer);
  const padding = Buffer.alloc((4 - byteLength % 4) % 4);
  buffers.push(padding, data);
  byteLength += padding.length;
  const view = bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: data.length, target }) - 1;
  byteLength += data.length;
  return accessors.push({ bufferView: view, componentType: ArrayType === Float32Array ? 5126 : 5125, count: values.length / width[type], type, ...extrema }) - 1;
}

for (const name of names) {
  const sourceName = sourceNames[name];
  const node = gltf.nodes.find(item => item.name === sourceName);
  if (!node || node.mesh === undefined) throw new Error(`Missing separate source node ${sourceName}`);
  const matrix = nodeMatrix(node);
  const origin = new Vector3(0, 0, 0).applyMatrix4(matrix);
  const vertices = [], normals = [], indices = [];
  for (const primitive of gltf.meshes[node.mesh].primitives) {
    if (primitive.mode !== undefined && primitive.mode !== 4) throw new Error(`Non-triangle primitive in ${sourceName}`);
    const positions = accessor(primitive.attributes.POSITION);
    const sourceIndices = accessor(primitive.indices);
    const base = vertices.length;
    for (let i = 0; i < positions.length; i += 3) {
      const point = new Vector3(...positions.slice(i, i + 3)).applyMatrix4(matrix).sub(origin);
      // Spawn poses already rotate Knights +90/-90 degrees. Their authored forward
      // axis must therefore be -X so white faces +Z and black faces -Z in the game.
      if (name === 'Knight') point.set(point.z, point.y, -point.x);
      vertices.push(point.toArray());
      normals.push(0, 0, 0);
    }
    indices.push(...sourceIndices.map(index => index + base));
  }
  const min = [0, 1, 2].map(axis => Math.min(...vertices.map(vertex => vertex[axis])));
  const max = [0, 1, 2].map(axis => Math.max(...vertices.map(vertex => vertex[axis])));
  const sourceHeight = max[1] - min[1];
  const targetHeight = reference[name].height;
  const scale = targetHeight / sourceHeight;
  const centerX = (min[0] + max[0]) / 2, centerZ = (min[2] + max[2]) / 2;
  for (const vertex of vertices) {
    vertex[0] = (vertex[0] - centerX) * scale;
    vertex[1] = (vertex[1] - min[1]) * scale;
    vertex[2] = (vertex[2] - centerZ) * scale;
  }
  // Preserve the existing physical footprint while keeping the upper sculpture's proportions.
  const baseVertices = vertices.filter(vertex => vertex[1] <= targetHeight * 0.10);
  const sourceBaseRadius = Math.max(...baseVertices.map(vertex => Math.hypot(vertex[0], vertex[2])));
  const footprintScale = reference[name].baseRadius / sourceBaseRadius;
  for (const vertex of vertices) {
    const blend = Math.max(0, Math.min(1, (vertex[1] / targetHeight - 0.10) / 0.20));
    const horizontalScale = footprintScale + (1 - footprintScale) * blend;
    vertex[0] *= horizontalScale;
    vertex[2] *= horizontalScale;
  }
  // The footprint deformation changes surface slopes, so update vertex normals.
  normals.fill(0);
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = indices.slice(i, i + 3);
    const va = new Vector3(...vertices[a]), vb = new Vector3(...vertices[b]), vc = new Vector3(...vertices[c]);
    const face = vb.sub(va).cross(vc.sub(va));
    for (const index of [a, b, c]) for (let axis = 0; axis < 3; axis++) normals[index * 3 + axis] += face.getComponent(axis);
  }
  for (let i = 0; i < normals.length; i += 3) {
    const normal = new Vector3(...normals.slice(i, i + 3)).normalize();
    normals.splice(i, 3, ...normal.toArray());
  }
  const low = [0, 1, 2].map(axis => Math.min(...vertices.map(vertex => vertex[axis])));
  const high = [0, 1, 2].map(axis => Math.max(...vertices.map(vertex => vertex[axis])));
  const colliderPoints = sampleCollider(vertices, { min: low, max: high });
  const basePoints = colliderPoints.filter(point => point[1] === 0);
  const bounds = Object.fromEntries(['x', 'y', 'z'].map((axis, i) => [axis, round(high[i] - low[i])]));
  const measurementBody = measurementWorld.createRigidBody(RAPIER.RigidBodyDesc.dynamic());
  const descriptor = RAPIER.ColliderDesc.convexHull(new Float32Array(colliderPoints.flat()));
  if (!descriptor) throw new Error(`${name}: invalid collision hull`);
  measurementWorld.createCollider(descriptor.setDensity(1), measurementBody);
  const densityScale = referenceVolumes[name] / measurementBody.mass();
  measurementWorld.removeRigidBody(measurementBody);
  if (!Number.isFinite(densityScale) || densityScale <= 0) throw new Error(`${name}: invalid density scale`);
  pieces[name] = {
    triangles: indices.length / 3,
    bounds,
    baseRadius: round(Math.max(...basePoints.map(point => Math.hypot(point[0], point[2])))),
    baseFlattenEps: round(targetHeight * 0.10),
    basePointCount: basePoints.length,
    baseHullPointCount: baseHullSize(basePoints),
    baseRimPointCount: basePoints.length,
    densityScale,
    colliderPoints,
  };
  const position = addArray(vertices.flat(), Float32Array, 'VEC3', 34962, { min: low.map(round), max: high.map(round) });
  const normal = addArray(normals, Float32Array, 'VEC3', 34962);
  const index = addArray(indices, Uint32Array, 'SCALAR', 34963);
  const mesh = meshes.push({ name, primitives: [{ attributes: { POSITION: position, NORMAL: normal }, indices: index }] }) - 1;
  nodes.push({ name, mesh });
  console.log(`${name}: ${sourceName}, ${vertices.length} vertices, ${indices.length / 3} triangles, bounds ${JSON.stringify(bounds)}, baseRadius ${pieces[name].baseRadius}, collider ${colliderPoints.length}`);
}
measurementWorld.free();

const output = { asset: { version: '2.0', generator: 'convert-polyhaven.mjs' }, scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }], nodes, meshes, accessors, bufferViews, buffers: [{ byteLength }] };
const json = Buffer.from(JSON.stringify(output));
const jsonPadding = Buffer.alloc((4 - json.length % 4) % 4, 0x20);
const binary = Buffer.concat(buffers);
const binaryPadding = Buffer.alloc((4 - binary.length % 4) % 4);
const glb = Buffer.alloc(12 + 8 + json.length + jsonPadding.length + 8 + binary.length + binaryPadding.length);
let offset = 0;
for (const value of [0x46546c67, 2, glb.length, json.length + jsonPadding.length, 0x4e4f534a]) { glb.writeUInt32LE(value, offset); offset += 4; }
json.copy(glb, offset); offset += json.length; jsonPadding.copy(glb, offset); offset += jsonPadding.length;
glb.writeUInt32LE(binary.length + binaryPadding.length, offset); offset += 4;
glb.writeUInt32LE(0x004e4942, offset); offset += 4;
binary.copy(glb, offset); offset += binary.length; binaryPadding.copy(glb, offset);
const meta = {
  unit: 'Per-piece normalization; King height = 1.0',
  globalScale: 1,
  cellSize: 0.536003,
  boardThickness: 0.158766,
  pieces,
  source: {
    file: 'assets-source/polyhaven-chess/chess_set_1k.gltf + chess_set.bin',
    sha256: sha256(sourceBin),
    asset: 'https://polyhaven.com/a/chess_set',
    author: 'Riley Queen',
    license: 'CC0',
  },
};
const metaBytes = Buffer.from(JSON.stringify(meta, null, 2) + '\n');
if (check) {
  for (const [file, expected] of [['chess-pieces.glb', glb], ['chess-set.meta.json', metaBytes]]) {
    const actual = await readFile(path.join(outputDir, file));
    if (!actual.equals(expected)) throw new Error(`${file} differs from converter output`);
  }
  console.log('PASS: generated assets exactly match checked-in GLB and metadata');
} else {
  await writeFile(path.join(outputDir, 'chess-pieces.glb'), glb);
  await writeFile(path.join(outputDir, 'chess-set.meta.json'), metaBytes);
}
console.log(`Source glTF ${sha256(sourceJson)}, BIN ${sha256(sourceBin)}; output GLB ${sha256(glb)} (${glb.length} bytes), metadata ${sha256(metaBytes)} (${metaBytes.length} bytes)`);
