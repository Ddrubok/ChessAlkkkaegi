const pokiBuild = typeof __POKI_BUILD__ !== "undefined" && __POKI_BUILD__;

export const PLATFORM = {
  id: pokiBuild ? "poki" : "web",
  features: {
    online: !pokiBuild,
    accounts: !pokiBuild,
    externalLinks: !pokiBuild,
    debugTools: !pokiBuild,
  },
} as const;
