import { test, after } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createStore } from "zustand/vanilla";
registerHooks({resolve(specifier, context, next) {
  try { return next(specifier, context); } catch (error) {
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
    throw error;
  }
}});
const storage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const nav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
after(() => {
  for (const [key, descriptor] of [["localStorage", storage], ["navigator", nav]] as const) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as any)[key];
  }
});
const { createUiState } = await import("../src/state/factory.ts");
function environment(value: string | null, hardwareConcurrency: number) {
  const reads: string[] = [];
  Object.defineProperty(globalThis, "localStorage", {configurable: true, value: {
    getItem: (key: string) => { reads.push(key); return value; }, setItem: () => {},
  }});
  Object.defineProperty(globalThis, "navigator", {configurable: true, value: {hardwareConcurrency}});
  return reads;
}
test("factory preserves preference defaults, precedence and original storage read short-circuit", () => {
  for (const [value, cores, expected, count] of [
    [null, 8, true, 2], [null, 2, false, 2], [null, 0, true, 2],
    ["on", 2, true, 1], ["off", 8, false, 2], ["unknown", 1, false, 2],
  ] as const) {
    const reads = environment(value, cores), store = createStore(createUiState);
    assert.equal(store.getState().diceAnimation, expected);
    assert.deepEqual(reads, Array(count).fill("lanterna.diceAnimation"));
  }
});
test("isolated test instances keep actions and timer reads within their own state", t => {
  environment(null, 8); t.mock.timers.enable({apis: ["setTimeout", "Date"], now: 0});
  const a = createStore(createUiState), b = createStore(createUiState);
  a.getState().setTool("ruler"); assert.equal(b.getState().tool, "select");
  a.getState().flashError("a"); b.getState().flashError("b");
  t.mock.timers.tick(2500); assert.equal(a.getState().error, null); assert.equal(b.getState().error, null);
  a.getState().flashNotice("notice"); assert.equal(b.getState().notice, null);
  t.mock.timers.tick(8000); assert.equal(a.getState().notice, null);
});
