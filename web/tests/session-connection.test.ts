import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { SceneSocket } from "../src/shared/api/scene-socket.ts";
registerHooks({resolve(specifier, context, next) {
  try {return next(specifier, context);} catch (error) {
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
    throw error;
  }
}});
const storage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
Object.defineProperty(globalThis, "localStorage", {configurable: true, value: {getItem: () => "on", setItem: () => {}}});
after(() => {if (storage) Object.defineProperty(globalThis, "localStorage", storage); else delete (globalThis as any).localStorage;});
const { useUi: raw } = await import("../src/state/store.ts");
const { projectionActions: bridge } = await import("../src/state/bridge.ts");
const { uiActions } = await import("../src/state/public.ts");
const { connectScene } = await import("../src/app/session/useSceneConnection.ts");
const initial = raw.getState(), gm = {id: "gm", name: "GM", is_gm: true};
beforeEach(() => {raw.setState(initial, true); bridge.setMe(gm);});
const character = {id: "c", name: "C", owner_id: "gm", system: "dnd5e", data: {}, source_format: null};
const roll = (id: string) => ({id, author: "GM", author_id: "gm", text: "1d20", kind: "roll", roll: {formula: "1d20", total: 7, terms: []}, created_at: null});
const scene = (id = "a", messages: any[] = []) => ({id, seq: 1, name: id, grid_size: 70, grid_type: "square", width: 1000, height: 1000, background_url: null, tokens: [], walls: [], combat: null, messages});

function harness(t: any) {
  const original = globalThis.WebSocket, location = Object.getOwnPropertyDescriptor(globalThis, "location");
  const peers: Peer[] = [];
  class Peer {
    static OPEN = 1; readyState = 1; onmessage: any; onopen: any; onclose: any;
    closed = false;
    constructor(_url: string) {peers.push(this);}
    send(_value: string) {}
    receive(value: unknown) {this.onmessage({data: JSON.stringify(value)});}
    close() {if (!this.closed) {this.closed = true; this.readyState = 3; this.onclose?.();}}
  }
  Object.defineProperty(globalThis, "location", {configurable: true, value: {protocol: "http:", host: "localhost"}});
  globalThis.WebSocket = Peer as any;
  t.mock.timers.enable({apis: ["setTimeout", "setInterval", "Date"], now: 10000});
  const cleanups: (() => void)[] = [], snapshots: any[] = [], events: any[] = [], animated: any[] = [], notices: any[] = [];
  const stage = {setSnapshot: (s: any) => snapshots.push(s), applyEvent: (...args: any[]) => events.push(args), showPing() {}, applyTokenPreview() {}};
  const stageRef = {current: stage as any}, seenRolls = {current: new Set<string>()};
  function connect(id = "a", sharedBuffer?: any, current = bridge.captureSession()) {
    const socket = new SceneSocket(id), buffer = sharedBuffer ?? {current: {socket: null as SceneSocket | null, scene: null as any, events: [] as any[]}};
    const count = peers.length;
    const cleanup = connectScene({socket, current, sceneId: id, me: gm, stageRef, seenRolls, setAnimatedRoll: m => animated.push(m), setLoginNotice: n => notices.push(n), setSceneId() {}, openScene() {}}, buffer);
    cleanups.push(cleanup); if (peers.length > count) peers.at(-1)!.onopen();
    return {socket, buffer, cleanup, peer: peers.at(-1)!};
  }
  t.after(() => {for (const cleanup of cleanups) cleanup(); globalThis.WebSocket = original; if (location) Object.defineProperty(globalThis, "location", location); else delete (globalThis as any).location;});
  return {peers, connect, stageRef, seenRolls, snapshots, events, animated, notices};
}

test("scene transition clears interaction/combat but preserves character context and campaign history", t => {
  bridge.setCharacters([character]); uiActions.openCharacter("c"); uiActions.setTool("ruler");
  bridge.setMessages([roll("history") as any]); bridge.setCombat({round: 3, current: null, entries: []});
  uiActions.setSelected({id: "old"} as any); uiActions.setSelectionCounts(2, 1); uiActions.setChaining(true);
  const before = raw.getState(), h = harness(t), connection = h.connect("b"), state = raw.getState();
  for (const key of ["characters", "openCharacterId", "messages", "diceAnimation", "tool"] as const) assert.equal(state[key], before[key], key);
  assert.equal(state.selected, null); assert.equal(state.selectionCount, 0); assert.equal(state.selectionEditable, 0);
  assert.equal(state.chaining, false); assert.equal(state.combat, null); assert.equal(state.connected, false);
  const next = scene("b"); next.combat = {round: 2, current: null, entries: []} as any;
  connection.peer.receive({type: "snapshot", seq: 1, scene: next, you: gm});
  assert.deepEqual(raw.getState().combat, next.combat); assert.equal(raw.getState().connected, true);
  assert.equal(raw.getState().openCharacterId, "c"); assert.deepEqual(h.snapshots, [next]);
});

test("disconnect and seq-gap reconnect preserve context, use fresh snapshot and never replay roll history", t => {
  bridge.setCharacters([character]); uiActions.openCharacter("c");
  const h = harness(t), c = h.connect(), history = roll("history");
  c.peer.receive({type: "snapshot", seq: 1, scene: scene("a", [history]), you: gm});
  assert.equal(raw.getState().connected, true); assert.deepEqual(h.animated, []);
  c.peer.receive({type: "chat", message: roll("live")}); assert.equal(h.animated.length, 1);
  uiActions.setSelected({id: "selected"} as any); const before = raw.getState();
  c.peer.receive({type: "event", seq: 3, name: "noop", payload: {}, cmd_id: null});
  assert.equal(raw.getState().connected, false);
  for (const key of ["me", "characters", "openCharacterId", "selected", "diceAnimation"] as const) assert.equal(raw.getState()[key], before[key], key);
  t.mock.timers.tick(1000); assert.equal(h.peers.length, 2); h.peers[1].onopen();
  assert.equal(raw.getState().connected, false, "open alone does not establish a fresh snapshot");
  h.peers[1].receive({type: "snapshot", seq: 5, scene: scene("a", [history, roll("live"), roll("offline")]), you: gm});
  assert.equal(raw.getState().connected, true); assert.equal(c.socket.sequence, 5);
  h.peers[1].receive({type: "chat", message: roll("offline")});
  assert.equal(h.animated.length, 1, "snapshot history is already seen");
  c.peer.receive({type: "chat", message: roll("old-peer")}); assert.equal(h.animated.length, 1);
  h.peers[1].receive({type: "event", seq: 6, name: "noop", payload: {}, cmd_id: "cmd"});
  assert.deepEqual(h.events, [["noop", {}, "cmd"]]); assert.equal(c.socket.sequence, 6);
  assert.equal(raw.getState().openCharacterId, "c");
});

test("old socket cannot write private projections after logout/login even before effect cleanup", t => {
  const h = harness(t), c = h.connect();
  c.peer.receive({type: "snapshot", seq: 1, scene: scene(), you: gm});
  uiActions.endSession(); bridge.setMe({id: "new", name: "New", is_gm: false});
  const before = raw.getState();
  c.peer.receive({type: "character", character});
  c.peer.receive({type: "snapshot", seq: 2, scene: scene("private", [roll("private")]), you: gm});
  c.peer.receive({type: "reply", name: "invite.created", payload: {token: "private", user_id: null}});
  c.peer.receive({type: "chat", message: roll("private")});
  c.peer.close(); assert.equal(raw.getState(), before); assert.deepEqual(h.animated, []);
  assert.equal(raw.getState().me?.id, "new"); assert.equal(raw.getState().lastInvite, null);
});

test("auth_required clears private state and explains logout before entering access screen", t => {
  const h = harness(t), c = h.connect(); bridge.setCharacters([character]); uiActions.openCharacter("c");
  c.peer.receive({type: "auth_required"});
  assert.equal(raw.getState().me, null); assert.deepEqual(raw.getState().characters, {});
  assert.equal(raw.getState().openCharacterId, null); assert.equal(raw.getState().connected, false);
  assert.deepEqual(h.notices, ["сессия кончилась - войди снова"]);
});

test("account removal campaign message clears private projections without reopening old data", t => {
  const h = harness(t), c = h.connect(); bridge.setCharacters([character]);
  bridge.setLastInvite({token: "old-private", user_id: null});
  c.peer.receive({type: "campaign", active_scene_id: "a", users: [], scenes: []});
  assert.equal(raw.getState().me, null); assert.deepEqual(raw.getState().characters, {});
  assert.deepEqual(raw.getState().accounts, []); assert.equal(raw.getState().lastInvite, null);
  assert.deepEqual(h.notices, ["аккаунт удалён мастером"]);
  c.peer.receive({type: "character", character}); assert.deepEqual(raw.getState().characters, {});
});

test("pre-render snapshot/events are buffered for this connection and cleared on cleanup", t => {
  const h = harness(t); h.stageRef.current = null; const c = h.connect();
  c.peer.receive({type: "snapshot", seq: 1, scene: scene(), you: gm});
  c.peer.receive({type: "event", seq: 2, name: "token.updated", payload: {id: "t"}, cmd_id: "cmd"});
  assert.equal(c.buffer.current.scene.id, "a");
  assert.deepEqual(c.buffer.current.events, [{name: "token.updated", payload: {id: "t"}, cmdId: "cmd"}]);
  c.cleanup(); assert.equal(c.buffer.current.socket, null); assert.equal(c.buffer.current.scene, null);
  assert.deepEqual(c.buffer.current.events, []);
});


test("retired render lease cannot start a connection or reset the newer identity", t => {
  const h = harness(t), old = bridge.captureSession(); uiActions.endSession();
  bridge.setMe({id: "new", name: "New", is_gm: false}); const before = raw.getState();
  h.connect("stale", undefined, old);
  assert.equal(h.peers.length, 0); assert.equal(raw.getState(), before);
});

test("superseded scene callbacks and old cleanup cannot overwrite a new connection", t => {
  const h = harness(t), a = h.connect("a"), b = h.connect("b", a.buffer);
  b.peer.receive({type: "snapshot", seq: 1, scene: scene("b"), you: gm});
  a.peer.receive({type: "chat", message: roll("old-scene")});
  assert.deepEqual(h.animated, []); assert.deepEqual(raw.getState().messages, []);
  a.cleanup(); assert.equal(raw.getState().connected, true);
  assert.equal(b.buffer.current.socket, b.socket); assert.equal(b.buffer.current.scene.id, "b");
});
