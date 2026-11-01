// Расчёт бонусов листа - без браузера: npm test (node --test, типы Node
// снимает сам). Тут только арифметика формы, кубы бросает сервер.
import { test } from "node:test";
import assert from "node:assert/strict";
import { abilityMod, checkBonus, computedBonus } from "../src/sheets/bonus.ts";
import { dnd5e } from "../src/sheets/dnd5e.ts";

const skills = dnd5e.tabs.flatMap((t) => t.blocks).find((b) => b.kind === "checklist" && b.path === "skills");
const saves = dnd5e.tabs.flatMap((t) => t.blocks).find((b) => b.kind === "checklist" && b.path === "abilities");
if (skills?.kind !== "checklist" || !skills.bonus || saves?.kind !== "checklist" || !saves.bonus) {
  throw new Error("в схеме dnd5e нет блоков навыков и спасбросков с bonus");
}

const char = (extra: object = {}) => ({
  proficiency: 6,
  abilities: { str: { score: 18, save: true }, dex: { score: 17 }, cha: { score: 9 } },
  skills: { athletics: { prof: true }, acrobatics: {} },
  ...extra,
});

test("модификатор: floor((x-10)/2)", () => {
  assert.equal(abilityMod(18), 4);
  assert.equal(abilityMod(9), -1);
  assert.equal(abilityMod(undefined), undefined);
});

test("навык с владением: Сила 18 при мастерстве 6 даёт +10", () => {
  const b = checkBonus(skills.bonus!, "skills.athletics", "str", char());
  assert.deepEqual(b, { value: 10, manual: false });
});

test("навык без владения - только модификатор", () => {
  assert.equal(checkBonus(skills.bonus!, "skills.acrobatics", "dex", char()).value, 3);
});

test("ручное поле главнее посчитанного", () => {
  const data = char({ skills: { athletics: { prof: true, bonus: 13 } } });
  assert.deepEqual(checkBonus(skills.bonus!, "skills.athletics", "str", data), { value: 13, manual: true });
  // А посчитанное видно отдельно - подсказка в режиме правки.
  assert.equal(computedBonus(skills.bonus!, "skills.athletics", "str", data), 10);
});

test("спасбросок: флаг abilities.<key>.save, свой бонус save_bonus", () => {
  assert.equal(checkBonus(saves.bonus!, "abilities.str", "str", char()).value, 10);
  assert.equal(checkBonus(saves.bonus!, "abilities.cha", "cha", char()).value, -1);
  const data = char({ abilities: { str: { score: 18, save: true, save_bonus: 2 } } });
  assert.deepEqual(checkBonus(saves.bonus!, "abilities.str", "str", data), { value: 2, manual: true });
});

test("нет характеристики - бонуса нет (не ноль)", () => {
  assert.equal(checkBonus(skills.bonus!, "skills.athletics", "str", { skills: {} }).value, undefined);
});

test("каждый навык схемы знает свою характеристику", () => {
  for (const item of skills.items) assert.ok(item.ability, item.key);
});

test("оружие без атаки (LSS без mod): посчитано из ability строки и владения", async () => {
  const { computedRowBonus } = await import("../src/sheets/bonus.ts");
  const weapons = dnd5e.tabs.flatMap((t) => t.blocks).find((b) => b.kind === "table" && b.path === "weapons");
  assert.ok(weapons && weapons.kind === "table" && weapons.rolls);
  const attack = weapons.rolls.items.find((i) => i.key === "attack")!;
  const data = { proficiency: 2, abilities: { str: { score: 16 } } };
  assert.equal(computedRowBonus(attack, { ability: "str", prof: true }, data), 5);
  assert.equal(computedRowBonus(attack, { ability: "str", prof: false }, data), 3);
  assert.equal(computedRowBonus(attack, { name: "без характеристики" }, data), undefined);
});

test("деньги: всего в зм - подсказка по курсам из схемы", async () => {
  const { blockTotal } = await import("../src/sheets/bonus.ts");
  const money = dnd5e.tabs.flatMap((t) => t.blocks).find((b) => b.kind === "fields" && b.title === "Деньги");
  assert.ok(money && money.kind === "fields" && money.total);
  assert.equal(blockTotal(money.total, { coins: { gp: 205, cp: 22 } }), 205.22);
  assert.equal(blockTotal(money.total, { coins: { pp: 1, ep: 3, sp: 7 } }), 12.2);
  assert.equal(blockTotal(money.total, {}), 0);
});

test("лечение с 0 сбрасывает спасброски от смерти, обычное лечение - нет", async () => {
  const { hpChanges } = await import("../src/sheets/bonus.ts");
  const down = { vitals: { hp: { current: 0, max: 20 } }, death: { successes: 2, fails: 1, dying: true } };
  assert.deepEqual(hpChanges(dnd5e, down, 5), {
    "vitals.hp.current": 5,
    "death.successes": 0,
    "death.fails": 0,
    "death.dying": false,
  });
  const hurt = { vitals: { hp: { current: 7, max: 20 } }, death: { successes: 0, fails: 0 } };
  assert.deepEqual(hpChanges(dnd5e, hurt, 9), { "vitals.hp.current": 9 });
  assert.deepEqual(hpChanges(dnd5e, down, 0), { "vitals.hp.current": 0 });
});

test("мастерство: Плут 1 уровня, Ловкость 10, мастерство в Скрытности - +4 при бонусе +2", async () => {
  const { checkBonus, profLevel } = await import("../src/sheets/bonus.ts");
  const rogue = { proficiency: 2, abilities: { dex: { score: 10 } }, skills: { stealth: { prof: 2 }, acrobatics: { prof: 1 } } };
  assert.equal(checkBonus(skills.bonus!, "skills.stealth", "dex", rogue).value, 4);
  assert.equal(checkBonus(skills.bonus!, "skills.acrobatics", "dex", rogue).value, 2);
  // Спасбросок с мастерством тоже удваивается.
  const save = { proficiency: 2, abilities: { dex: { score: 14, save: 2 } } };
  assert.equal(checkBonus(saves.bonus!, "abilities.dex", "dex", save).value, 6);
  // Старые листы: true = владение, false = нет; "2" из выпадающего списка = мастерство.
  assert.deepEqual([profLevel(true), profLevel(false), profLevel(undefined), profLevel("2"), profLevel(1)], [1, 0, 0, 2, 1]);
});

test("инструменты: бонус из характеристики и уровня владения строки", async () => {
  const { computedRowBonus } = await import("../src/sheets/bonus.ts");
  const tools = dnd5e.tabs.flatMap((t) => t.blocks).find((b) => b.kind === "table" && b.path === "tools");
  assert.ok(tools && tools.kind === "table" && tools.rolls);
  const check = tools.rolls.items[0];
  const data = { proficiency: 2, abilities: { dex: { score: 16 } } };
  assert.equal(computedRowBonus(check, { name: "Воровские инструменты", ability: "dex", level: 2 }, data), 7);
  assert.equal(computedRowBonus(check, { name: "Воровские инструменты", ability: "dex", level: 1 }, data), 5);
  assert.equal(computedRowBonus(check, { name: "Без характеристики", level: 1 }, data), undefined);
});

test("вес снаряжения: вес × количество, без количества - 1", async () => {
  const { totalWeight } = await import("../src/sheets/bonus.ts");
  const cards = [{ weight: 55, qty: 2 }, { weight: 3, qty: 4 }, { weight: 0.5 }, { name: "без веса", qty: 9 }];
  assert.equal(totalWeight(cards, "weight", "qty"), 122.5);
  assert.equal(totalWeight(undefined, "weight", "qty"), 0);
});

test("damage consumes temporary hp before current hp", async () => {
  const { hpChanges } = await import("../src/sheets/bonus.ts");
  const data = { vitals: { hp: { current: 20, temp: 10 } } };
  assert.deepEqual(hpChanges(dnd5e, data, 16), { "vitals.hp.current": 20, "vitals.hp.temp": 6 });
  assert.deepEqual(hpChanges(dnd5e, data, 6), { "vitals.hp.current": 16, "vitals.hp.temp": 0 });
  assert.deepEqual(hpChanges(dnd5e, data, 25), { "vitals.hp.current": 25 });
});

test("main tab preserves every skill/save path and removes the separate skills tab", () => {
  assert.equal(dnd5e.tabs.some(t => t.id === "skills" || t.title === "Навыки"), false);
  const main = dnd5e.tabs.find(t => t.id === "main")!;
  const skillBlock = main.blocks.find(b => b.kind === "checklist" && b.path === "skills");
  const saveBlock = main.blocks.find(b => b.kind === "checklist" && b.path === "abilities");
  assert.ok(skillBlock?.kind === "checklist" && saveBlock?.kind === "checklist");
  assert.equal(skillBlock.items.length, 18);
  assert.deepEqual(saveBlock.items.map(i => i.key), ["str", "dex", "con", "int", "wis", "cha"]);
  assert.equal(new Set(skillBlock.items.map(i=>i.key)).size,18);
  for(const row of skillBlock.items) assert.ok(saveBlock.items.some(a=>a.key===row.ability));
  assert.deepEqual(skillBlock.fields.map(f=>f.key), ["prof", "bonus"]);
  assert.deepEqual(saveBlock.fields.map(f=>f.key), ["save", "save_bonus"]);
  assert.ok(main.blocks.some(b=>b.kind==="table"&&b.path==="tools"));
});
