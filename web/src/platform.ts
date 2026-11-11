const pokiBuild = typeof __POKI_BUILD__ !== "undefined" && __POKI_BUILD__;
const crazygamesBuild = typeof __CRAZYGAMES_BUILD__ !== "undefined" && __CRAZYGAMES_BUILD__;
const itchBuild = typeof __ITCH_BUILD__ !== "undefined" && __ITCH_BUILD__;
const portalBuild = pokiBuild || crazygamesBuild || itchBuild;

export const PLATFORM = {
  id: crazygamesBuild ? "crazygames" : itchBuild ? "itch" : pokiBuild ? "poki" : "web",
  features: {
    solo: crazygamesBuild || itchBuild,
    // Solo review candidate. Keep the other releases' multiplayer routes intact.
    online: !pokiBuild && !crazygamesBuild,
    cloudProgress: !pokiBuild,
    accounts: !pokiBuild && !crazygamesBuild,
    externalLinks: !portalBuild,
    debugTools: !portalBuild,
  },
} as const;
