# Poly Haven converter review — 2026-10-28

**Final resolution:** The findings below describe the first conversion. The coordinator subsequently corrected Knight orientation (+90° Y), base statistics, and per-piece density calibration. The final independent verifier and source conversion check both passed, including source geometry, actual base hull counts and original masses. Final GLB SHA-256: `2ee584b125a20ddcf388e4798f28a376f2b2a3a22e8590aec1f96fc71e6f6863`; metadata: `e386535e27f86a9f4114c566c8e9d3b47706d49e59a2b07544864cf2607d7ce8`. See [final report](README.md), `geometry-physics-final.log` and `mass-final.log`. The historical findings remain below for traceability; shape and inertia differences still apply.

Run: `node web/src/tools/convert-polyhaven.mjs --check` and `node qa/polyhaven-model-2026-10-28/verify-conversion.mjs` from repository root. Both passed. The verifier is read only and imports the current `config.ts` and `physics.ts` through Vite. It uses the committed pre-migration metadata from `git show HEAD:web/public/assets/chess-set.meta.json` for old mass and dimension comparisons.

## Material findings

1. **Mass and collision footprint changed despite preserved height/base radius.** The physical hulls are new volumes. At the current CSV density and piece weight multipliers, Rapier gives the following unupgraded online piece masses. Queen loses 30.3% and King loses 35.2%; with the same impulse, the lighter bodies can move farther and resist impacts less. This is a gameplay consequence to evaluate, not a reason to force the prior balance into the converter.

   | Piece | Old mass | New mass | Change | Old X × Z bounds | New X × Z bounds |
   | --- | ---: | ---: | ---: | --- | --- |
   | Pawn | 0.027423 | 0.021555 | -21.4% | .305761 × .306106 | .266482 × .267153 |
   | Rook | 0.044274 | 0.048674 | +9.9% | .332771 × .332770 | .315980 × .317015 |
   | Knight | 0.066776 | 0.064449 | -3.5% | .445781 × .407968 | .328236 × .447532 |
   | Bishop | 0.055475 | 0.048351 | -12.8% | .371904 × .372107 | .370364 × .370641 |
   | Queen | 0.080601 | 0.056155 | -30.3% | .403702 × .409468 | .307604 × .308464 |
   | King | 0.102715 | 0.066539 | -35.2% | .448265 × .447736 | .326371 × .327887 |

2. **Knight's long axis is rotated into the board X direction by the existing spawn pose.** The shipped Knight upper 30% spans X `[-.1175,.1178]`, Z `[-.2039,.1804]` in local coordinates. `web/src/stage.ts` applies +90° Y for white Knights and -90° for black, and `web/src/scene.ts` copies that pose to the visual mesh. Thus the elongated head/neck silhouette runs across board X after spawning, whereas the authored local model runs along Z. The old Knight had its larger full bound along X (`.445781` versus Z `.407968`), so the unchanged runtime rotation has a different geometric effect. This is a concrete orientation change; a rendered in-game inspection should decide the intended nose direction before changing the pose.

3. **Base statistics claim more hull vertices and a much thinner flatten region than generated.** The converter sets `baseHullPointCount = basePointCount`, but the planar convex hull has respectively **20/23, 24/26, 30/39, 30/31, 30/31, 30/33** actual/declared points for Pawn through King. Some declared base points are interior to the hull. It also reports `baseFlattenEps: .004` while projecting points from as high as **.04684, .05726, .07368, .07195, .07689, .08070** to Y=0. This is a metadata accuracy defect, not a failed stability test: current `physics.ts` consumes `colliderPoints`, not these two summary fields. Correct the summaries if they are used as QA evidence or by future consumers.

## Passing evidence

- The converter's `--check` matched both shipped files byte for byte: GLB SHA-256 `43551297de4ac3f13a1e5df48cdaf715a5472e0350d5252ea4b119f98e43424d`; metadata SHA-256 `d2dfb97573d0d37a0c4ab0664ad16cf2118b03af96fcb8ae414cc1ac76733e42`.
- All six selected source mesh nodes are root nodes with identity local/world determinant `+1`, so no omitted parent transform or mirror correction applies to these pinned inputs. The verifier independently reapplies source node transforms, normalization, base footprint blend, and source triangle indices. All shipped positions differ by less than `3.0e-8`, all 6 index arrays match, and no tested nondegenerate triangle has opposing averaged normals. This also establishes that the six shipped position streams derive from the pinned Poly Haven source rather than the old mesh. The verifier did not audit unused source nodes or textures.
- Every visual mesh has minimum Y=0; all six heights and base radii exactly match the frozen pre-migration references. Base hulls have at least 20 genuine perimeter vertices. The visible upper widths differ as shown above.
- In real Rapier worlds created by current `physics.ts`/`config.ts`, all six individual bodies settled sleeping after 720 steps at 120 Hz. Rotation quaternion dot from spawn was at least `.9999818`; vertical settlement was within `1.18 mm`. All six crossed a board edge and fell below Y=-1 under the same controlled 1.4 m/s outward push. A Pawn at 2.5 m/s contacted and displaced a Knight (Knight X `.25` to `.442`).

## Limits

The pair fixture tests Pawn–Knight only; it does not establish every pair outcome or preserve old launch-distance balance. Edge tests use a controlled velocity and are not normal input-power shots. The geometry calculation checks source-derived positions, indices, determinant and normals, but Knight nose direction needs an in-game image to judge aesthetics. Existing `balance-physics` and `queen-overdrive` passes were supplied by the coordinator; this review did not rerun them.
