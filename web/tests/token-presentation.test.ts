import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
registerHooks({resolve(specifier, context, next) {
  try {return next(specifier, context);} catch (error) {
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
    throw error;
  }
}});
const { characterStats, statsOf, at } = await import("../src/systems/dnd5e/model/tokenStats.ts");
const { hpChanges } = await import("../src/systems/dnd5e/model/bonus.ts");
const { dnd5e, SHEETS } = await import("../src/systems/dnd5e/model/dnd5e.ts");
const character = (system: string, data: any = {}) => ({id: system, name: system, owner_id: null, system, data, source_format: null});

test("legacy registry keys and unknown projection remain exact", () => {
  assert.deepEqual(Object.keys(SHEETS).sort(), ["dnd5e", "mob"]);
  assert.equal(characterStats(character("unknown")), null);
  assert.deepEqual(characterStats(character("dnd5e")), {hp: undefined, max: undefined, badge: undefined, speed: undefined});
});
test("PC/mob token projections preserve optional numbers, badge and leading-integer speed", () => {
  for (const [speed, expected] of [[" 30 фт", 30], ["30.5", 30], ["-5", undefined], ["fast", undefined], [0, 0]] as const) {
    const pc = character("dnd5e", {vitals: {hp: {current: -2, max: 0}, ac: 0, speed}});
    const before = JSON.stringify(pc);
    assert.deepEqual(characterStats(pc), {hp: -2, max: 0, badge: "0", speed: expected});
    assert.equal(JSON.stringify(pc), before);
  }
  assert.deepEqual(characterStats(character("mob", {hp: {max: 17}, ac: "13", speed: "25"})), {hp: 17, max: 17, badge: "13", speed: 25});
  assert.deepEqual(characterStats(character("dnd5e", {vitals: {hp: {current: "10", max: null}, ac: ""}})), {hp: undefined, max: undefined, badge: undefined, speed: undefined});
});
test("stats map contains only supplied visible characters with known definitions", () => {
  const pc = character("dnd5e"), unknown = character("unknown"), mob = character("mob");
  const result = statsOf({pc, unknown, mob});
  assert.deepEqual([...result.keys()], ["dnd5e", "mob"]); assert.equal(result.has("not-visible"), false);
  assert.equal(at(null, "hp.current"), undefined); assert.equal(at({hp: 1}, "hp.current"), undefined);
});
test("health patch preserves absolute next, temporary absorption and typed healing reset", () => {
  const data = {vitals: {hp: {current: 20, temp: 10}}, death: {successes: 1, fails: 2, dying: true}};
  assert.deepEqual(hpChanges(dnd5e, data, 16), {"vitals.hp.current": 20, "vitals.hp.temp": 6});
  assert.deepEqual(hpChanges(dnd5e, data, 6), {"vitals.hp.current": 16, "vitals.hp.temp": 0});
  assert.deepEqual(hpChanges(dnd5e, data, 25), {"vitals.hp.current": 25});
  const down = {...data, vitals: {hp: {current: 0, temp: 0}}}, before = JSON.stringify(down);
  assert.deepEqual(hpChanges(dnd5e, down, 1), {"vitals.hp.current": 1, "death.successes": 0, "death.fails": 0, "death.dying": false});
  assert.equal(JSON.stringify(down), before);
});
