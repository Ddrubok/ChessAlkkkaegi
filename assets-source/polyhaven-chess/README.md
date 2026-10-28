# Poly Haven Chess Set geometry

- Asset: [Chess Set](https://polyhaven.com/a/chess_set) by Riley Queen.
- License: [CC0 1.0](https://polyhaven.com/license). Poly Haven identifies this asset as CC0 on its asset page. Attribution is appreciated but not required.
- Downloaded 2026-10-28 from the [official files API](https://api.polyhaven.com/files/chess_set). Only the glTF scene and its shared binary geometry buffer are kept; texture files were omitted because the game applies its own materials.
- `chess_set_1k.gltf`: https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/chess_set/chess_set_1k.gltf (API MD5 `ceac1016348f797f3db112e3e70a96a4`; SHA-256 `3e21ecd0c2ffb703dfdb3f3ea7a379c1dbd4ec513ba2cb8e6cb1e5f276d7eb91`).
- `chess_set.bin`: https://dl.polyhaven.org/file/ph-assets/Models/gltf/8k/chess_set/chess_set.bin (API MD5 `815ae6d5becbcdd836b29b0d644bba95`; SHA-256 `c73476fd032a2cb4a9c256f70573eed260708132fdc42fec161c6216711560b3`). The official 1K manifest points to this shared 8K buffer.

The glTF references external textures that are intentionally absent here. The converter reads only its geometry buffer and source node transforms; use `node web/src/tools/convert-polyhaven.mjs` from the repository root to regenerate the game GLB and metadata.

## Game adaptation

The six named white source pieces supply both teams' geometry. The game continues to supply its ivory/charcoal materials and procedural board. Each piece is centered horizontally with its bottom at Y=0; heights and base radii retain the game's previous numeric dimensions. Knight geometry is rotated +90° locally to work with the existing white/black spawn orientations. Its collision hull receives the same transformation.

All collision vertices are newly sampled from these Poly Haven meshes. The support ring projects the bottom 10% to a flat base; metadata records this actual range and the true perimeter vertex count. The rest of the silhouette is retained, with a gradual footprint correction below 30% of piece height.

`densityScale` compensates for the change in hull volume so each type retains its previous game mass at the same balance.csv settings. Its six reference volumes are scalar gameplay measurements, not copied mesh/collider data. New hulls determine center of mass and inertia, so individual collision trajectories can still differ. No force, friction, restitution or upgrade balance values were changed.

From `web`: `npm run convert:chess` rebuilds; `npm run check:chess` verifies byte-for-byte reproduction. Release builds run the check before packaging. See `qa/polyhaven-model-2026-10-28/README.md` for actual verification and limits.
