// Схема моба: что в ней есть и что старые мобы не теряют данные.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mob } from "../src/sheets/mob.ts";

const blocks = mob.tabs.flatMap((t) => t.blocks);
const fieldKeys = blocks.flatMap((b) => (b.kind === "fields" ? b.fields.map((f) => f.key) : []));

test("характеристики Сила...Харизма, 1-30", () => {
  const ab = blocks.find((b) => b.kind === "abilities");
  assert.ok(ab && ab.kind === "abilities");
  assert.deepEqual(ab.items.map((i) => i.key), ["str", "dex", "con", "int", "wis", "cha"]);
  assert.equal(ab.min, 1);
  assert.equal(ab.max, 30);
});

test("поля статблока и ручная инициатива", () => {
  for (const key of ["cr", "size", "senses", "languages", "defenses", "saves_skills", "initiative"]) {
    assert.ok(fieldKeys.includes(key), key);
  }
});

test("особенности и реакции - карточками", () => {
  const cards = blocks.filter((b) => b.kind === "cards").map((b) => (b.kind === "cards" ? b.path : ""));
  assert.deepEqual(cards, ["traits", "reactions", "equipment"]);
});

test("старые пути мобов на месте: хиты, КД, заметки, атаки", () => {
  for (const key of ["hp.max", "ac", "speed", "kind", "notes"]) assert.ok(fieldKeys.includes(key), key);
  assert.ok(blocks.some((b) => b.kind === "table" && b.path === "attacks"));
  assert.equal(mob.token?.bar.max, "hp.max");
});

test("NPC equipment shares the PC JSON card contract and editor without carrying capacity automation",async()=>{
 const {equipmentBlock}=await import('../src/sheets/equipment.ts');
 const item=blocks.find(b=>b.kind==='cards'&&b.path==='equipment');assert.ok(item&&item.kind==='cards');
 assert.equal(item.titleKey,equipmentBlock.titleKey);assert.deepEqual(item.fields,equipmentBlock.fields);assert.equal(item.weight,undefined);
 assert.ok(item.fields.some(f=>f.key==='qty'));assert.equal(item.path,'equipment');
});
