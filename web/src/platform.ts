const pokiBuild = typeof __POKI_BUILD__ !== "undefined" && __POKI_BUILD__;
const crazygamesBuild = typeof __CRAZYGAMES_BUILD__ !== "undefined" && __CRAZYGAMES_BUILD__;
const portalBuild = pokiBuild || crazygamesBuild;

export const PLATFORM = {
  id: crazygamesBuild ? "crazygames" : pokiBuild ? "poki" : "web",
  features: {
    // Solo review candidate. Keep the other releases' multiplayer routes intact.
    online: !portalBuild,
    cloudProgress: !pokiBuild,
    accounts: !portalBuild,
    externalLinks: !portalBuild,
    debugTools: !portalBuild,
  },
} as const;
