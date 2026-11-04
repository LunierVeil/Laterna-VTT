import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
registerHooks({resolve(specifier, context, next) {
  try { return next(specifier, context); } catch (error) {
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
    throw error;
  }
}});
const storage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
Object.defineProperty(globalThis, "localStorage", {configurable: true, value: {getItem: () => null, setItem: () => {}}});
after(() => { if (storage) Object.defineProperty(globalThis, "localStorage", storage); else delete (globalThis as any).localStorage; });
const { useUi: raw } = await import("../src/state/store.ts");
const { useUi, uiActions } = await import("../src/state/public.ts");
const { projectionActions } = await import("../src/state/bridge.ts");
const initial = raw.getState(); beforeEach(() => raw.setState(initial, true));

test("bridge replacement/delete and UI close retain one cross-domain delete transition", () => {
  const character = {id: "c", owner_id: null, name: "C", system: "dnd5e", data: {}, source_format: null};
  projectionActions.setCharacters([character]); uiActions.openCharacter("c");
  assert.equal(useUi.getState().characters.c, character);
  const seen: [number, string | null][] = [];
  const off = raw.subscribe(s => seen.push([Object.keys(s.characters).length, s.openCharacterId]));
  projectionActions.dropCharacter("c"); off();
  assert.deepEqual(seen, [[0, null]]); assert.equal((projectionActions as any).setState, undefined);
});

test("UI can clear a previous invite code but only bridge can apply a received reply", () => {
  projectionActions.setLastInvite({token: "old-test-code", user_id: null});
  projectionActions.setCampaign("s", undefined, [], undefined);
  assert.equal(useUi.getState().lastInvite?.token, "old-test-code", "existing omitted-field policy");
  let notifications = 0; const off = raw.subscribe(() => notifications++);
  uiActions.clearLastInvite(); off(); assert.equal(notifications, 1); assert.equal(useUi.getState().lastInvite, null);
  assert.equal((uiActions as any).setLastInvite, undefined);
  projectionActions.setLastInvite({token: "new-test-code", user_id: null});
  assert.equal(useUi.getState().lastInvite?.token, "new-test-code");
});
