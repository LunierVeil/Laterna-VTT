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
Object.defineProperty(globalThis, "localStorage", {configurable: true, value: {getItem: () => "off", setItem: () => {}}});
after(() => {if (storage) Object.defineProperty(globalThis, "localStorage", storage); else delete (globalThis as any).localStorage;});
const { createUiState } = await import("../src/state/factory.ts");
const gm = {id: "gm", name: "GM", is_gm: true};
const character = {id: "c", name: "C", owner_id: "gm", system: "dnd5e", data: {}, source_format: null};

test("same-identity snapshot does not reset open sheet, local interaction or device preference", () => {
  const s = createStore(createUiState), a = s.getState();
  a.setMe(gm); a.setCharacters([character]); a.openCharacter("c");
  a.setTool("ruler"); a.setDiceOpen(true); a.setSideTab("characters");
  a.setMe({...gm, name: "Renamed GM"});
  assert.equal(s.getState().characters.c, character); assert.equal(s.getState().openCharacterId, "c");
  assert.equal(s.getState().tool, "ruler"); assert.equal(s.getState().diceOpen, true);
  assert.equal(s.getState().sideTab, "characters"); assert.equal(s.getState().diceAnimation, false);
});

test("disconnect/retry flag never logs out or drops campaign data and open sheet", () => {
  const s = createStore(createUiState), a = s.getState();
  a.setMe(gm); a.setCharacters([character]); a.openCharacter("c");
  a.setCampaign("scene", [{id: "scene", name: "Scene"}], [gm], []);
  a.setConnected(true); const before = s.getState(); a.setConnected(false);
  for (const key of ["me", "characters", "openCharacterId", "accounts", "activeSceneId", "diceAnimation"] as const) assert.equal(s.getState()[key], before[key], key);
  assert.equal(s.getState().connected, false); a.setConnected(true); assert.equal(s.getState().connected, true);
});

test("new scene combat projection preserves character context and closes no sheet", () => {
  const s = createStore(createUiState), a = s.getState(); a.setMe(gm);
  a.setCharacters([character]); a.openCharacter("c");
  const next = {round: 2, current: null, entries: []}; a.setCombat(next);
  assert.equal(s.getState().combat, next); assert.equal(s.getState().openCharacterId, "c");
  assert.equal(s.getState().characters.c, character); a.setCombat(null);
  assert.equal(s.getState().combat, null); assert.equal(s.getState().openCharacterId, "c");
});

for (const [field, action, duration] of [["error", "flashError", 2500], ["notice", "flashNotice", 8000]] as const) {
  test(`${field}: repeated identical text survives old timer and expires at its own exact deadline`, t => {
    t.mock.timers.enable({apis: ["setTimeout", "Date"], now: 0});
    const s = createStore(createUiState), a = s.getState();
    a[action]("same"); t.mock.timers.tick(1000); a[action]("same");
    t.mock.timers.tick(duration - 1000); assert.equal(s.getState()[field], "same");
    t.mock.timers.tick(999); assert.equal(s.getState()[field], "same");
    t.mock.timers.tick(1); assert.equal(s.getState()[field], null);
  });
  test(`${field}: logout/new identity invalidates the previous user's timer`, t => {
    t.mock.timers.enable({apis: ["setTimeout", "Date"], now: 0});
    const s = createStore(createUiState), a = s.getState(); a.setMe(gm);
    a[action]("same"); t.mock.timers.tick(1000); a.setMe(null);
    a.setMe({id: "p", name: "Player", is_gm: false}); a[action]("same");
    t.mock.timers.tick(duration - 1000); assert.equal(s.getState()[field], "same");
    t.mock.timers.tick(1000); assert.equal(s.getState()[field], null);
    assert.equal(s.getState().diceAnimation, false);
  });
}

test("manual error/dismiss actions retire pending toast callbacks without changing their semantics", t => {
  t.mock.timers.enable({apis: ["setTimeout", "Date"], now: 0});
  const s = createStore(createUiState), a = s.getState();
  a.flashError("same"); t.mock.timers.tick(1000); a.setError("same");
  t.mock.timers.tick(1500); assert.equal(s.getState().error, "same", "manual error has no auto-dismiss timer");
  a.setError(null); assert.equal(s.getState().error, null);
  a.flashNotice("same"); t.mock.timers.tick(1000); a.dismissNotice();
  assert.equal(s.getState().notice, null); a.flashNotice("same");
  t.mock.timers.tick(7000); assert.equal(s.getState().notice, "same");
  t.mock.timers.tick(1000); assert.equal(s.getState().notice, null);
});
