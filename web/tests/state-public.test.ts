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
const boundary = await import("../src/state/public.ts");
const { useUi, uiActions } = boundary;
const initial = raw.getState();
beforeEach(() => raw.setState(initial, true));

test("public snapshots expose all data with stable field references and no raw API or projection actions", () => {
  const expected = Object.fromEntries(Object.entries(raw.getState()).filter(([, v]) => typeof v !== "function"));
  const data = useUi.getState(); assert.deepEqual(data, expected); assert.equal(useUi.getState(), data);
  assert.equal(data.characters, raw.getState().characters); assert.equal(data.messages, raw.getState().messages);
  assert.equal((useUi as any).setState, undefined); assert.equal((useUi as any).subscribe, undefined);
  for (const name of ["setMe", "setConnected", "setCampaign", "setCharacters", "setCombat", "setMessages", "pushMessage"]) {
    assert.equal((data as any)[name], undefined); assert.equal((uiActions as any)[name], undefined);
  }
});

test("whole public snapshots change on every root update while field selector identity remains stable", () => {
  const snapshots = [useUi.getState()], chars = snapshots[0].characters;
  const off = raw.subscribe(() => snapshots.push(useUi.getState()));
  uiActions.setZoom(1); uiActions.setZoom(1); off();
  assert.equal(snapshots.length, 3);
  assert.notEqual(snapshots[0], snapshots[1]); assert.notEqual(snapshots[1], snapshots[2]);
  for (const state of snapshots) assert.equal(boundary.selectCharacters(state), chars);
});

test("selectors are pure projections of their argument rather than hidden singleton reads", () => {
  const data = useUi.getState(), alternate = {...data, isGm: true, zoom: 7, characters: {}};
  assert.equal(boundary.selectIsGm(alternate), true); assert.equal(boundary.selectZoom(alternate), 7);
  assert.equal(boundary.selectCharacters(alternate), alternate.characters);
  assert.equal(raw.getState().isGm, false); assert.equal(raw.getState().zoom, 1);
  assert.equal(Object.keys(boundary).filter(name => name.startsWith("select")).length, 34);
});

test("named selection and dismiss actions preserve the original one-patch notification behavior", () => {
  raw.setState({notice: "notice"}); const messages = raw.getState().messages;
  const seen: {count: number; editable: number; notice: string | null}[] = [];
  const off = raw.subscribe(s => seen.push({count: s.selectionCount, editable: s.selectionEditable, notice: s.notice}));
  uiActions.setSelectionCounts(3, 2); uiActions.dismissNotice(); off();
  assert.deepEqual(seen, [{count: 3, editable: 2, notice: "notice"}, {count: 3, editable: 2, notice: null}]);
  assert.equal(raw.getState().messages, messages);
});

test("public logout intent atomically removes private projections", () => {
  raw.setState({me: {id: "gm", name: "GM", is_gm: true}, isGm: true, lastInvite: {token: "test-only", user_id: null}, combatOpen: true});
  const before = raw.getState(); uiActions.endSession();
  assert.equal(raw.getState().me, null); assert.equal(raw.getState().isGm, false);
  assert.equal(raw.getState().lastInvite, null); assert.equal(raw.getState().combatOpen, false);
  assert.equal(raw.getState().sessionEpoch, before.sessionEpoch + 1);
  assert.equal(raw.getState().diceAnimation, before.diceAnimation);
});
