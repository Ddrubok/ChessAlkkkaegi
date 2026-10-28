const pokiBuild = typeof __POKI_BUILD__ !== "undefined" && __POKI_BUILD__;
const crazygamesBuild = typeof __CRAZYGAMES_BUILD__ !== "undefined" && __CRAZYGAMES_BUILD__;
const portalBuild = pokiBuild || crazygamesBuild;

export const PLATFORM = {
  id: crazygamesBuild ? "crazygames" : pokiBuild ? "poki" : "web",
  features: {
    online: !portalBuild,
    accounts: !portalBuild,
    externalLinks: !portalBuild,
    debugTools: !portalBuild,
  },
} as const;
