import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
registerHooks({resolve(specifier, context, next) {
  try {return next(specifier, context);} catch (error) {
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
    throw error;
  }
}});
const { resolveDefinition, systemPresentation: view } = await import("../src/app/systems/registry.ts");
const { characterStatsFor } = await import("../src/systems/dnd5e/model/tokenStats.ts");
const { dnd5e } = await import("../src/systems/dnd5e/model/dnd5e.ts");
const { mob } = await import("../src/systems/dnd5e/model/mob.ts");
const character = (system: string, data: any = {}) => ({id: "c", name: "C", system, data, owner_id: null, source_format: null});
const token = (hp: number | null = null) => ({id: "t", name: "T", color: "#fff", owner_id: null, size: 1, character_id: "c", image_url: null, layer: "tokens", hp});

test("static resolver preserves wire keys and rejects unknown/inherited names without D&D fallback", () => {
  assert.ok(resolveDefinition("dnd5e")); assert.ok(resolveDefinition("mob"));
  assert.equal(resolveDefinition("dnd5e"), resolveDefinition("dnd5e"));
  assert.notEqual(resolveDefinition("mob"), resolveDefinition("dnd5e"));
  for (const key of ["unknown", "", "__proto__", "constructor", "toString"]) {
    const c = character(key);
    assert.equal(resolveDefinition(key), undefined); assert.equal(view.tokenStats(c), null);
    assert.equal(view.tokenInspector(c, token()), null); assert.equal(view.healthChange(c, token(), 7), undefined);
    assert.equal(view.initiativeBonus(c), 0);
  }
});
test("definition projectors exactly match canonical legacy stats without mutating saved JSON", () => {
  for (const c of [character("dnd5e"), character("mob"), character("dnd5e", {vitals:{hp:{current:-2,max:0},ac:0,speed:" 30 фт"}}), character("mob", {hp:{max:17},ac:"12",speed:"25.5"})]) {
    const before = JSON.stringify(c); assert.deepEqual(view.tokenStats(c), characterStatsFor(c, c.system === "mob" ? mob : dnd5e));
    assert.equal(JSON.stringify(c), before);
  }
});
test("mob inspector null/zero instance HP preserves its distinct stage fallback", () => {
  const c = character("mob", {hp:{max:17},ac:12,speed:"25",size:"маленький",kind:"гуманоид"});
  assert.equal(view.tokenStats(c)?.hp, 17);
  assert.equal(view.tokenInspector(c, token(null))?.stats.hp, undefined);
  assert.equal(view.tokenInspector(c, token(0))?.stats.hp, 0);
  assert.deepEqual(view.tokenInspector(c, token(5))?.health, {current:5,max:17});
  assert.equal(view.tokenInspector(c, token())?.subtitle, "маленький гуманоид");
  assert.equal(view.tokenInspector(c, token())?.badgeLabel, "КД");
});
test("PC health intent preserves temporary HP while mob intent changes only instance HP", () => {
  const c = character("dnd5e", {vitals:{hp:{current:20,max:20,temp:10}},info:{class:"Воин",level:0}}), before = JSON.stringify(c);
  assert.deepEqual(view.healthChange(c, token(1), 16), {target:"character",set:{"vitals.hp.current":20,"vitals.hp.temp":6}});
  assert.equal(view.tokenInspector(c, token(1))?.stats.hp, 20);
  assert.equal(view.tokenInspector(c, token())?.subtitle, "Воин 0");
  const mob = character("mob", {hp:{max:17}});
  assert.deepEqual(view.healthChange(mob, token(3), 2), {target:"token",hp:2});
  assert.equal(JSON.stringify(c), before); assert.deepEqual(mob.data, {hp:{max:17}});
});
test("initiative projection preserves numeric paths and the existing server d20 presentation", () => {
  for (const bonus of [0,-3,4]) {
    assert.equal(view.initiativeBonus(character("dnd5e", {vitals:{initiative:bonus}})), bonus);
    assert.equal(view.initiativeBonus(character("mob", {initiative:bonus})), bonus);
    assert.equal(view.initiativeTitle(bonus), `бросить 1d20${bonus?`${bonus>0?"+":""}${bonus}`:""} (бонус из листа)`);
  }
  assert.equal(view.initiativeBonus(character("dnd5e", {vitals:{initiative:"4"}})),0);
  assert.equal(view.initiativeBonus(character("mob")),0); assert.equal(view.initiativeBonus(undefined),0);
  assert.equal(view.initiativeResult({formula:"1d20+3",die:7}),"d20: 7");
});
