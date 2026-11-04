import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import type { Character, Message, UserInfo } from "../src/shared/api/protocol.ts";
import type { Tool } from "../src/entities/scene/model/tool.ts";

registerHooks({resolve(specifier, context, next) {
  try { return next(specifier, context); } catch (error) {
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
    throw error;
  }
}});
const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const saved = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {configurable: true, value: {
  getItem: (key: string) => saved.get(key) ?? null,
  setItem: (key: string, value: string) => { saved.set(key, value); },
}});
Object.defineProperty(globalThis, "navigator", {configurable: true, value: {hardwareConcurrency: 8}});
const { useUi } = await import("../src/state/store.ts");
const initial = useUi.getState();
beforeEach(() => { saved.clear(); useUi.setState(initial, true); });
after(() => {
  for (const [key, descriptor] of [["localStorage", storageDescriptor], ["navigator", navigatorDescriptor]] as const) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete (globalThis as any)[key];
  }
});
const gm: UserInfo = {id: "gm", name: "GM", is_gm: true};
const player: UserInfo = {id: "player", name: "Player", is_gm: false};
const character = (id: string): Character => ({id, name: id, owner_id: gm.id, system: "dnd5e", data: {}, source_format: null});
const message = (id: string): Message => ({id, author: "GM", author_id: gm.id, text: id, kind: "text", roll: null, created_at: null});
const scenes = [{id: "scene", name: "Scene"}];
const invites = [{id: "invite", user_id: null, expires_at: "later"}];

test("state defaults preserve the complete flat data contract and stable actions", () => {
  const data = Object.fromEntries(Object.entries(initial).filter(([, v]) => typeof v !== "function"));
  assert.deepEqual(data, {
    me: null, isGm: false, accounts: [], invites: [], lastInvite: null, characters: {},
    openCharacterId: null, combat: null, combatOpen: false, placeHidden: false,
    fogMode: "cover", wallKind: "wall", hiddenRolls: false, sideTab: "chat", zoom: 1,
    tool: "select", messages: [], users: [], connected: false, error: null, notice: null,
    sceneName: "", gridSize: 70, background: null, chaining: false, selected: null,
    selectionCount: 0, selectionEditable: 0, activeSceneId: null, scenes: [], folders: [],
    diceOpen: false, diceAnimation: true,
  });
  initial.setTool("ruler"); initial.setConnected(true);
  for (const [key, value] of Object.entries(initial)) if (typeof value === "function") {
    assert.equal((useUi.getState() as any)[key], value, key);
  }
});

test("setMe sanitizes exactly the existing GM tools/tabs in one notification", () => {
  for (const next of [player, null]) for (const tool of ["select", "ruler", "ping", "token", "wall", "erase", "fog"] as Tool[]) {
    useUi.setState({...initial, me: gm, isGm: true, scenes, folders: [{id: "folder", name: "Folder"}], tool, sideTab: "players"}, true);
    let notifications = 0; const off = useUi.subscribe(() => notifications++);
    initial.setMe(next); off();
    const state = useUi.getState();
    assert.equal(state.me, next); assert.equal(state.isGm, false);
    assert.equal(state.tool, ["token", "wall", "erase", "fog"].includes(tool) ? "select" : tool);
    assert.equal(state.sideTab, "chat"); assert.deepEqual(state.scenes, []); assert.deepEqual(state.folders, []);
    assert.equal(notifications, 1);
  }
  useUi.setState({...initial, tool: "ruler", sideTab: "characters", scenes}, true);
  initial.setMe(gm); assert.equal(useUi.getState().scenes, scenes); assert.equal(useUi.getState().sideTab, "characters");
});

test("AS-IS identity/logout setter preserves caches; full reset is reserved for 08b", () => {
  initial.setMe(gm); initial.setCharacters([character("c")]); initial.openCharacter("c");
  initial.setCampaign("scene", scenes, [gm], invites); initial.setLastInvite({token: "test-only", user_id: null});
  initial.setMessages([message("m")]); initial.setCombat({round: 1, current: null, entries: []});
  const before = useUi.getState();
  for (const me of [player, null]) {
    initial.setMe(me); const state = useUi.getState();
    for (const key of ["characters", "openCharacterId", "invites", "lastInvite", "messages", "combat", "activeSceneId"] as const) assert.equal(state[key], before[key], key);
  }
});

test("campaign missing scenes and empty scenes preserve different existing merge semantics", () => {
  const folders = [{id: "f", name: "F"}];
  initial.setCampaign("scene", scenes, [gm], invites, folders);
  initial.setLastInvite({token: "test-only", user_id: null}); const code = useUi.getState().lastInvite;
  initial.setCampaign("next", undefined, [player], undefined);
  assert.deepEqual(useUi.getState().scenes, []); assert.deepEqual(useUi.getState().folders, []);
  assert.equal(useUi.getState().invites, invites); assert.equal(useUi.getState().lastInvite, code);
  initial.setCampaign("next", [], [player], undefined);
  assert.deepEqual(useUi.getState().invites, []); assert.deepEqual(useUi.getState().folders, []);
  assert.equal(useUi.getState().lastInvite, code);
});

test("characters replace/upsert/delete preserve references and close only the affected sheet", () => {
  const a = character("a"), b = character("b"); initial.setCharacters([a]); initial.putCharacter(b);
  assert.equal(useUi.getState().characters.a, a); assert.equal(useUi.getState().characters.b, b);
  initial.openCharacter("a"); initial.dropCharacter("b"); assert.equal(useUi.getState().openCharacterId, "a");
  let notifications = 0; const off = useUi.subscribe(() => notifications++);
  initial.dropCharacter("a"); off();
  assert.deepEqual(useUi.getState().characters, {}); assert.equal(useUi.getState().openCharacterId, null); assert.equal(notifications, 1);
  initial.setCharacters([b]); assert.deepEqual(Object.keys(useUi.getState().characters), ["b"]);
});

test("history replacement has no clamp while live append caps 200 without deduplication", () => {
  const history = Array.from({length: 250}, (_, i) => message(String(i))); initial.setMessages(history);
  assert.equal(useUi.getState().messages, history); assert.equal(useUi.getState().messages.length, 250);
  initial.pushMessage(message("249")); const result = useUi.getState().messages;
  assert.equal(result.length, 200); assert.equal(result[0].id, "51");
  assert.equal(result.filter(m => m.id === "249").length, 2); assert.equal(history.length, 250);
});

test("scene/projection setters do not introduce a reset or touch unrelated caches", () => {
  initial.setCharacters([character("c")]); initial.openCharacter("c");
  initial.setCombat({round: 1, current: null, entries: []}); initial.setMessages([message("m")]);
  useUi.setState({selectionCount: 2, selectionEditable: 1}); const before = useUi.getState();
  initial.setSelected(null); initial.setScene("Next", 100, "/uploads/test.png"); initial.setConnected(false);
  const state = useUi.getState(); assert.equal(state.selectionCount, 2); assert.equal(state.selectionEditable, 1);
  for (const key of ["characters", "openCharacterId", "combat", "messages"] as const) assert.equal(state[key], before[key], key);
  assert.deepEqual([state.sceneName, state.gridSize, state.background], ["Next", 100, "/uploads/test.png"]);
});

test("toast timing preserves newer different messages and the existing same-text timer limitation", t => {
  t.mock.timers.enable({apis: ["setTimeout", "Date"], now: 0});
  initial.flashError("first"); t.mock.timers.tick(1000); initial.flashError("second");
  t.mock.timers.tick(1500); assert.equal(useUi.getState().error, "second");
  t.mock.timers.tick(1000); assert.equal(useUi.getState().error, null);
  initial.flashError("same"); t.mock.timers.tick(1000); initial.flashError("same");
  t.mock.timers.tick(1500); assert.equal(useUi.getState().error, null, "AS-IS, not a new desired reset policy");
  initial.flashNotice("notice"); t.mock.timers.tick(7999); assert.equal(useUi.getState().notice, "notice");
  t.mock.timers.tick(1); assert.equal(useUi.getState().notice, null);
});

test("animation preference writes only the original localStorage key", () => {
  initial.setDiceAnimation(false); assert.equal(saved.get("lanterna.diceAnimation"), "off");
  assert.equal(useUi.getState().diceAnimation, false);
  initial.setDiceAnimation(true); assert.equal(saved.get("lanterna.diceAnimation"), "on");
  assert.deepEqual([...saved.keys()], ["lanterna.diceAnimation"]);
});
