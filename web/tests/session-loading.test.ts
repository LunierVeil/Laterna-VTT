import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
registerHooks({resolve(specifier, context, next) {
  try {return next(specifier, context);} catch (error) {
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
    throw error;
  }
}});
const storage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const prefs = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {configurable: true, value: {getItem: (key: string) => prefs.get(key) ?? null, setItem: (key: string, value: string) => prefs.set(key, value)}});
after(() => {if (storage) Object.defineProperty(globalThis, "localStorage", storage); else delete (globalThis as any).localStorage;});
const { useUi: raw } = await import("../src/state/store.ts");
const { projectionActions: bridge } = await import("../src/state/bridge.ts");
const { uiActions } = await import("../src/state/public.ts");
const { loadCampaignData } = await import("../src/app/session/useCampaignScene.ts");
const initial = raw.getState();
beforeEach(() => {raw.setState(initial, true); prefs.clear();});
const gm = {id: "gm", name: "GM", is_gm: true};
const player = {id: "p", name: "Player", is_gm: false};
const character = (id: string) => ({id, name: id, owner_id: null, system: "dnd5e", data: {}, source_format: null});
function requests(t: any) {
  const pending: {url: string; signal: AbortSignal; reply: (body: unknown) => void}[] = [];
  t.mock.method(globalThis, "fetch", (url: string, init: RequestInit) => new Promise<Response>(resolve => {
    pending.push({url, signal: init.signal as AbortSignal, reply: body => resolve(Response.json(body))});
  }));
  return pending;
}

test("current session applies characters and only an authorized remembered GM scene", async t => {
  bridge.setMe(gm); prefs.set("lanterna.gmScene", "remembered");
  const pending = requests(t), scenes: string[] = [];
  const load = loadCampaignData(id => scenes.push(id));
  pending[0].reply([character("own")]);
  pending[1].reply({active_scene_id: "active", scenes: [{id: "remembered"}]});
  await load.settled; assert.deepEqual(Object.keys(raw.getState().characters), ["own"]);
  assert.deepEqual(scenes, ["remembered"]); load.cancel();
});

test("late previous-user HTTP responses cannot repopulate caches or select a scene", async t => {
  bridge.setMe(gm); const pending = requests(t), scenes: string[] = [];
  const old = loadCampaignData(id => scenes.push(id));
  uiActions.endSession(); bridge.setMe(player);
  const fresh = loadCampaignData(id => scenes.push(id));
  pending[2].reply([character("player")]); pending[3].reply({active_scene_id: "player-scene"});
  await fresh.settled;
  pending[0].reply([character("private-gm")]); pending[1].reply({active_scene_id: "private-scene"});
  await old.settled;
  assert.deepEqual(Object.keys(raw.getState().characters), ["player"]);
  assert.deepEqual(scenes, ["player-scene"]); old.cancel(); fresh.cancel();
});

test("logout/login of the same id invalidates leases even before React cleanup", async t => {
  bridge.setMe(gm); const pending = requests(t), scenes: string[] = [];
  const load = loadCampaignData(id => scenes.push(id)), lease = bridge.captureSession();
  uiActions.endSession(); bridge.setMe({...gm});
  assert.equal(lease(), false);
  pending[0].reply([character("stale")]); pending[1].reply({active_scene_id: "stale"});
  await load.settled; assert.deepEqual(raw.getState().characters, {}); assert.deepEqual(scenes, []); load.cancel();
});

test("cleanup aborts both requests and ignores responses even when transport ignores abort", async t => {
  bridge.setMe(player); const pending = requests(t), scenes: string[] = [];
  const load = loadCampaignData(id => scenes.push(id)); load.cancel();
  assert.ok(pending.every(p => p.signal.aborted));
  pending[0].reply([character("cancelled")]); pending[1].reply({active_scene_id: "cancelled"});
  await load.settled; assert.deepEqual(raw.getState().characters, {}); assert.deepEqual(scenes, []);
});

test("server role change invalidates identity while same-role snapshot preserves its lease", () => {
  bridge.setMe(gm); const lease = bridge.captureSession();
  bridge.setMe({...gm, name: "New name"}); assert.equal(lease(), true);
  bridge.setMe({...gm, is_gm: false}); assert.equal(lease(), false);
  assert.equal(raw.getState().isGm, false); assert.deepEqual(raw.getState().invites, []);
});
