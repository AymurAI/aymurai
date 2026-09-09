import "@testing-library/jest-dom/vitest";

// jsdom does not implement `Element.prototype.scrollIntoView` at all --
// calling it throws "is not a function". `DecisionTabs` (recommendations,
// legacy validate-dataset) calls it on every tab click to bring the clicked
// tab into view, so any test that clicks a tab needs this stubbed. A no-op
// is enough: no test asserts on actual scroll position, only on the call
// happening (see `decision-tabs/index.test.tsx`).
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// Node >= 24 defines an experimental `localStorage` global whose getter returns
// `undefined` unless the process was started with `--localstorage-file`. That
// property wins the name collision with the Storage the jsdom test environment
// installs, so on those Node versions every `localStorage.*` call throws
// "Cannot read properties of undefined". Install a spec-compliant in-memory
// Storage when the ambient one is unusable, so the suite — and therefore the
// gate command — behaves identically on every supported Node version rather
// than passing on 22 and failing on 26.
if (globalThis.localStorage == null) {
  const store = new Map<string, string>();

  const storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(String(key)) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(String(key));
    },
    setItem(key: string, value: string) {
      store.set(String(key), String(value));
    },
  } as Storage;

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get: () => storage,
  });
}
