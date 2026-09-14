const noop = new Proxy({}, {
  get: (target, key) => key === "visible" ? true : target[key] ?? noop,
  set: () => true,
});

globalThis.localStorage ??= {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
};
globalThis.document ??= new Proxy({ documentElement: {}, body: {} }, {
  get: (target, key) => target[key] ?? noop,
});
globalThis.window ??= globalThis;
globalThis.navigator ??= { userAgent: "node-headless" };
