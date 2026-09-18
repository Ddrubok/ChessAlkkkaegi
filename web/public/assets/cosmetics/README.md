# Six-slot cosmetic assets

Reference-derived source PNGs are in `web/src/dev/banner-lab/assets/`.
These WebP copies resize and encode those existing derivatives without changing the designs.

| File | Width | Encoded bytes |
| --- | --- | --- |
| classic-frame.webp | 990 | 42,926 |
| first-victory-badge.webp | 128 | 9,768 |

Both preserve transparency. Original user reference sheets remain untouched in
`C:/Users/DooBokWie/Desktop/BannerAssets`. See `BANNER_ASSET_CATALOG.md` for provenance.
Frames for badges and titles use CSS; no extra raster download is necessary.

## Original badge artwork (2026-09-18)

`badge-m01.webp` through `badge-m08.webp` use the user's original
`C:/Users/DooBokWie/Desktop/BannerAssets/badge2.png` sheet directly.
No artwork was regenerated. The sheet labels were excluded; circular clipping
keeps its dark backing inside the badge. The originals remain untouched.
Each source region is 152×152 pixels, encoded at 192×192 WebP quality 0.94.
All eight files total 145,724 bytes (about 142 KiB).

| Existing medal ID | Source illustration | Crop x,y,width,height |
| --- | --- | --- |
| M01 | 01 First victory pawn | 9,131,152,152 |
| M02 | 04 Knight | 464,131,152,152 |
| M03 | 03 Strategy book | 313,131,152,152 |
| M04 | 10 Precision compass | 1375,131,152,152 |
| M05 | 02 Winning flame | 162,131,152,152 |
| M06 | 07 Crossed swords | 923,131,152,152 |
| M07 | 12 Shield | 162,395,152,152 |
| M08 | 16 Explorer compass | 769,395,152,152 |

Medal IDs, names, earning rules and SQL are unchanged. The old
`first-victory-badge.webp` is retained for the earlier prototype; production
badges now use the eight originals above.
