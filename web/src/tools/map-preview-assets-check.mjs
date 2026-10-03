import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { HOTSEAT_MAP_CATALOG } from '../maps/map-catalog.ts';

const views = { perspective: [960, 600], plan: [400, 400], thumb: [240, 150] };
let bytes = 0;
for (const [view, dimensions] of Object.entries(views)) {
  const hashes = new Set();
  for (const entry of HOTSEAT_MAP_CATALOG) {
    const name = `${entry.id}-${view}.webp`;
    const buffer = await readFile(new URL(`../assets/map-previews/${name}`, import.meta.url));
    assert.equal(buffer.toString('ascii', 0, 4), 'RIFF', name);
    assert.equal(buffer.toString('ascii', 8, 12), 'WEBP', name);
    const chunk = buffer.toString('ascii', 12, 16);
    let size;
    if (chunk === 'VP8X') {
      assert.equal(buffer[20] & 2, 0, `${name}: previews must be still images`);
      size = [buffer.readUIntLE(24, 3) + 1, buffer.readUIntLE(27, 3) + 1];
    } else if (chunk === 'VP8 ') {
      size = [buffer.readUInt16LE(26) & 0x3fff, buffer.readUInt16LE(28) & 0x3fff];
    } else throw new Error(`${name}: unexpected capture format ${chunk}`);
    assert.deepEqual(size, dimensions, `${name}: wrong capture dimensions`);
    assert.ok(buffer.length > 1000, `${name}: suspiciously empty capture`);
    hashes.add(createHash('sha256').update(buffer).digest('hex'));
    bytes += buffer.length;
  }
  assert.equal(hashes.size, HOTSEAT_MAP_CATALOG.length, `${view}: duplicated map pictures`);
}
console.log(`PASS: ${HOTSEAT_MAP_CATALOG.length} maps × 3 still WebP views, dimensions, unique images; ${bytes} bytes total`);
