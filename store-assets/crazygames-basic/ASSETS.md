# Asset provenance — Poly Haven revision

Updated 2026-10-28 after replacing the earlier Free3D model. Current game meshes, collision data, covers, lobby/map images and portal preview captures use the replacement. Dated historical QA and cinematic projects are not release assets.

| Asset | Source | Rights / treatment |
|---|---|---|
| Six chess pieces | [Chess Set by Riley Queen / Poly Haven](https://polyhaven.com/a/chess_set) | CC0. Official glTF/BIN hashes and conversion instructions in assets-source/polyhaven-chess/README.md. GLB SHA-256: 2ee584b125a20ddcf388e4798f28a376f2b2a3a22e8590aec1f96fc71e6f6863. |
| Collision metadata | New Poly Haven geometry via web/src/tools/convert-polyhaven.mjs | Newly generated hulls, corrected support counts, original game mass calibration. No old collider vertices reused. |
| Board/materials | Existing web/src/scene.ts, procedural board | Existing project implementation. Poly Haven textures and website preview renders are not packaged. |
| Covers | cover.html, cover.js, current game GLB | Authored composition, not a gameplay screenshot; regenerated. |
| Preview videos | qa/polyhaven-model-2026-10-28/gameplay.mjs, local AI test play | Normal speed, 16 seconds, silent, no online-human claim. Exact cuts/commands in VIDEO_RENDER.json. |
| Lobby/map images | Actual game scene rendering | Three lobby images and 42 map previews regenerated from the replacement model. |
| Typography | Installed Bahnschrift, Arial fallback | Rasterized; font files not distributed. |
| In-game sound | web/public/assets/sound, from resource/sound | Existing source note records ChatGPT-generated synthesized audio; unchanged. |
| Independent banners/cosmetics | Existing project illustrations | Unchanged project artwork, not the replaced 3D model. |
| Runtime libraries | Existing lockfile | Notices retained in THIRD_PARTY_NOTICES.txt; model notice in assets/chess-model-license.txt. |

Poly Haven permits commercial use and redistribution without attribution: [license statement](https://polyhaven.com/license), [CC0](https://creativecommons.org/publicdomain/zero/1.0/). The previous Personal Use model restriction does not apply to these replacement files. Account access, portal preview and review/submission remain separate steps and have not been completed.
