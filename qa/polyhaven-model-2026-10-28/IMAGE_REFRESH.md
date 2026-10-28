# Poly Haven shipping image refresh — 2026-10-28

**Final rerender:** After Knight orientation and mass corrections, the coordinator reran all commands below. Current GLB SHA-256 is `2ee584b125a20ddcf388e4798f28a376f2b2a3a22e8590aec1f96fc71e6f6863`. The final 42 map previews total **658,180 bytes**. The 3 lobby images, contact sheets, game captures and CrazyGames media now use this final model. Source-gate figures below are retained as the initial worker-run record.

## Source gate

- Browser-loaded metadata `source.file`: `assets-source/polyhaven-chess/chess_set_1k.gltf + chess_set.bin`.
- `chess_set.bin` SHA-256: `c73476fd032a2cb4a9c256f70573eed260708132fdc42fec161c6216711560b3`, matching `meta.source.sha256`.
- `web/public/assets/chess-pieces.glb` SHA-256: `43551297de4ac3f13a1e5df48cdaf715a5472e0350d5252ea4b119f98e43424d`.
- The lobby renderer checks this source before writing and checks the browser-loaded metadata again. It uses the live game `assets`, `scene`, and `physics` modules, with game board and materials.

## Commands run

From the repository root:

```text
node qa/polyhaven-model-2026-10-28/render-shipping-images.mjs --publish
cd web
node src/tools/capture-map-previews.mjs
```

While the capture server was running, from the repository root:

```text
node qa/polyhaven-model-2026-10-28/capture-map-runner.mjs
node qa/polyhaven-model-2026-10-28/save-image-evidence.mjs
cd web
npm run check:map-previews
```

The map runner pressed the existing `/capture` button and received `14개 맵 · 42개 정적 이미지 저장 완료`. The check passed: 14 maps × 3 unique still WebP views, expected dimensions, 660,586 bytes total.

## Exact regenerated shipping files

Lobby: `web/public/assets/lobby/hero-stage.jpg`, `hero-tutorial.jpg`, `avatar-knight.jpg`. The stage image places a white knight at d4 and a black pawn at e5 through the stage physics bodies before rendering. The tutorial shows the settled full board. The avatar isolates the real white Knight mesh in the same game scene.

Map preview directory: `web/src/assets/map-previews/`. Each ID below has exactly these three regenerated files: `<ID>-perspective.webp`, `<ID>-plan.webp`, and `<ID>-thumb.webp`.

| ID | ID | ID | ID |
| --- | --- | --- | --- |
| `classic` | `gm-blocks-and-hole-v1` | `gm-bounce-corridor-v1` | `gm-bounce-ramps-v1` |
| `gm-breakable-bridge-v1` | `gm-collapsing-center-v1` | `gm-collapsing-crown-v1` | `gm-control-square-v1` |
| `gm-ice-gate-v1` | `gm-ice-lane-v1` | `gm-ice-pockets-v1` | `gm-launch-ramps-v1` |
| `gm-push-blocks-v1` | `gm-rotating-gate-v1` | | |

No capture manifest exists in this directory.

## Visual check

- [Lobby contact screenshot](evidence-lobby.png): board, white/black Poly Haven pieces, staged center encounter, and a complete knight silhouette at 160 × 160.
- [All map thumbnail contact screenshot](evidence-map-thumbs.png): 14 distinct map layouts with the replacement pieces visible. Individually inspected `classic-perspective.webp`, `gm-ice-lane-v1-perspective.webp`, and `gm-rotating-gate-v1-plan.webp`; pieces and map surface features were visible with no obvious clipping.
- Lobby JPEG dimensions stay 567 × 409, 960 × 340, and 160 × 160. Map perspectives stay 960 × 600, plans 400 × 400, and thumbs 240 × 150.

Only the assigned lobby and map images were replaced. Existing banners, cosmetics, and icons were left alone.
